use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

use crate::commands::windows::project_window_label;
use crate::error::{AppError, AppResult};
use crate::i18n::tr;
use crate::models::{PendingMessage, Session, SessionStatus};
use crate::proc_tree::{self, ProcessTree};
use crate::sessions::history::History;
use crate::sessions::stream::{edited_file, parse_line, ChatItem};
use crate::store::Store;
use crate::usage::service::UsageService;

pub const SESSION_ITEM: &str = "session-item";
pub const SESSION_DELTA: &str = "session-delta";
pub const SESSION_CHANGED: &str = "session-changed";

/// A prompt waiting for a free slot.
struct Queued {
    session_id: String,
    prompt: String,
    model: Option<String>,
}

/// Live item event.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemEvent<'a> {
    session_id: &'a str,
    item: &'a ChatItem,
}

/// Streaming text event.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeltaEvent<'a> {
    session_id: &'a str,
    text: &'a str,
}

/// Runs Claude Code headless processes for sessions, one process per prompt, with a global limit.
#[derive(Default)]
pub struct SessionManager {
    running: Mutex<HashMap<String, Arc<ProcessTree>>>,
    stopping: Mutex<HashSet<String>>,
    /// Sessions interrupted by "Enviar ya": their pending messages go out as soon as they stop.
    send_now: Mutex<HashSet<String>>,
    queue: Mutex<VecDeque<Queued>>,
}

/// Emits a session's latest state to its project window.
pub fn emit_session<R: Runtime>(app: &AppHandle<R>, session: &Session) {
    let _ = app.emit_to(project_window_label(&session.project_id).as_str(), SESSION_CHANGED, session);
}

impl SessionManager {
    /// True while a session has a live process.
    pub fn is_running(&self, id: &str) -> bool {
        self.running.lock().unwrap().contains_key(id)
    }

