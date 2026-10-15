//! Tools exposed to Claude sessions: inspect the worktree, list services, start/stop/restart the
//! ones it owns and read their logs.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

use crate::commands::processes::spawn_repo_command;
use crate::error::{AppError, AppResult};
use crate::models::{ApprovalRequest, Project, Repo, RepoCommand, Session, SessionMode};
use crate::sessions::manager::emit_session;
use crate::process_manager::{port_in_use, process_id, ProcessInfo, ProcessManager, ProcessStatus};
use crate::sessions::manager::working_dir;
use crate::store::Store;

/// Sent at `initialize`; tells Claude when the tools are worth using.
pub const INSTRUCTIONS: &str = "ClaudeStorm runs this project's dev servers and commands for the user. \
Use these tools instead of starting long-running servers with Bash: they run inside your working folder \
(your git worktree for isolated sessions), show up in the user's Services panel, and keep running after \
your turn. After changing code that a server serves, restart it with service_restart and read service_logs \
to confirm it compiles. You can only stop or restart services you started.";

const DEFAULT_WAIT: u64 = 15;
const MAX_WAIT: u64 = 90;
const LOG_TAIL: usize = 40;

/// Name of the tool Claude Code calls (via `--permission-prompt-tool`) to ask for permission.
pub const APPROVAL_TOOL: &str = "approval_prompt";

/// The user's answer to an approval prompt.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDecision {
    pub allow: bool,
    /// Also allow this tool (or exact Bash command) for the rest of the session.
    #[serde(default)]
    pub always: bool,
    /// AskUserQuestion answers: question text → chosen label(s), comma-separated for multi-select.
    #[serde(default)]
    pub answers: Option<serde_json::Map<String, Value>>,
    /// Optional note sent back to Claude when denying.
    #[serde(default)]
    pub message: Option<String>,
}

/// JSON schemas advertised by `tools/list`.
pub fn definitions() -> Value {
    let target = json!({
        "type": "object",
        "properties": {
            "repo": { "type": "string", "description": "Repo name as shown by services_list" },
            "command": { "type": "string", "description": "Command label as shown by services_list (e.g. dev)" },
            "wait_seconds": { "type": "integer", "description": "How long to wait for the server to be ready (default 15, max 90)" }
        },
        "required": ["repo", "command"]
    });
    json!([
        {
            "name": APPROVAL_TOOL,
            "description": "Used by Claude Code to ask the ClaudeStorm user for permission. Do not call it yourself.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tool_name": { "type": "string" },
                    "input": { "type": "object" },
                    "tool_use_id": { "type": "string" }
                },
                "required": ["tool_name", "input"]
            }
        },
        {
            "name": "worktree_info",
            "description": "Your session's mode, branch, base branch and the folder you work in for each repo.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "services_list",
            "description": "The project's configured commands per repo, with status, port, folder and who started each running one.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "service_start",
            "description": "Starts a configured command in your working folder and waits until its server answers (or it exits). Returns status and the last log lines.",
            "inputSchema": target
        },
        {
            "name": "service_restart",
            "description": "Restarts a service you started (or starts it if stopped), then waits like service_start.",
            "inputSchema": target
        },
        {
            "name": "service_stop",
            "description": "Stops a service you started.",
            "inputSchema": {
                "type": "object",
                "properties": { "repo": { "type": "string" }, "command": { "type": "string" } },
                "required": ["repo", "command"]
            }
        },
        {
            "name": "service_logs",
            "description": "Last output lines of a service, whoever started it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "repo": { "type": "string" },
                    "command": { "type": "string" },
                    "lines": { "type": "integer", "description": "How many lines (default 100, max 500)" }
                },
                "required": ["repo", "command"]
            },
            "annotations": { "readOnlyHint": true }
        }
    ])
}

/// Runs a tool for the session that owns the calling URL.
pub async fn call<R: Runtime>(app: &AppHandle<R>, session_id: &str, name: &str, args: &Value) -> AppResult<String> {
    let store = app.state::<Store>();
    let session = store.session(session_id)?;
    let project = store.project(&session.project_id)?;
    match name {
        "worktree_info" => Ok(worktree_info(&store, &session, &project)),
        "services_list" => Ok(services_list(app, &store, &session, &project)),
        "service_start" => start(app, &session, &project, args, false).await,
        "service_restart" => start(app, &session, &project, args, true).await,
        "service_stop" => stop(app, &session, &project, args).await,
        "service_logs" => logs(app, &project, args),
        APPROVAL_TOOL => approval(app, &session, args).await,
        _ => Err(AppError::msg(format!("Unknown tool {name}"))),
    }
}

/// Rule stored by "always allow": the exact command for Bash, the tool name otherwise.
fn allow_rule(tool_name: &str, input: &Value) -> String {
    match (tool_name, input.get("command").and_then(Value::as_str)) {
        ("Bash", Some(command)) => format!("Bash:{command}"),
        _ => tool_name.to_string(),
    }
}

