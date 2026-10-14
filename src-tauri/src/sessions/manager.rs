use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

use crate::commands::windows::project_window_label;
use crate::error::{AppError, AppResult};
use crate::models::{Session, SessionStatus};
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
    pub fn send<R: Runtime>(&self, app: &AppHandle<R>, session_id: &str, prompt: String, model: Option<String>) -> AppResult<Session> {
        let store = app.state::<Store>();
        let session = store.session(session_id)?;
        if self.is_running(session_id) || session.status == SessionStatus::Queued {
            return Err(AppError::msg("This session is already working; wait or stop it first."));
        }
        let item = ChatItem::Prompt { text: prompt.clone(), model: model.clone().or(session.model.clone()), at: Utc::now() };
        self.record(app, &session, vec![item]);

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

        let mut cmd = crate::shell_env::async_command(&claude.to_string_lossy());
        cmd.arg("-p")
            .args(["--output-format", "stream-json", "--verbose", "--include-partial-messages"])
            .args(["--permission-mode", &session.permission_mode]);
        if session.has_conversation {
            cmd.args(["--resume", &session.claude_session_id]);
        } else {
            cmd.args(["--session-id", &session.claude_session_id]);
        }
        if let Some(m) = model.clone().or(session.model.clone()).filter(|m| !m.trim().is_empty()) {
            cmd.args(["--model", m.trim()]);
        }
        for dir in dirs.iter().skip(1) {
            cmd.arg("--add-dir").arg(dir);
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
        let failed = !stopped && (code != Some(0) || turn.result_ok == Some(false));
        let mut notices = Vec::new();
        if stopped {
            notices.push(ChatItem::Notice { level: "warn".into(), text: "Detenida por el usuario.".into() });
        } else if failed && turn.result_ok.is_none() {
            let detail = stderr.trim().lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            notices.push(ChatItem::Notice {
                level: "error".into(),
                text: if detail.is_empty() { format!("claude terminó con código {code:?}") } else { detail },
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
        let _ = app.state::<Store>().update_session(id, |s| s.has_conversation = true);
    }
    let Ok(session) = app.state::<Store>().session(id) else { return };
    if let Some(text) = &parsed.delta {
        let _ = app.emit_to(project_window_label(&session.project_id).as_str(), SESSION_DELTA, DeltaEvent { session_id: id, text });
    }
    if !parsed.rate_windows.is_empty() {
        app.state::<UsageService>().apply_rate_windows(app, &parsed.rate_windows);
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

/// Folder Claude works in for a repo: the repo itself, or the session's worktree when isolated.
pub fn working_dir(app_data: &std::path::Path, session: &Session, repo_path: &str, repo_name: &str) -> PathBuf {
    match session.mode {
        crate::models::SessionMode::Direct => PathBuf::from(repo_path),
        crate::models::SessionMode::Isolated => app_data.join("worktrees").join(&session.project_id).join(&session.id).join(repo_name),
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
        let root = std::env::temp_dir().join(format!("devhub-e2e-{}", std::process::id()));
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
                });
                Ok(())
            })
            .unwrap();

        let manager = handle.state::<SessionManager>();

        manager.send(&handle, &session_id, "Lee nota.txt y dime solo el número.".into(), None).unwrap();
        let first = wait_idle(&store, &session_id).await;
        let after_first = store.session(&session_id).unwrap();
        println!("first: {first:?} summary={:?} err={:?}", after_first.summary, after_first.last_error);
        assert_eq!(first, SessionStatus::Waiting);
        assert!(after_first.has_conversation);

        manager.send(&handle, &session_id, "¿Qué número me dijiste antes? Responde solo el número.".into(), None).unwrap();
        let second = wait_idle(&store, &session_id).await;
        let after_second = store.session(&session_id).unwrap();
        println!("second: {second:?} summary={:?}", after_second.summary);
        assert!(after_second.summary.unwrap_or_default().contains("7381"), "resume lost context");

        let history = History::new(&store.dir()).read(&session_id).unwrap();
        let prompts = history.iter().filter(|i| matches!(i, ChatItem::Prompt { .. })).count();
        let results = history.iter().filter(|i| matches!(i, ChatItem::Result { ok: true, .. })).count();
        assert_eq!((prompts, results), (2, 2));
        let _ = std::fs::remove_dir_all(root);
    }
}