    /// Records the prompt and runs it now, or queues it when the parallel limit is reached.
    pub fn send<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        session_id: &str,
        prompt: String,
        model: Option<String>,
        attachments: Vec<String>,
    ) -> AppResult<Session> {
        let store = app.state::<Store>();
        let session = store.session(session_id)?;
        let copied = copy_attachments(&attachments_dir(&store.dir(), session_id), &attachments)?;
        let names: Vec<String> = copied.iter().filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string())).collect();
        let message = PendingMessage {
            id: crate::models::new_id(),
            text: prompt.clone(),
            prompt: with_attachment_list(prompt, &copied),
            model,
            attachments: names,
            at: Utc::now(),
        };
        // Busy: queue it like Claude Code does; it goes out when the current turn ends.
        if self.is_running(session_id) || session.status == SessionStatus::Queued {
            let updated = store.update_session(session_id, |s| s.pending.push(message))?;
            emit_session(app, &updated);
            return Ok(updated);
        }
        self.dispatch(app, &session, vec![message])
    }

    /// Records the messages in the chat and runs them as one prompt (or queues it for a free slot).
    fn dispatch<R: Runtime>(&self, app: &AppHandle<R>, session: &Session, messages: Vec<PendingMessage>) -> AppResult<Session> {
        let store = app.state::<Store>();
        let session_id = session.id.as_str();
        let account = project_account(&store, &session.project_id)?;
        let items = messages
            .iter()
            .map(|m| ChatItem::Prompt {
                text: m.text.clone(),
                attachments: m.attachments.clone(),
                model: m.model.clone().or(session.model.clone()).or(account.default_model.clone()),
                account: Some(account.alias.clone()),
                at: Utc::now(),
            })
            .collect();
        self.record(app, session, items);
        let model = messages.iter().rev().find_map(|m| m.model.clone());
        let prompt = messages.iter().map(|m| m.prompt.as_str()).collect::<Vec<_>>().join("\n\n");

        let limit = store.read(|d| d.settings.max_parallel_sessions.max(1));
        if self.running.lock().unwrap().len() >= limit {
            self.queue.lock().unwrap().push_back(Queued { session_id: session_id.into(), prompt, model });
            let updated = store.update_session(session_id, |s| {
                s.status = SessionStatus::Queued;
                s.last_activity_at = Utc::now();
            })?;
            emit_session(app, &updated);
            return Ok(updated);
        }
        self.start(app, session_id, prompt, model)
    }

    /// Sends the queued messages now: interrupts the current turn first if Claude is working.
    pub async fn send_now<R: Runtime>(&self, app: &AppHandle<R>, session_id: &str) -> AppResult<()> {
        let store = app.state::<Store>();
        let session = store.session(session_id)?;
        if session.pending.is_empty() {
            return Ok(());
        }
        if self.is_running(session_id) {
            self.send_now.lock().unwrap().insert(session_id.to_string());
            return self.stop(app, session_id).await;
        }
        // Waiting for a parallel slot: fold the messages into the prompt that is already in line.
        if session.status == SessionStatus::Queued {
            let mut taken = Vec::new();
            let session = store.update_session(session_id, |s| taken = std::mem::take(&mut s.pending))?;
            let account = project_account(&store, &session.project_id)?;
            let items = taken
                .iter()
                .map(|m| ChatItem::Prompt {
                    text: m.text.clone(),
                    attachments: m.attachments.clone(),
                    model: m.model.clone().or(session.model.clone()).or(account.default_model.clone()),
                    account: Some(account.alias.clone()),
                    at: Utc::now(),
                })
                .collect();
            if let Some(entry) = self.queue.lock().unwrap().iter_mut().find(|q| q.session_id == session_id) {
                for m in &taken {
                    entry.prompt.push_str("\n\n");
                    entry.prompt.push_str(&m.prompt);
                }
            }
            self.record(app, &session, items);
            emit_session(app, &session);
            return Ok(());
        }
        self.flush_pending(app, session_id).map(|_| ())
    }

    /// Takes every pending message of a session and dispatches them together.
    fn flush_pending<R: Runtime>(&self, app: &AppHandle<R>, session_id: &str) -> AppResult<Option<Session>> {
        let store = app.state::<Store>();
        let mut taken = Vec::new();
        let session = store.update_session(session_id, |s| taken = std::mem::take(&mut s.pending))?;
        if taken.is_empty() {
            return Ok(None);
        }
        self.dispatch(app, &session, taken).map(Some)
    }

    /// Removes one queued message (to discard it or to edit it in the composer).
    pub fn remove_pending<R: Runtime>(&self, app: &AppHandle<R>, session_id: &str, message_id: &str) -> AppResult<Option<PendingMessage>> {
        let mut removed = None;
        let updated = app.state::<Store>().update_session(session_id, |s| {
            if let Some(pos) = s.pending.iter().position(|m| m.id == message_id) {
                removed = Some(s.pending.remove(pos));
            }
        })?;
        emit_session(app, &updated);
        Ok(removed)
    }

    /// Stops a working session (or removes it from the queue).
    pub async fn stop<R: Runtime>(&self, app: &AppHandle<R>, session_id: &str) -> AppResult<()> {
        let was_queued = {
            let mut queue = self.queue.lock().unwrap();
            let before = queue.len();
            queue.retain(|q| q.session_id != session_id);
            queue.len() != before
        };
        if was_queued {
            let updated = app.state::<Store>().update_session(session_id, |s| s.status = SessionStatus::Idle)?;
            emit_session(app, &updated);
            return Ok(());
        }
        let tree = self.running.lock().unwrap().get(session_id).cloned();
        if let Some(tree) = tree {
            self.stopping.lock().unwrap().insert(session_id.to_string());
            tree.shutdown().await;
        }
        Ok(())
    }

    /// Stops every session of a project (its window closed).
    pub fn stop_project<R: Runtime>(&self, app: &AppHandle<R>, project_id: &str) {
        let store = app.state::<Store>();
        let ids: Vec<String> = store.read(|d| d.sessions.iter().filter(|s| s.project_id == project_id).map(|s| s.id.clone()).collect());
        self.queue.lock().unwrap().retain(|q| !ids.contains(&q.session_id));
        let trees: Vec<Arc<ProcessTree>> = {
            let running = self.running.lock().unwrap();
            ids.iter().filter_map(|id| running.get(id).cloned()).collect()
        };
        self.stopping.lock().unwrap().extend(ids.iter().cloned());
        for id in &ids {
            let _ = store.update_session(id, |s| {
                if matches!(s.status, SessionStatus::Working | SessionStatus::Queued) {
                    s.status = SessionStatus::Interrupted;
                }
            });
        }
        tauri::async_runtime::spawn(async move {
            for tree in &trees {
                tree.shutdown().await;
            }
        });
    }

    /// Kills everything synchronously on app exit.
    pub fn kill_all(&self) {
        for tree in self.running.lock().unwrap().values() {
            tree.kill();
        }
    }

    /// Appends items to history and emits them.
    fn record<R: Runtime>(&self, app: &AppHandle<R>, session: &Session, items: Vec<ChatItem>) {
        let history = History::new(&app.state::<Store>().dir());
        if let Err(err) = history.append(&session.id, &items) {
            eprintln!("could not write history of {}: {err}", session.id);
        }
        let label = project_window_label(&session.project_id);
        for item in &items {
            let _ = app.emit_to(label.as_str(), SESSION_ITEM, ItemEvent { session_id: &session.id, item });
        }
    }

    /// Spawns `claude -p` for a prompt and streams its output into the session.
    fn start<R: Runtime>(&self, app: &AppHandle<R>, session_id: &str, prompt: String, model: Option<String>) -> AppResult<Session> {
        let store = app.state::<Store>();
        let session = store.session(session_id)?;
        let project = store.project(&session.project_id)?;
        let dirs: Vec<PathBuf> = session
            .repo_ids
            .iter()
            .filter_map(|id| project.repos.iter().find(|r| &r.id == id))
            .map(|r| crate::sessions::manager::working_dir(&store.dir(), &session, &r.path, &r.name))
            .collect();
        let Some(cwd) = dirs.first().cloned() else {
            return Err(AppError::msg("The session has no repos; add at least one."));
        };
        let claude = crate::shell_env::which("claude").ok_or_else(|| AppError::msg("The `claude` CLI was not found in PATH."))?;
        let account = project_account(&store, &session.project_id)?;
        let (account_vars, cleared_vars) = crate::accounts::account_env(&account, &store.dir())?;

        let runtime = tauri::async_runtime::handle();
        let _context = runtime.inner().enter();
        let mut cmd = crate::shell_env::async_command(&claude.to_string_lossy());
        cmd.arg("-p")
            .args(["--output-format", "stream-json", "--verbose", "--include-partial-messages"])
            .args(["--permission-mode", &session.permission_mode]);
        if session.has_conversation {
            cmd.args(["--resume", &session.claude_session_id]);
        } else {
            cmd.args(["--session-id", &session.claude_session_id]);
        }
        for var in cleared_vars {
            cmd.env_remove(var);
        }
        cmd.envs(&account_vars);
        let default_model = account.default_model.clone().or(store.read(|d| d.settings.default_model.clone()));
        if let Some(m) = model.clone().or(session.model.clone()).or(default_model).filter(|m| !m.trim().is_empty()) {
            cmd.args(["--model", m.trim()]);
        }
        for dir in dirs.iter().skip(1) {
            cmd.arg("--add-dir").arg(dir);
        }
        // Gives Claude the ClaudeStorm MCP tools (services, logs, worktree info), pre-approved.
        if let Some(config) = app.try_state::<crate::mcp::McpState>().and_then(|m| m.config_for(session_id)) {
            cmd.arg("--mcp-config").arg(config);
            cmd.args(["--allowedTools", &format!("mcp__{}", crate::mcp::SERVER_NAME)]);
            // Permission prompts and AskUserQuestion go to the user through the ClaudeStorm UI.
            cmd.args(["--permission-prompt-tool", &format!("mcp__{}__{}", crate::mcp::SERVER_NAME, crate::mcp::tools::APPROVAL_TOOL)]);
            cmd.env("MCP_TOOL_TIMEOUT", "3600000");
        }
        let attachments = attachments_dir(&store.dir(), session_id);
        if attachments.is_dir() {
            cmd.arg("--add-dir").arg(&attachments);
        }
        cmd.current_dir(&cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        proc_tree::isolate(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| AppError::msg(format!("Could not start claude: {e}")))?;
        let tree = Arc::new(ProcessTree::attach(&child)?);
        self.running.lock().unwrap().insert(session_id.to_string(), tree);

        let updated = store.update_session(session_id, |s| {
            s.status = SessionStatus::Working;
            s.last_activity_at = Utc::now();
            s.last_error = None;
        })?;
        emit_session(app, &updated);

        let mut stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let mut stderr = child.stderr.take();
        let app = app.clone();
        let id = session_id.to_string();
        tauri::async_runtime::spawn(async move {
            if let Some(mut input) = stdin.take() {
                let _ = input.write_all(prompt.as_bytes()).await;
                let _ = input.shutdown().await;
            }
            let err_task = tauri::async_runtime::spawn(async move {
                let mut text = String::new();
                if let Some(err) = stderr.as_mut() {
                    let _ = err.read_to_string(&mut text).await;
                }
                text
            });
            let mut turn = TurnState::default();
            if let Some(out) = stdout {
                let mut lines = BufReader::new(out).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    handle_line(&app, &id, &line, &mut turn);
                }
            }
            let status = child.wait().await;
            let stderr_text = err_task.await.unwrap_or_default();
            let manager = app.state::<SessionManager>();
            manager.running.lock().unwrap().remove(&id);
            let stopped = manager.stopping.lock().unwrap().remove(&id);
            manager.finish(&app, &id, turn, status.ok().and_then(|s| s.code()), stopped, stderr_text);
            manager.dequeue(&app);
        });
        Ok(updated)
    }

    /// Updates the session after its process exits.
    fn finish<R: Runtime>(&self, app: &AppHandle<R>, id: &str, turn: TurnState, code: Option<i32>, stopped: bool, stderr: String) {
        let store = app.state::<Store>();
        let Ok(session) = store.session(id) else { return };
        // The Claude process is gone, so nobody waits for its prompts anymore.
        if !session.approvals.is_empty() {
            let ids: Vec<String> = session.approvals.iter().map(|a| a.id.clone()).collect();
            if let Some(mcp) = app.try_state::<crate::mcp::McpState>() {
                mcp.cancel(&ids);
            }
            let _ = store.update_session(id, |s| s.approvals.clear());
        }
        let failed = !stopped && (code != Some(0) || turn.result_ok == Some(false));
        let send_now = self.send_now.lock().unwrap().remove(id);
        // Queued messages follow a normal finish or an "Enviar ya" interruption; after an error or
        // a plain stop they stay queued so the user decides.
        let flush = !session.pending.is_empty() && ((!stopped && !failed) || (stopped && send_now));
        let mut notices = Vec::new();
        if stopped && send_now {
            notices.push(ChatItem::Notice { level: "info".into(), text: tr("Interrupted to send your messages.", "Interrumpida para enviar tus mensajes.") });
        } else if stopped {
            notices.push(ChatItem::Notice { level: "warn".into(), text: tr("Stopped by the user.", "Detenida por el usuario.") });
        } else if failed && turn.result_ok.is_none() {
            let detail = stderr.trim().lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            notices.push(ChatItem::Notice {
                level: "error".into(),
                text: if detail.is_empty() { format!("{} {code:?}", tr("claude exited with code", "claude terminó con código")) } else { detail },
            });
        }
        self.record(app, &session, notices);
        let updated = store.update_session(id, |s| {
            s.last_activity_at = Utc::now();
            if turn.started {
                s.has_conversation = true;
            }
            for file in &turn.files {
                if !s.files_touched.contains(file) {
                    s.files_touched.push(file.clone());
                }
            }
            if let Some(summary) = &turn.last_text {
                s.summary = summary.lines().find(|l| !l.trim().is_empty()).map(|l| l.chars().take(140).collect());
            }
            s.status = if stopped {
                SessionStatus::Interrupted
            } else if failed {
                SessionStatus::Error
            } else if turn.files.is_empty() {
                SessionStatus::Waiting
            } else {
                SessionStatus::Done
            };
            s.last_error = failed.then(|| stderr.trim().lines().last().unwrap_or("error").to_string());
        });
        if flush {
            // Goes straight from working to working, so the UI does not announce a finished turn.
            if let Err(err) = self.flush_pending(app, id) {
                if let Ok(session) = store.update_session(id, |s| {
                    s.status = SessionStatus::Error;
                    s.last_error = Some(err.to_string());
                }) {
                    emit_session(app, &session);
                }
            }
            return;
        }
        if let Ok(updated) = updated {
            emit_session(app, &updated);
        }
    }

    /// Starts queued prompts while there are free slots.
    fn dequeue<R: Runtime>(&self, app: &AppHandle<R>) {
        let limit = app.state::<Store>().read(|d| d.settings.max_parallel_sessions.max(1));
        while self.running.lock().unwrap().len() < limit {
            let Some(next) = self.queue.lock().unwrap().pop_front() else { return };
            if let Err(err) = self.start(app, &next.session_id, next.prompt, next.model) {
                if let Ok(session) = app.state::<Store>().update_session(&next.session_id, |s| {
                    s.status = SessionStatus::Error;
                    s.last_error = Some(err.to_string());
                }) {
                    emit_session(app, &session);
                }
            }
        }
    }
}