/// Shows the prompt to the user and waits for their answer; returns Claude Code's permission JSON.
async fn approval<R: Runtime>(app: &AppHandle<R>, session: &Session, args: &Value) -> AppResult<String> {
    let tool_name = args.get("tool_name").and_then(Value::as_str).unwrap_or_default().to_string();
    let input = args.get("input").cloned().unwrap_or_else(|| json!({}));
    let allow = |input: Value| json!({ "behavior": "allow", "updatedInput": input }).to_string();
    let rule = allow_rule(&tool_name, &input);
    let is_question = tool_name == "AskUserQuestion";
    if !is_question && session.allowed_tools.contains(&rule) {
        return Ok(allow(input));
    }

    let store = app.state::<Store>();
    let request = ApprovalRequest { id: crate::models::new_id(), tool_name: tool_name.clone(), input: input.clone(), at: chrono::Utc::now() };
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.state::<crate::mcp::McpState>().waiting.lock().unwrap().insert(request.id.clone(), tx);
    let id = request.id.clone();
    let updated = store.update_session(&session.id, |s| s.approvals.push(request))?;
    emit_session(app, &updated);

    let decision = rx.await.unwrap_or_default();
    if let Ok(updated) = store.update_session(&session.id, |s| {
        s.approvals.retain(|a| a.id != id);
        if decision.allow && decision.always && !is_question && !s.allowed_tools.contains(&rule) {
            s.allowed_tools.push(rule.clone());
        }
    }) {
        emit_session(app, &updated);
    }

    if !decision.allow {
        let note = decision.message.filter(|m| !m.trim().is_empty());
        let message = match note {
            Some(note) => format!("The user denied this. Their note: {note}"),
            None => "The user denied this action. Do not retry it; ask them how to proceed.".to_string(),
        };
        return Ok(json!({ "behavior": "deny", "message": message }).to_string());
    }
    if is_question {
        let mut input = input;
        if let (Some(obj), Some(answers)) = (input.as_object_mut(), decision.answers) {
            obj.insert("answers".into(), Value::Object(answers));
        }
        return Ok(allow(input));
    }
    Ok(allow(input))
}

fn worktree_info(store: &Store, session: &Session, project: &Project) -> String {
    let repos: Vec<Value> = project
        .repos
        .iter()
        .filter(|r| session.repo_ids.contains(&r.id))
        .map(|r| {
            json!({
                "repo": r.name,
                "workingFolder": working_dir(&store.dir(), session, &r.path, &r.name),
                "mainCheckout": r.path,
                "baseBranch": session.base_branches.get(&r.id),
            })
        })
        .collect();
    pretty(&json!({
        "session": session.title,
        "mode": if session.mode == SessionMode::Isolated { "isolated (own git worktree)" } else { "direct (edits the main checkout)" },
        "branch": session.branch,
        "repos": repos,
    }))
}

fn services_list<R: Runtime>(app: &AppHandle<R>, store: &Store, session: &Session, project: &Project) -> String {
    let manager = app.state::<ProcessManager>();
    let running = manager.list(&project.id);
    let repos: Vec<Value> = project
        .repos
        .iter()
        .filter(|r| !r.commands.is_empty())
        .map(|repo| {
            let commands: Vec<Value> = repo
                .commands
                .iter()
                .map(|c| {
                    let proc = running.iter().find(|p| p.id == process_id(&repo.id, &c.id));
                    json!({
                        "command": c.label,
                        "run": c.command,
                        "server": c.long_running,
                        "status": proc.map_or("not started".to_string(), |p| status_text(p)),
                        "folder": proc.map(|p| p.cwd.clone()),
                        "startedBy": proc.map(|p| owner_text(p, session, store)),
                    })
                })
                .collect();
            json!({ "repo": repo.name, "port": repo.port, "inYourSession": session.repo_ids.contains(&repo.id), "commands": commands })
        })
        .collect();
    pretty(&json!(repos))
}

async fn start<R: Runtime>(app: &AppHandle<R>, session: &Session, project: &Project, args: &Value, restart: bool) -> AppResult<String> {
    let (repo, command) = resolve(project, args)?;
    let manager = app.state::<ProcessManager>();
    let id = process_id(&repo.id, &command.id);
    if let Some(current) = manager.list(&project.id).into_iter().find(|p| p.id == id && is_alive(p)) {
        if current.started_by.as_deref() != Some(session.id.as_str()) {
            return Err(AppError::msg(format!(
                "{} › {} is already running in {} and was started by {}. Read it with service_logs; only its owner can restart it.",
                repo.name,
                command.label,
                current.cwd,
                owner_text(&current, session, &app.state::<Store>())
            )));
        }
        if !restart {
            return Ok(format!("Already running (you started it).\n{}", report(&manager, &current)));
        }
        manager.stop(app, &id).await?;
        wait_until(&manager, &project.id, &id, Duration::from_secs(15), |p| !is_alive(p)).await;
    }
    if command.long_running {
        if let Some(port) = repo.port.filter(|&p| port_in_use(p)) {
            return Err(AppError::msg(format!(
                "Port {port} is already taken by a process ClaudeStorm did not start. Ask the user to free it."
            )));
        }
    }
    let store = app.state::<Store>();
    spawn_repo_command(app, &store, &manager, &project.id, &repo.id, &command.id, Some(session), Some(session.id.clone()))?;
    let wait = args.get("wait_seconds").and_then(Value::as_u64).unwrap_or(DEFAULT_WAIT).min(MAX_WAIT);
    let done = |p: &ProcessInfo| !is_alive(p) || (p.port.is_some() && p.ready);
    let info = wait_until(&manager, &project.id, &id, Duration::from_secs(wait), done).await;
    Ok(info.map_or_else(|| "Started.".to_string(), |p| report(&manager, &p)))
}

