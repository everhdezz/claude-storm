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
use crate::models::{PendingMessage, Session, SessionMode, SessionStatus};
use crate::proc_tree::{self, ProcessTree};
use crate::sessions::history::History;
use crate::sessions::stream::{edited_file, parse_line, ChatItem, Parsed};
use crate::store::Store;
use crate::usage::service::UsageService;

pub const SESSION_ITEM: &str = "session-item";
pub const SESSION_DELTA: &str = "session-delta";
pub const SESSION_TOKENS: &str = "session-tokens";
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

/// Output tokens of one finished assistant message.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TokensEvent<'a> {
    session_id: &'a str,
    output_tokens: u64,
}

/// Runs Claude Code headless processes for sessions, one process per prompt, with a global limit.
#[derive(Default)]
pub struct SessionManager {
    running: Mutex<HashMap<String, Arc<ProcessTree>>>,
    /// Running sessions that only read (consult or plan mode): they do not count toward the
    /// parallel limit, so questions never wait behind code work.
    reading: Mutex<HashSet<String>>,
    stopping: Mutex<HashSet<String>>,
    /// Sessions interrupted by "Enviar ya": their pending messages go out as soon as they stop.
    send_now: Mutex<HashSet<String>>,
    /// Sessions that were already resumed automatically after their background work was cut off;
    /// cleared when the user writes, so a cut-off turn is resumed at most once per message.
    auto_resumed: Mutex<HashSet<String>>,
    /// Isolated sessions whose worktrees are being created right before their first editing turn.
    preparing: Mutex<HashSet<String>>,
    /// Sessions whose plan the user approved before they had a worktree: once the planning turn ends,
    /// the implementation runs as a new turn inside the worktree.
    implement_plan: Mutex<HashSet<String>>,
    queue: Mutex<VecDeque<Queued>>,
}

/// Extra system prompt of consult chats (they run in plan mode).
const CONSULT_PROMPT: &str = "This ClaudeStorm chat starts in consult mode: you can read and investigate, but not change anything yet. \
Answer questions and explanations directly, without a plan. Only when the user asks you to change code or files, \
investigate, then call ExitPlanMode with your plan: once it is accepted, ClaudeStorm picks the folder you will edit \
(the main checkout or a new git worktree) and you implement it in the next turn.";

/// A turn that cannot change code (consult chat or plan mode): it starts right away, whatever the
/// parallel limit, since it only answers questions.
fn is_read_only(session: &Session) -> bool {
    (is_consult(session) && !session.repo_ids.is_empty()) || session.permission_mode == "plan"
}

/// A consult chat: it has not been asked to change anything yet, so it has no folder of its own.
pub fn is_consult(session: &Session) -> bool {
    session.mode == SessionMode::Consult
}

/// An isolated session that has not created its worktrees yet: it plans and reads in the main checkout.
pub fn awaits_worktree(session: &Session) -> bool {
    session.mode == SessionMode::Isolated && session.branch.is_none() && session.workspace.is_none()
}

/// Emits a session's latest state to its project window.
pub fn emit_session<R: Runtime>(app: &AppHandle<R>, session: &Session) {
    let _ = app.emit_to(project_window_label(&session.project_id).as_str(), SESSION_CHANGED, session);
}

impl SessionManager {
    /// True while a session has a live process.
    pub fn is_running(&self, id: &str) -> bool {
        self.running.lock().unwrap().contains_key(id) || self.preparing.lock().unwrap().contains(id)
    }

    /// Running sessions that may edit code: the ones the parallel limit applies to.
    fn editing_count(&self) -> usize {
        let reading = self.reading.lock().unwrap();
        self.running.lock().unwrap().keys().filter(|id| !reading.contains(*id)).count()
    }