/// Facts gathered while a prompt runs.
#[derive(Default)]
struct TurnState {
    started: bool,
    files: Vec<String>,
    last_text: Option<String>,
    result_ok: Option<bool>,
}

/// Applies one stdout line: history, live deltas, file tracking and inline usage.
fn handle_line<R: Runtime>(app: &AppHandle<R>, id: &str, line: &str, turn: &mut TurnState) {
    let parsed = parse_line(line);
    if parsed.started {
        turn.started = true;
        let model = parsed.model.clone();
        if let Ok(updated) = app.state::<Store>().update_session(id, |s| {
            s.has_conversation = true;
            if model.is_some() {
                s.last_model = model;
            }
        }) {
            emit_session(app, &updated);
        }
    }
    let Ok(session) = app.state::<Store>().session(id) else { return };
    if let Some(text) = &parsed.delta {
        let _ = app.emit_to(project_window_label(&session.project_id).as_str(), SESSION_DELTA, DeltaEvent { session_id: id, text });
    }
    if !parsed.rate_windows.is_empty() {
        if let Some(account_id) = app.state::<Store>().project(&session.project_id).ok().and_then(|p| p.account_id) {
            app.state::<UsageService>().apply_rate_windows(app, &account_id, &parsed.rate_windows);
        }
    }
    for item in &parsed.items {
        if let Some(file) = edited_file(item) {
            if !turn.files.contains(&file) {
                turn.files.push(file);
            }
        }
        match item {
            ChatItem::Text { text } => turn.last_text = Some(text.clone()),
            ChatItem::Result { ok, .. } => turn.result_ok = Some(*ok),
            _ => {}
        }
    }
    if !parsed.items.is_empty() {
        app.state::<SessionManager>().record(app, &session, parsed.items);
    }
}