async fn stop<R: Runtime>(app: &AppHandle<R>, session: &Session, project: &Project, args: &Value) -> AppResult<String> {
    let (repo, command) = resolve(project, args)?;
    let manager = app.state::<ProcessManager>();
    let id = process_id(&repo.id, &command.id);
    let Some(current) = manager.list(&project.id).into_iter().find(|p| p.id == id && is_alive(p)) else {
        return Ok(format!("{} › {} is not running.", repo.name, command.label));
    };
    if current.started_by.as_deref() != Some(session.id.as_str()) {
        return Err(AppError::msg("You did not start this service, so you cannot stop it. Ask the user."));
    }
    manager.stop(app, &id).await?;
    Ok(format!("Stopping {} › {}.", repo.name, command.label))
}

fn logs<R: Runtime>(app: &AppHandle<R>, project: &Project, args: &Value) -> AppResult<String> {
    let (repo, command) = resolve(project, args)?;
    let manager = app.state::<ProcessManager>();
    let id = process_id(&repo.id, &command.id);
    let lines = args.get("lines").and_then(Value::as_u64).unwrap_or(100).min(500) as usize;
    let Some(info) = manager.list(&project.id).into_iter().find(|p| p.id == id) else {
        return Ok(format!("{} › {} has not run yet.", repo.name, command.label));
    };
    Ok(format!("{}\n{}", status_text(&info), tail(&manager, &id, lines)))
}

/// Finds a repo and command by name/label (case-insensitive) or id.
fn resolve<'a>(project: &'a Project, args: &Value) -> AppResult<(&'a Repo, &'a RepoCommand)> {
    let wanted_repo = args.get("repo").and_then(Value::as_str).unwrap_or_default();
    let wanted_cmd = args.get("command").and_then(Value::as_str).unwrap_or_default();
    let repo = project
        .repos
        .iter()
        .find(|r| r.name.eq_ignore_ascii_case(wanted_repo) || r.id == wanted_repo)
        .ok_or_else(|| AppError::msg(format!("No repo named \"{wanted_repo}\". Call services_list to see them.")))?;
    let command = repo
        .commands
        .iter()
        .find(|c| c.label.eq_ignore_ascii_case(wanted_cmd) || c.id == wanted_cmd || c.command == wanted_cmd)
        .ok_or_else(|| AppError::msg(format!("{} has no command \"{wanted_cmd}\". Call services_list to see them.", repo.name)))?;
    Ok((repo, command))
}

/// Polls the process until `done` holds or the timeout passes; returns its latest info.
async fn wait_until(
    manager: &ProcessManager,
    project_id: &str,
    id: &str,
    timeout: Duration,
    done: impl Fn(&ProcessInfo) -> bool,
) -> Option<ProcessInfo> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let info = manager.list(project_id).into_iter().find(|p| p.id == id);
        if info.as_ref().is_none_or(&done) || tokio::time::Instant::now() >= deadline {
            return info;
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
}

fn is_alive(p: &ProcessInfo) -> bool {
    matches!(p.status, ProcessStatus::Running | ProcessStatus::Stopping)
}

fn status_text(p: &ProcessInfo) -> String {
    match p.status {
        ProcessStatus::Running => match p.port {
            Some(port) if p.ready => format!("running, answering on http://localhost:{port}"),
            Some(port) => format!("running, not answering on port {port} yet"),
            None => "running".into(),
        },
        ProcessStatus::Stopping => "stopping".into(),
        ProcessStatus::Stopped => "stopped".into(),
        ProcessStatus::Exited => "finished (exit code 0)".into(),
        ProcessStatus::Failed => format!("failed (exit code {})", p.exit_code.map_or("?".into(), |c| c.to_string())),
    }
}

fn owner_text(p: &ProcessInfo, me: &Session, store: &Store) -> String {
    match p.started_by.as_deref() {
        None => "the user".into(),
        Some(id) if id == me.id => "you".into(),
        Some(id) => store.session(id).map_or("another session".into(), |s| format!("the session \"{}\"", s.title)),
    }
}

fn report(manager: &ProcessManager, p: &ProcessInfo) -> String {
    format!("Status: {}\nFolder: {}\nLast output:\n{}", status_text(p), p.cwd, tail(manager, &p.id, LOG_TAIL))
}

fn tail(manager: &ProcessManager, id: &str, lines: usize) -> String {
    let logs = manager.logs(id);
    let start = logs.len().saturating_sub(lines);
    let text: Vec<String> = logs[start..].iter().map(|l| l.text.clone()).collect();
    if text.is_empty() { "(no output yet)".into() } else { text.join("\n") }
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}
