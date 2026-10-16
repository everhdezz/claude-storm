//! Tools exposed to Claude sessions: inspect the worktree, list services, start/stop/restart the
//! ones it owns and read their logs, and read and edit the project wiki.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

use crate::commands::processes::spawn_repo_command;
use crate::commands::wiki::{self, WikiKind, WikiNode};
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
to confirm it compiles. You can only stop or restart services you started. \
The project also has a wiki of Markdown pages the user keeps (wiki_* tools): check it for project docs, \
conventions and notes, and update it when the user asks you to document something. \
When a message contains a wiki://<id> reference (often as a Markdown link), it points to a wiki page: \
read it with wiki_read, passing the reference as path. \
A session may start without repos: then your working folder is a scratch workspace. When you create or \
clone a repo (in the workspace or wherever the user asks), call repo_attach so it joins the project.";

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
    /// Allow every tool and command for the rest of the session (AskUserQuestion still asks).
    #[serde(default)]
    pub all: bool,
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
    let wiki_path = json!({ "type": "string", "description": "Path as shown by wiki_tree (e.g. Guides/Setup.md) or a wiki://<id> reference" });
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
            "name": "repo_attach",
            "description": "Adds a folder (typically a repo you just created or cloned) to the ClaudeStorm project, detecting its framework and dev commands, and attaches it to your session so services_list and service_start can run it. Relative paths are resolved from your working folder. Folders the project already has are just attached.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Folder of the repo, absolute or relative to your working folder" },
                    "name": { "type": "string", "description": "Optional display name (defaults to the folder name)" }
                },
                "required": ["path"]
            }
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
        },
        {
            "name": "wiki_tree",
            "description": "Every folder and Markdown page of the project wiki, one per line: folders end in /, pages show their wiki://<id> reference.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "wiki_read",
            "description": "Markdown of a wiki page.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": wiki_path.clone() },
                "required": ["path"]
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "wiki_search",
            "description": "Case-insensitive search in wiki page titles and text; returns matching pages with the matching lines.",
            "inputSchema": {
                "type": "object",
                "properties": { "query": { "type": "string" } },
                "required": ["query"]
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "wiki_create",
            "description": "Creates a wiki page (with optional Markdown) or folder. If the name is taken, \" 2\", \" 3\"… is appended. Returns its path.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "parent": { "type": "string", "description": "Folder path to create it in; omit or \"\" for the wiki root" },
                    "name": { "type": "string", "description": "Page title or folder name, without .md" },
                    "kind": { "type": "string", "enum": ["doc", "folder"], "description": "Default doc" },
                    "content": { "type": "string", "description": "Markdown of a new page" }
                },
                "required": ["name"]
            }
        },
        {
            "name": "wiki_write",
            "description": "Replaces the whole Markdown of an existing wiki page (read it first to keep what should stay).",
            "inputSchema": {
                "type": "object",
                "properties": { "path": wiki_path.clone(), "content": { "type": "string" } },
                "required": ["path", "content"]
            }
        },
        {
            "name": "wiki_rename",
            "description": "Renames a wiki page or folder in place; returns its new path.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": wiki_path.clone(), "name": { "type": "string", "description": "New title, without .md" } },
                "required": ["path", "name"]
            }
        },
        {
            "name": "wiki_move",
            "description": "Moves a wiki page or folder into another folder; returns its new path.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": wiki_path.clone(),
                    "parent": { "type": "string", "description": "Destination folder path; \"\" for the wiki root" }
                },
                "required": ["path", "parent"]
            }
        },
        {
            "name": "wiki_delete",
            "description": "Deletes a wiki page, or a folder with everything inside. Cannot be undone; only do it when the user asks.",
            "inputSchema": {
                "type": "object",
                "properties": { "path": wiki_path },
                "required": ["path"]
            },
            "annotations": { "destructiveHint": true }
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
        "repo_attach" => repo_attach(app, &store, &session, &project, args),
        "services_list" => Ok(services_list(app, &store, &session, &project)),
        "service_start" => start(app, &session, &project, args, false).await,
        "service_restart" => start(app, &session, &project, args, true).await,
        "service_stop" => stop(app, &session, &project, args).await,
        "service_logs" => logs(app, &project, args),
        _ if name.starts_with("wiki_") => wiki_tool(app, &project, name, args),
        APPROVAL_TOOL => approval(app, &session, args).await,
        _ => Err(AppError::msg(format!("Unknown tool {name}"))),
    }
}