/// Folder where a session's attached documents are copied.
pub fn attachments_dir(app_data: &std::path::Path, session_id: &str) -> PathBuf {
    app_data.join("sessions").join(session_id).join("attachments")
}

/// Copies attached files into the session folder (unique names) and returns their new paths.
fn copy_attachments(dir: &std::path::Path, files: &[String]) -> AppResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    for file in files {
        let src = std::path::Path::new(file);
        if !src.is_file() {
            return Err(AppError::msg(format!("{file} is not a file (folders cannot be attached).")));
        }
        std::fs::create_dir_all(dir)?;
        let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "archivo".into());
        let mut target = dir.join(&name);
        let mut n = 2;
        while target.exists() {
            let stem = std::path::Path::new(&name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let ext = std::path::Path::new(&name).extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
            target = dir.join(format!("{stem} ({n}){ext}"));
            n += 1;
        }
        std::fs::copy(src, &target)?;
        out.push(target);
    }
    Ok(out)
}

/// Appends the list of attached files so Claude reads them.
fn with_attachment_list(prompt: String, files: &[PathBuf]) -> String {
    if files.is_empty() {
        return prompt;
    }
    let list: Vec<String> = files.iter().map(|f| format!("- {}", f.display())).collect();
    format!("{prompt}\n\nAttached files (read them if relevant):\n{}", list.join("\n"))
}