    /// Remembers that the user approved the plan of a session still without worktree.
    pub fn implement_after_turn(&self, id: &str) {
        self.implement_plan.lock().unwrap().insert(id.to_string());
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
        self.auto_resumed.lock().unwrap().remove(session_id);
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
        let session = &pin_account(&store, session)?;
        let session_id = session.id.as_str();
        let account = session_account(&store, session)?;
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
        if !is_read_only(session) && self.editing_count() >= limit {
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
            let account = session_account(&store, &session)?;
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
        // Still creating its worktrees: they are kept, but Claude does not start afterwards.
        if self.preparing.lock().unwrap().remove(session_id) {
            let updated = app.state::<Store>().update_session(session_id, |s| s.status = SessionStatus::Interrupted)?;
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
        self.preparing.lock().unwrap().retain(|id| !ids.contains(id));
        // Only sessions with a live process are flagged: a flag on an idle session would survive and
        // turn its next normal finish into "Stopped by the user".
        let (live, trees): (Vec<String>, Vec<Arc<ProcessTree>>) = {
            let running = self.running.lock().unwrap();
            ids.iter().filter_map(|id| running.get(id).map(|tree| (id.clone(), tree.clone()))).unzip()
        };
        self.stopping.lock().unwrap().extend(live);
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
    pub fn record<R: Runtime>(&self, app: &AppHandle<R>, session: &Session, items: Vec<ChatItem>) {
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
        // Plan mode cannot edit, so it keeps reading the main checkout; any other turn may edit.
        if awaits_worktree(&session) && session.permission_mode != "plan" {
            return self.start_in_new_worktree(app, session, prompt, model);
        }
        let project = store.project(&session.project_id)?;
        let dirs: Vec<PathBuf> = session
            .repo_ids
            .iter()
            .filter_map(|id| project.repos.iter().find(|r| &r.id == id))
            .map(|r| crate::sessions::manager::working_dir(&store.dir(), &session, &r.id, &r.path, &r.name))
            .collect();
        // A session started without repos keeps its workspace as cwd; attached repos are extra dirs.
        let (cwd, extra_dirs) = match &session.workspace {
            Some(ws) => {
                let ws = PathBuf::from(ws);
                std::fs::create_dir_all(&ws)?;
                (ws, &dirs[..])
            }
            None => match dirs.split_first() {
                Some((first, rest)) => (first.clone(), rest),
                None => return Err(AppError::msg("The session has no repos; add at least one.")),
            },
        };
        let claude = crate::shell_env::which("claude").ok_or_else(|| AppError::msg("The `claude` CLI was not found in PATH."))?;
        let account = session_account(&store, &session)?;
        let (account_vars, cleared_vars) = crate::accounts::account_env(&account, &store.dir())?;
        // A session can change folders (worktree created, or removed again by "archive all"); Claude
        // Code only resumes conversations stored under the current cwd.
        if session.has_conversation {
            if let Some(config) = crate::sessions::transcript::config_dir(&account_vars) {
                let _ = crate::sessions::transcript::copy_to_cwd(&config, &session.claude_session_id, &cwd);
            }
        }

        let runtime = tauri::async_runtime::handle();
        let _context = runtime.inner().enter();
        let mut cmd = crate::shell_env::async_command(&claude.to_string_lossy());
        // A consult chat reads but never edits: plan mode until it asks to change something
        // (ExitPlanMode), which is when it gets its folder (see mcp::tools::approval).
        let consult = session.mode == SessionMode::Consult && !session.repo_ids.is_empty();
        let permission_mode = if consult { "plan" } else { session.permission_mode.as_str() };
        cmd.arg("-p")
            .args(["--output-format", "stream-json", "--verbose", "--include-partial-messages"])
            .args(["--permission-mode", permission_mode]);
        if consult {
            cmd.args(["--append-system-prompt", CONSULT_PROMPT]);
        }
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
        for dir in extra_dirs {
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
        if consult || permission_mode == "plan" {
            self.reading.lock().unwrap().insert(session_id.to_string());
        } else {
            self.reading.lock().unwrap().remove(session_id);
        }
        // A new turn starts clean, even if an earlier stop left a stale flag behind.
        self.stopping.lock().unwrap().remove(session_id);

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
            manager.reading.lock().unwrap().remove(&id);
            let stopped = manager.stopping.lock().unwrap().remove(&id);
            manager.finish(&app, &id, turn, status.ok().and_then(|s| s.code()), stopped, stderr_text);
            manager.dequeue(&app);
        });
        Ok(updated)
    }

    /// Creates the session's worktrees in the background, moves its Claude conversation there and
    /// then starts the turn. The session counts as working meanwhile, so new messages queue up.
    fn start_in_new_worktree<R: Runtime>(&self, app: &AppHandle<R>, session: Session, prompt: String, model: Option<String>) -> AppResult<Session> {
        let store = app.state::<Store>();
        let project = store.project(&session.project_id)?;
        let account = session_account(&store, &session)?;
        let (account_vars, _) = crate::accounts::account_env(&account, &store.dir())?;
        let id = session.id.clone();
        self.preparing.lock().unwrap().insert(id.clone());
        let updated = store.update_session(&id, |s| {
            s.status = SessionStatus::Working;
            s.last_activity_at = Utc::now();
            s.last_error = None;
        })?;
        emit_session(app, &updated);
        self.record(
            app,
            &updated,
            vec![ChatItem::Notice {
                level: "info".into(),
                text: tr("Creating the session's worktree before Claude starts working…", "Creando el worktree de la sesión antes de que Claude empiece a trabajar…"),
            }],
        );

        let app = app.clone();
        let app_data = store.dir();
        tauri::async_runtime::spawn(async move {
            let snapshot = session.clone();
            let made = tauri::async_runtime::spawn_blocking(move || -> AppResult<(crate::sessions::worktree::SessionWorktrees, bool)> {
                let made = crate::sessions::worktree::create_for_session(&app_data, &project, &snapshot)?;
                // Claude Code finds conversations by cwd, and the cwd is about to become the first worktree.
                let first = snapshot.repo_ids.first().and_then(|rid| project.repos.iter().find(|r| &r.id == rid));
                let moved = match first.filter(|r| snapshot.has_conversation && made.base_branches.contains_key(&r.id)) {
                    Some(repo) => crate::sessions::transcript::config_dir(&account_vars)
                        .is_some_and(|config| {
                            let cwd = worktree_dir(&app_data, &snapshot, &repo.name);
                            crate::sessions::transcript::copy_to_cwd(&config, &snapshot.claude_session_id, &cwd).unwrap_or(false)
                        }),
                    None => true,
                };
                Ok((made, moved))
            })
            .await
            .map_err(|e| AppError::msg(e.to_string()))
            .and_then(|r| r);

            let manager = app.state::<SessionManager>();
            let store = app.state::<Store>();
            let wanted = manager.preparing.lock().unwrap().remove(&id);
            let started = made.and_then(|(made, moved)| {
                let mut text = tr("Worktree ready.", "Worktree preparado.");
                for note in &made.notes {
                    text.push('\n');
                    text.push_str(note);
                }
                if !moved {
                    text.push('\n');
                    text.push_str(&tr(
                        "The conversation could not be moved into the worktree: Claude starts a new one there and does not remember the earlier messages.",
                        "No pude mover la conversación al worktree: Claude empieza una nueva ahí y no recuerda los mensajes anteriores.",
                    ));
                }
                let updated = store.update_session(&id, |s| {
                    s.branch = Some(made.branch);
                    s.base_branches = made.base_branches;
                    if !moved {
                        s.has_conversation = false;
                        s.claude_session_id = uuid::Uuid::new_v4().to_string();
                    }
                })?;
                manager.record(&app, &updated, vec![ChatItem::Notice { level: if moved { "info" } else { "warn" }.into(), text }]);
                emit_session(&app, &updated);
                if wanted {
                    manager.start(&app, &id, prompt, model)?;
                }
                Ok(())
            });
            if let Err(err) = started {
                if let Ok(session) = store.update_session(&id, |s| {
                    s.status = SessionStatus::Error;
                    s.last_error = Some(err.to_string());
                }) {
                    manager.record(&app, &session, vec![ChatItem::Notice { level: "error".into(), text: err.to_string() }]);
                    emit_session(&app, &session);
                }
            }
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
        let cut_off = !stopped && !failed && turn.cut_off();
        // Resume once on our own; queued messages resume the conversation anyway.
        let resume = cut_off && session.pending.is_empty() && self.auto_resumed.lock().unwrap().insert(id.to_string());
        // Queued messages follow a normal finish or an "Enviar ya" interruption; after an error or
        // a plain stop they stay queued so the user decides.
        let flush = !session.pending.is_empty() && ((!stopped && !failed) || (stopped && send_now));
        let implement = self.implement_plan.lock().unwrap().remove(id) && !stopped && !failed;
        let mut notices = Vec::new();
        if stopped && send_now {
            notices.push(ChatItem::Notice { level: "info".into(), text: tr("Interrupted to send your messages.", "Interrumpida para enviar tus mensajes.") });
        } else if stopped {
            notices.push(ChatItem::Notice { level: "warn".into(), text: tr("Stopped by the user.", "Detenida por el usuario.") });
        } else if cut_off {
            let pending = if turn.background.is_empty() { String::new() } else { format!(" ({})", turn.background.join(", ")) };
            let next = if resume {
                tr(" Continuing automatically.", " Continúa automáticamente.")
            } else {
                tr(" Write “continue” to resume.", " Escribe “continúa” para retomarlo.")
            };
            notices.push(ChatItem::Notice {
                level: "warn".into(),
                text: format!(
                    "{}{pending}.{next}",
                    tr("Claude Code ended before its background work finished", "Claude Code terminó antes de que acabara su trabajo en segundo plano")
                ),
            });
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
            s.background_tasks.clear();
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
        // The approved plan runs as the next turn, out of plan mode, so it gets its worktree first.
        if implement {
            let message = PendingMessage {
                id: crate::models::new_id(),
                text: tr("Implement the approved plan (automatic)", "Implementa el plan aprobado (automático)"),
                prompt: "The user approved your plan. Implement it now.".into(),
                model: None,
                attachments: Vec::new(),
                at: Utc::now(),
            };
            let queued = store.update_session(id, |s| {
                if s.permission_mode == "plan" {
                    s.permission_mode = "acceptEdits".into();
                }
                s.pending.insert(0, message);
            });
            if queued.is_ok() && matches!(self.flush_pending(app, id), Ok(Some(_))) {
                return;
            }
        }
        if resume {
            let message = PendingMessage {
                id: crate::models::new_id(),
                text: tr("Continue (automatic)", "Continúa (automático)"),
                prompt: "Your background work (shell commands, subagents or monitors) was cut off when the previous run ended, \
                         so you never got its result. Check what actually finished, redo what did not, and complete the task."
                    .into(),
                model: None,
                attachments: Vec::new(),
                at: Utc::now(),
            };
            if let Ok(session) = store.session(id) {
                if self.dispatch(app, &session, vec![message]).is_ok() {
                    return;
                }
            }
        }
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
        while self.editing_count() < limit {
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
    /// Background tasks still running according to Claude Code's last report.
    background: Vec<String>,
    /// A result came in and Claude has not spoken since.
    after_result: bool,
    /// A background task finished after the last result, but Claude never got to act on it.
    unanswered_notification: bool,
}

impl TurnState {
    /// Claude Code exited while background work was pending or before handling its outcome:
    /// the turn ended "half way", with Claude still meaning to continue.
    fn cut_off(&self) -> bool {
        !self.background.is_empty() || self.unanswered_notification
    }
}

/// Follows background work across a run: what is still pending and whether Claude got to react
/// to the last task that finished.
fn track_background(turn: &mut TurnState, parsed: &Parsed) {
    if parsed.assistant {
        turn.after_result = false;
        turn.unanswered_notification = false;
    }
    if parsed.items.iter().any(|i| matches!(i, ChatItem::Result { .. })) {
        turn.after_result = true;
    }
    if parsed.task_notified && turn.after_result {
        turn.unanswered_notification = true;
    }
    if let Some(tasks) = &parsed.background {
        turn.background = tasks.clone();
    }
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
    if let Some(output_tokens) = parsed.output_tokens {
        let _ = app.emit_to(project_window_label(&session.project_id).as_str(), SESSION_TOKENS, TokensEvent { session_id: id, output_tokens });
    }
    track_background(turn, &parsed);
    if let Some(tasks) = parsed.background.clone() {
        if let Ok(updated) = app.state::<Store>().update_session(id, |s| s.background_tasks = tasks) {
            emit_session(app, &updated);
        }
    }
    if !parsed.rate_windows.is_empty() {
        if let Ok(account) = session_account(&app.state::<Store>(), &session) {
            app.state::<UsageService>().apply_rate_windows(app, &account.id, &parsed.rate_windows);
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
            ChatItem::Result { ok, input_tokens, output_tokens, .. } => {
                turn.result_ok = Some(*ok);
                let (input, output) = (input_tokens.unwrap_or(0), output_tokens.unwrap_or(0));
                if input + output > 0 {
                    if let Ok(updated) = app.state::<Store>().update_session(id, |s| {
                        s.input_tokens += input;
                        s.output_tokens += output;
                    }) {
                        emit_session(app, &updated);
                    }
                }
            }
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

/// The Claude account selected by a project: the one new chats start with.
pub fn project_account(store: &Store, project_id: &str) -> AppResult<crate::models::ClaudeAccount> {
    let project = store.project(project_id)?;
    let id = project.account_id.ok_or_else(|| AppError::msg("This project has no Claude account. Pick one before chatting."))?;
    store
        .read(|d| d.accounts.iter().find(|a| a.id == id).cloned())
        .ok_or_else(|| AppError::msg("The project's Claude account no longer exists. Pick another one."))
}

/// The Claude account a chat runs with: the one fixed when it was created. Chats from before
/// accounts were per chat get one pinned now (see `pin_account`).
pub fn session_account(store: &Store, session: &Session) -> AppResult<crate::models::ClaudeAccount> {
    match &session.account_id {
        Some(id) => store
            .read(|d| d.accounts.iter().find(|a| &a.id == id).cloned())
            .ok_or_else(|| AppError::msg("This chat's Claude account no longer exists. Start a new chat with another account.")),
        None => project_account(store, &session.project_id),
    }
}

/// Fixes the account of a chat that has none yet: the one its last message used (from the history),
/// else the project's. Returns the session as stored.
pub fn pin_account(store: &Store, session: &Session) -> AppResult<Session> {
    if session.account_id.is_some() {
        return Ok(session.clone());
    }
    let used = History::new(&store.dir()).read(&session.id).ok().and_then(|items| {
        items.iter().rev().find_map(|item| match item {
            ChatItem::Prompt { account: Some(alias), .. } => Some(alias.clone()),
            _ => None,
        })
    });
    let by_alias = used.and_then(|alias| store.read(|d| d.accounts.iter().find(|a| a.alias == alias).map(|a| a.id.clone())));
    let id = match by_alias {
        Some(id) => id,
        None => match project_account(store, &session.project_id) {
            Ok(account) => account.id,
            Err(_) => return Ok(session.clone()),
        },
    };
    store.update_session(&session.id, |s| s.account_id = Some(id))
}

/// Folder Claude works in for a repo: the repo itself, or the session's worktree when isolated.
pub fn working_dir(app_data: &std::path::Path, session: &Session, repo_id: &str, repo_path: &str, repo_name: &str) -> PathBuf {
    match session.mode {
        // Folders without git get no worktree (and no base branch): the session works on them directly.
        crate::models::SessionMode::Isolated if session.base_branches.contains_key(repo_id) => worktree_dir(app_data, session, repo_name),
        _ => PathBuf::from(repo_path),
    }
}

/// Scratch folder of a session created without repos.
pub fn workspace_dir(app_data: &std::path::Path, project_id: &str, session_id: &str) -> PathBuf {
    app_data.join("workspaces").join(project_id).join(session_id)
}

/// Where an isolated session keeps the worktree of a repo.
pub fn worktree_dir(app_data: &std::path::Path, session: &Session, repo_name: &str) -> PathBuf {
    app_data.join("worktrees").join(&session.project_id).join(&session.id).join(repo_name)
}

#[cfg(test)]
mod background_tests {
    use super::*;

    const RESULT: &str = r#"{"type":"result","subtype":"success","is_error":false,"result":"waiting"}"#;
    const SAY: &str = r#"{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"text","text":"FINISHED"}]}}"#;
    const NOTIFIED: &str = r#"{"type":"system","subtype":"task_notification","task_id":"b1","status":"completed"}"#;

    fn run(lines: &[&str]) -> TurnState {
        let mut turn = TurnState::default();
        for line in lines {
            track_background(&mut turn, &parse_line(line));
        }
        turn
    }

    /// Captured from `claude -p`: background bash, result, task done, Claude answers. Not cut off.
    #[test]
    fn handled_background_task_is_not_cut_off() {
        let busy = r#"{"type":"system","subtype":"background_tasks_changed","tasks":[{"task_id":"b1","task_type":"local_bash","description":"Sleep"}]}"#;
        let idle = r#"{"type":"system","subtype":"background_tasks_changed","tasks":[]}"#;
        assert!(!run(&[busy, RESULT, NOTIFIED, idle, SAY, RESULT]).cut_off());
    }

    /// Captured from `claude -p`: a subagent's task finishes after the result and the process
    /// exits without letting Claude react. That turn was left half way.
    #[test]
    fn notification_without_reply_is_cut_off() {
        let idle = r#"{"type":"system","subtype":"background_tasks_changed","tasks":[]}"#;
        assert!(run(&[RESULT, NOTIFIED, idle]).cut_off());
    }

    #[test]
    fn exit_with_pending_tasks_is_cut_off() {
        let busy = r#"{"type":"system","subtype":"background_tasks_changed","tasks":[{"task_id":"a1","task_type":"local_agent","description":"Explore"}]}"#;
        let turn = run(&[busy, RESULT]);
        assert!(turn.cut_off());
        assert_eq!(turn.background, ["Explore"]);
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
                    account_id: None,
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
        workspace: None,
        input_tokens: 0,
        output_tokens: 0,
        background_tasks: Vec::new(),
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