/// Rule stored by "allow everything in this session".
pub const ALLOW_ALL: &str = "*";

/// Whether the session's "always allow" rules already cover this rule.
fn is_allowed(allowed_tools: &[String], rule: &str) -> bool {
    allowed_tools.iter().any(|r| r == ALLOW_ALL || r == rule)
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
    if !is_question && is_allowed(&session.allowed_tools, &rule) {
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
    let new_rule = match (decision.allow && !is_question, decision.all, decision.always) {
        (true, true, _) => Some(ALLOW_ALL.to_string()),
        (true, false, true) => Some(rule.clone()),
        _ => None,
    };
    if let Ok(updated) = store.update_session(&session.id, |s| {
        s.approvals.retain(|a| a.id != id);
        if let Some(new_rule) = &new_rule {
            if !s.allowed_tools.contains(new_rule) {
                s.allowed_tools.push(new_rule.clone());
            }
        }
    }) {
        emit_session(app, &updated);
        if new_rule.is_some() {
            // Prompts that were already waiting and the new rule covers are answered too.
            let mcp = app.state::<crate::mcp::McpState>();
            for other in &updated.approvals {
                if other.tool_name != "AskUserQuestion" && is_allowed(&updated.allowed_tools, &allow_rule(&other.tool_name, &other.input)) {
                    mcp.answer(&other.id, ApprovalDecision { allow: true, ..Default::default() });
                }
            }
        }
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
                "workingFolder": working_dir(&store.dir(), session, &r.id, &r.path, &r.name),
                "mainCheckout": r.path,
                "baseBranch": session.base_branches.get(&r.id),
            })
        })
        .collect();
    pretty(&json!({
        "session": session.title,
        "mode": if session.mode == SessionMode::Isolated { "isolated (own git worktree)" } else { "direct (edits the main checkout)" },
        "branch": session.branch,
        "workspace": session.workspace,
        "repos": repos,
    }))
}