/// The Claude account selected by a project; sessions refuse to run without one.
fn project_account(store: &Store, project_id: &str) -> AppResult<crate::models::ClaudeAccount> {
    let project = store.project(project_id)?;
    let id = project.account_id.ok_or_else(|| AppError::msg("This project has no Claude account. Pick one before chatting."))?;
    store
        .read(|d| d.accounts.iter().find(|a| a.id == id).cloned())
        .ok_or_else(|| AppError::msg("The project's Claude account no longer exists. Pick another one."))
}

/// Folder Claude works in for a repo: the repo itself, or the session's worktree when isolated.
pub fn working_dir(app_data: &std::path::Path, session: &Session, repo_path: &str, repo_name: &str) -> PathBuf {
    match session.mode {
        crate::models::SessionMode::Direct => PathBuf::from(repo_path),
        crate::models::SessionMode::Isolated => app_data.join("worktrees").join(&session.project_id).join(&session.id).join(repo_name),
    }
}

#[cfg(test)]
mod attachment_tests {
    use super::*;

    #[test]
    fn copies_with_unique_names_and_lists_them() {
        let root = std::env::temp_dir().join(format!("claude-storm-attach-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        let a = root.join("src/spec.pdf");
        std::fs::write(&a, "x").unwrap();
        let dir = root.join("att");
        let first = copy_attachments(&dir, &[a.to_string_lossy().to_string()]).unwrap();
        let second = copy_attachments(&dir, &[a.to_string_lossy().to_string()]).unwrap();
        assert_eq!(first[0].file_name().unwrap(), "spec.pdf");
        assert_eq!(second[0].file_name().unwrap(), "spec (2).pdf");
        let prompt = with_attachment_list("revisa".into(), &second);
        assert!(prompt.starts_with("revisa\n\nAttached files"));
        assert!(prompt.contains("spec (2).pdf"));
        assert!(copy_attachments(&dir, &[root.join("src").to_string_lossy().to_string()]).is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}

#[cfg(all(test, unix))]
mod e2e {
    use std::time::Duration;

    use super::*;
    use crate::models::{new_id, Framework, Project, Repo, SessionMode};

    /// Polls until the session leaves the working/queued states.
    async fn wait_idle(store: &Store, id: &str) -> SessionStatus {
        for _ in 0..1200 {
            let status = store.session(id).unwrap().status;
            if !matches!(status, SessionStatus::Working | SessionStatus::Queued) {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        panic!("session never finished");
    }

    /// Real end-to-end run (costs a few cents of haiku): `cargo test session_e2e -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn session_e2e() {
        let root = std::env::temp_dir().join(format!("claude-storm-e2e-{}", std::process::id()));
        let repo = root.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::write(repo.join("nota.txt"), "la clave es 7381\n").unwrap();
        crate::git::run_git(&repo, &["init", "-q"]).unwrap();

        let app = tauri::test::mock_builder()
            .manage(SessionManager::default())
            .manage(UsageService::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle().clone();
        handle.manage(Store::load(root.join("data")).unwrap());
        let store = handle.state::<Store>();
        let repo_id = new_id();
        let session_id = new_id();
        store
            .write(|d| {
                d.projects.push(Project {
                    id: "p".into(),
                    name: "e2e".into(),
                    created_at: Utc::now(),
                    last_opened_at: None,
                    repos: vec![Repo {
                        id: repo_id.clone(),
                        name: "repo".into(),
                        path: repo.to_string_lossy().to_string(),
                        framework: Framework::Generic,
                        package_manager: None,
                        port: None,
                        commands: vec![],
                    }],
                    account_id: Some("acc".into()),
                    color: None,
                    layout: Vec::new(),
                    ui_state: None,
                });
                d.accounts.push(crate::models::ClaudeAccount {
                    id: "acc".into(),
                    alias: "este equipo".into(),
                    kind: crate::models::AccountKind::SystemLogin,
                    token_hint: None,
                    default_model: None,
                    created_at: Utc::now(),
                    login_email: None,
                    needs_login: false,
                });
                d.sessions.push(Session {
                    id: session_id.clone(),
                    project_id: "p".into(),
                    title: "e2e".into(),
                    description: None,
                    profile_id: None,
                    model: Some("haiku".into()),
                    permission_mode: "acceptEdits".into(),
                    repo_ids: vec![repo_id.clone()],
                    mode: SessionMode::Direct,
                    branch: None,
                    status: SessionStatus::Idle,
                    claude_session_id: uuid::Uuid::new_v4().to_string(),
                    has_conversation: false,
                    created_at: Utc::now(),
                    last_activity_at: Utc::now(),
                    summary: None,
                    files_touched: vec![],
                    archived: false,
                    last_error: None,
                    base_branches: Default::default(),
                    last_model: None,
                    pending: Vec::new(),
        approvals: Vec::new(),
        allowed_tools: Vec::new(),
                });
                Ok(())
            })
            .unwrap();

        let manager = handle.state::<SessionManager>();

        manager.send(&handle, &session_id, "Lee nota.txt y dime solo el número.".into(), None, vec![]).unwrap();
        let first = wait_idle(&store, &session_id).await;
        let after_first = store.session(&session_id).unwrap();
        println!("first: {first:?} summary={:?} err={:?}", after_first.summary, after_first.last_error);
        assert_eq!(first, SessionStatus::Waiting);
        assert!(after_first.has_conversation);

        manager.send(&handle, &session_id, "¿Qué número me dijiste antes? Responde solo el número.".into(), None, vec![]).unwrap();
        let second = wait_idle(&store, &session_id).await;
        let after_second = store.session(&session_id).unwrap();
        println!("second: {second:?} summary={:?}", after_second.summary);
        assert!(after_second.summary.unwrap_or_default().contains("7381"), "resume lost context");

        let outside = root.join("fuera.txt");
        std::fs::write(&outside, "el código secreto es 5521\n").unwrap();
        manager
            .send(&handle, &session_id, "Dime solo el código secreto del archivo adjunto.".into(), None, vec![outside.to_string_lossy().to_string()])
            .unwrap();
        let third = wait_idle(&store, &session_id).await;
        let after_third = store.session(&session_id).unwrap();
        println!("third: {third:?} summary={:?}", after_third.summary);
        assert!(after_third.summary.unwrap_or_default().contains("5521"), "attachment not readable");

        let history = History::new(&store.dir()).read(&session_id).unwrap();
        let prompts = history.iter().filter(|i| matches!(i, ChatItem::Prompt { .. })).count();
        let results = history.iter().filter(|i| matches!(i, ChatItem::Result { ok: true, .. })).count();
        assert_eq!((prompts, results), (3, 3));
        assert!(history.iter().any(|i| matches!(i, ChatItem::Prompt { attachments, .. } if attachments == &vec!["fuera.txt".to_string()])));
        let _ = std::fs::remove_dir_all(root);
    }
}