/// Adds a folder to the project (if new) and to the session's repos.
fn repo_attach<R: Runtime>(app: &AppHandle<R>, store: &Store, session: &Session, project: &Project, args: &Value) -> AppResult<String> {
    let raw = args.get("path").and_then(Value::as_str).map(str::trim).filter(|p| !p.is_empty()).ok_or_else(|| AppError::msg("path is required"))?;
    let mut path = std::path::PathBuf::from(raw);
    if path.is_relative() {
        let base = session.workspace.clone().map(std::path::PathBuf::from).or_else(|| {
            project.repos.iter().find(|r| session.repo_ids.first() == Some(&r.id)).map(|r| working_dir(&store.dir(), session, &r.id, &r.path, &r.name))
        });
        let base = base.ok_or_else(|| AppError::msg("Use an absolute path: this session has no working folder yet."))?;
        path = base.join(path);
    }
    let path = path.to_string_lossy().to_string();
    let (mut repo, fresh) = crate::commands::repos::attach_paths(store, &project.id, &[path])?.remove(0);
    if let Some(name) = args.get("name").and_then(Value::as_str).map(str::trim).filter(|n| !n.is_empty() && *n != repo.name) {
        let name = name.to_string();
        let id = repo.id.clone();
        store.write(|d| {
            if let Some(r) = crate::store::find_project_mut(d, &project.id)?.repos.iter_mut().find(|r| r.id == id) {
                r.name = name.clone();
            }
            Ok(())
        })?;
        repo.name = name;
    }
    let updated = store.update_session(&session.id, |s| {
        if !s.repo_ids.contains(&repo.id) {
            s.repo_ids.push(repo.id.clone());
        }
    })?;
    crate::commands::projects::notify_projects_changed(app);
    emit_session(app, &updated);
    let commands: Vec<&str> = repo.commands.iter().map(|c| c.label.as_str()).collect();
    Ok(pretty(&json!({
        "repo": repo.name,
        "path": repo.path,
        "addedToProject": fresh,
        "framework": repo.framework,
        "commands": commands,
        "note": "Attached to your session. It is added to your allowed folders from your next turn.",
    })))
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

fn wiki_tool<R: Runtime>(app: &AppHandle<R>, project: &Project, name: &str, args: &Value) -> AppResult<String> {
    let root = wiki::root(app, &project.id)?;
    let arg = |key: &str| args.get(key).and_then(Value::as_str).unwrap_or_default();
    // Pages may be named by path (with or without .md) or by a `wiki://<id>` reference.
    let page = |key: &str| {
        if let Some(path) = wiki::path_of_ref(&root, arg(key)) {
            return path;
        }
        let path = arg(key).trim().trim_matches('/');
        if path.ends_with(".md") || root.join(path).is_dir() { path.to_string() } else { format!("{path}.md") }
    };
    let entry = |key: &str| {
        if let Some(path) = wiki::path_of_ref(&root, arg(key)) {
            return path;
        }
        let path = arg(key).trim().trim_matches('/');
        if root.join(path).exists() { path.to_string() } else { page(key) }
    };
    let changed = |paths: &[&str]| wiki::emit_changed(app, &project.id, paths);
    match name {
        "wiki_tree" => {
            let mut lines = Vec::new();
            wiki_lines(&wiki::tree(&root)?, &mut lines);
            Ok(if lines.is_empty() { "The wiki is empty.".into() } else { lines.join("\n") })
        }
        "wiki_read" => wiki::read(&root, &page("path")),
        "wiki_search" => wiki_search(&root, arg("query")),
        "wiki_create" => {
            let kind = if arg("kind") == "folder" { WikiKind::Folder } else { WikiKind::Doc };
            let parent = arg("parent").trim().trim_matches('/');
            let path = wiki::create(&root, parent, arg("name"), kind, arg("content"))?;
            changed(&[&path]);
            Ok(format!("Created {path}"))
        }
        "wiki_write" => {
            let path = page("path");
            wiki::write(&root, &path, arg("content"))?;
            changed(&[&path]);
            Ok(format!("Saved {path}"))
        }
        "wiki_rename" => {
            let from = entry("path");
            let to = wiki::rename(&root, &from, arg("name"))?;
            changed(&[&from, &to]);
            Ok(format!("Renamed to {to}"))
        }
        "wiki_move" => {
            let from = entry("path");
            let to = wiki::move_to(&root, &from, arg("parent").trim().trim_matches('/'))?;
            changed(&[&from, &to]);
            Ok(format!("Moved to {to}"))
        }
        "wiki_delete" => {
            let path = entry("path");
            wiki::delete(&root, &path)?;
            changed(&[&path]);
            Ok(format!("Deleted {path}"))
        }
        _ => Err(AppError::msg(format!("Unknown tool {name}"))),
    }
}

fn wiki_lines(nodes: &[WikiNode], out: &mut Vec<String>) {
    for node in nodes {
        match node.kind {
            WikiKind::Folder => {
                out.push(format!("{}/", node.path));
                wiki_lines(&node.children, out);
            }
            WikiKind::Doc => out.push(match &node.id {
                Some(id) => format!("{}  {}{id}", node.path, wiki::REF_SCHEME),
                None => node.path.clone(),
            }),
        }
    }
}

const SEARCH_MAX_PAGES: usize = 30;
const SEARCH_MAX_LINES: usize = 5;

fn wiki_search(root: &std::path::Path, query: &str) -> AppResult<String> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Err(AppError::msg("Empty query"));
    }
    let mut pages = Vec::new();
    let tree = wiki::read_tree(root, root)?;
    wiki_docs(&tree, &mut pages);
    let mut results = Vec::new();
    for node in pages {
        let text = wiki::read(root, &node.path).unwrap_or_default();
        let lines: Vec<String> = text
            .lines()
            .enumerate()
            .filter(|(_, l)| l.to_lowercase().contains(&query))
            .take(SEARCH_MAX_LINES)
            .map(|(i, l)| format!("  {}: {}", i + 1, l.trim()))
            .collect();
        if lines.is_empty() && !node.name.to_lowercase().contains(&query) {
            continue;
        }
        results.push(std::iter::once(node.path.clone()).chain(lines).collect::<Vec<_>>().join("\n"));
        if results.len() == SEARCH_MAX_PAGES {
            break;
        }
    }
    Ok(if results.is_empty() { format!("No wiki page mentions \"{query}\".") } else { results.join("\n\n") })
}

fn wiki_docs<'a>(nodes: &'a [WikiNode], out: &mut Vec<&'a WikiNode>) {
    for node in nodes {
        match node.kind {
            WikiKind::Folder => wiki_docs(&node.children, out),
            WikiKind::Doc => out.push(node),
        }
    }
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}
