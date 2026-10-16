use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::i18n::tr;
use crate::models::{new_id, PendingMessage, Project, Session, SessionMode, SessionStatus};
use crate::sessions::history::History;
use crate::sessions::manager::{emit_session, working_dir, SessionManager};
use crate::sessions::stream::ChatItem;
use crate::sessions::{prepare, worktree};
use crate::store::Store;

/// Fields of the "new session" form.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSession {
    pub title: String,
    pub description: Option<String>,
    pub repo_ids: Vec<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub mode: SessionMode,
}

/// Editable fields of an existing session.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    pub title: Option<String>,
    pub description: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    /// Forget what the user allowed "always" in this session.
    #[serde(default)]
    pub clear_allowed_tools: bool,
}

/// What to do with an isolated session's worktrees when archiving or deleting it.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WorktreeCleanup {
    Keep,
    RemoveWorktree,
    RemoveWorktreeAndBranch,
}

/// Diff of one repo of an isolated session.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoDiff {
    pub repo_id: String,
    pub repo_name: String,
    pub base: String,
    pub diff: String,
}

/// Folder a session works in for one repo.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFolder {
    pub repo_id: String,
    pub repo_name: String,
    pub path: String,
    pub exists: bool,
}

/// Repos of the project included in a session, with their working folders.
fn session_repos(store: &Store, session: &Session, project: &Project) -> Vec<(String, String, PathBuf, PathBuf)> {
    session
        .repo_ids
        .iter()
        .filter_map(|id| project.repos.iter().find(|r| &r.id == id))
        .map(|r| {
            let wd = working_dir(&store.dir(), session, &r.id, &r.path, &r.name);
            (r.id.clone(), r.name.clone(), PathBuf::from(&r.path), wd)
        })
        .collect()
}

/// Keeps the repos that got a worktree (folders without git are worked on directly and have none).
fn with_worktree(session: &Session, repos: Vec<(String, String, PathBuf, PathBuf)>) -> Vec<(String, String, PathBuf, PathBuf)> {
    repos.into_iter().filter(|(id, ..)| session.base_branches.contains_key(id)).collect()
}

/// Lists the sessions of a project, newest activity first.
#[tauri::command]
pub fn list_sessions(store: State<Store>, project_id: String) -> Vec<Session> {
    let mut list: Vec<Session> = store.read(|d| d.sessions.iter().filter(|s| s.project_id == project_id).cloned().collect());
    list.sort_by(|a, b| b.last_activity_at.cmp(&a.last_activity_at));
    list
}

/// Creates a session; isolated sessions get one worktree + branch per repo.
#[tauri::command]
pub async fn create_session(app: AppHandle, store: State<'_, Store>, project_id: String, input: NewSession) -> AppResult<Session> {
    let project = store.project(&project_id)?;
    let title = input.title.trim().chars().take(120).collect::<String>();
    if title.is_empty() {
        return Err(AppError::msg("Session title cannot be empty"));
    }
    let repo_ids: Vec<String> = input.repo_ids.into_iter().filter(|id| project.repos.iter().any(|r| &r.id == id)).collect();
    let now = Utc::now();
    let id = new_id();
    // Without repos the session chats from its own scratch folder; repos can be attached later (MCP).
    let workspace = repo_ids.is_empty().then(|| {
        let dir = crate::sessions::manager::workspace_dir(&store.dir(), &project_id, &id);
        dir.to_string_lossy().to_string()
    });
    if let Some(dir) = &workspace {
        std::fs::create_dir_all(dir)?;
    }
    // Nothing to isolate yet: worktrees only exist for repos picked at creation.
    let mode = if workspace.is_some() { SessionMode::Direct } else { input.mode };
    let mut session = Session {
        id: id.clone(),
        project_id: project_id.clone(),
        title: title.clone(),
        description: input.description.filter(|d| !d.trim().is_empty()),
        profile_id: None,
        model: input.model.filter(|m| !m.trim().is_empty()),
        permission_mode: input.permission_mode.unwrap_or_else(|| "acceptEdits".into()),
        repo_ids,
        mode,
        branch: None,
        status: SessionStatus::Idle,
        claude_session_id: uuid::Uuid::new_v4().to_string(),
        has_conversation: false,
        created_at: now,
        last_activity_at: now,
        summary: None,
        files_touched: Vec::new(),
        archived: false,
        last_error: None,
        base_branches: Default::default(),
        last_model: None,
        pending: Vec::new(),
        approvals: Vec::new(),
        allowed_tools: Vec::new(),
        workspace,
    };

    if session.mode == SessionMode::Isolated {
        let branch = format!("{}-{}", worktree::slugify(&title), &id[..6]);
        // Folders without git are used as they are; only repositories get a worktree.
        let app_data = store.dir();
        let repos: Vec<(String, String, PathBuf, PathBuf)> = project
            .repos
            .iter()
            .filter(|r| session.repo_ids.contains(&r.id) && crate::git::is_repo(Path::new(&r.path)))
            .map(|r| (r.id.clone(), r.name.clone(), PathBuf::from(&r.path), crate::sessions::manager::worktree_dir(&app_data, &session, &r.name)))
            .collect();
        let branch_for_task = branch.clone();
        let (bases, notes) = tauri::async_runtime::spawn_blocking(move || -> AppResult<(Vec<(String, String)>, Vec<String>)> {
            let mut created: Vec<(PathBuf, PathBuf)> = Vec::new();
            let mut bases = Vec::new();
            for (repo_id, _, repo_path, wt) in &repos {
                let result = worktree::current_branch(repo_path).and_then(|base| {
                    worktree::add(repo_path, wt, &branch_for_task)?;
                    Ok(base)
                });
                match result {
                    Ok(base) => {
                        created.push((repo_path.clone(), wt.clone()));
                        bases.push((repo_id.clone(), base));
                    }
                    Err(err) => {
                        for (repo, wt) in &created {
                            let _ = worktree::remove(repo, wt, &branch_for_task, true);
                        }
                        return Err(err);
                    }
                }
            }
            // Every worktree exists now; make each one runnable (env files, cloned dependencies).
            let notes = created
                .iter()
                .zip(&repos)
                .filter_map(|((repo, wt), (_, name, _, _))| prepare::prepare(repo, wt).summary(name))
                .collect();
            Ok((bases, notes))
        })
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
        if !notes.is_empty() {
            let text = format!("{}\n{}", tr("Worktree ready.", "Worktree preparado."), notes.join("\n"));
            let _ = History::new(&store.dir()).append(&id, &[ChatItem::Notice { level: "info".into(), text }]);
        }
        session.branch = Some(branch);
        session.base_branches = bases.into_iter().collect();
    }

    let created = session.clone();
    store.write(|d| {
        d.sessions.push(session);
        Ok(())
    })?;
    emit_session(&app, &created);
    Ok(created)
}

/// Returns the stored conversation of a session.
#[tauri::command]
pub fn session_history(store: State<Store>, session_id: String) -> AppResult<Vec<ChatItem>> {
    History::new(&store.dir()).read(&session_id)
}

/// Sends a prompt to a session (resuming its Claude conversation).
#[tauri::command]
pub async fn send_session_prompt(
    app: AppHandle,
    manager: State<'_, SessionManager>,
    session_id: String,
    prompt: String,
    model: Option<String>,
    attachments: Option<Vec<String>>,
) -> AppResult<Session> {
    let attachments = attachments.unwrap_or_default();
    if prompt.trim().is_empty() && attachments.is_empty() {
        return Err(AppError::msg("Prompt is empty"));
    }
    let prompt = if prompt.trim().is_empty() { "Revisa los archivos adjuntos.".to_string() } else { prompt };
    manager.send(&app, &session_id, prompt, model.filter(|m| !m.trim().is_empty()), attachments)
}

/// Stops a working or queued session.
#[tauri::command]
pub async fn stop_session(app: AppHandle, manager: State<'_, SessionManager>, session_id: String) -> AppResult<()> {
    manager.stop(&app, &session_id).await
}

/// Edits title, description, model or permission mode, or forgets the "always allow" rules.
#[tauri::command]
pub fn update_session(app: AppHandle, store: State<Store>, session_id: String, patch: SessionPatch) -> AppResult<Session> {
    let updated = store.update_session(&session_id, |s| {
        if let Some(title) = patch.title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
            s.title = title;
        }
        if let Some(description) = patch.description {
            s.description = Some(description).filter(|d| !d.trim().is_empty());
        }
        if let Some(model) = patch.model {
            s.model = Some(model).filter(|m| !m.trim().is_empty());
        }
        if let Some(mode) = patch.permission_mode {
            s.permission_mode = mode;
        }
        if patch.clear_allowed_tools {
            s.allowed_tools.clear();
        }
    })?;
    emit_session(&app, &updated);
    Ok(updated)
}

/// Copies a session (settings and history) into a new one that continues from a fork of the conversation.
#[tauri::command]
pub fn duplicate_session(app: AppHandle, store: State<Store>, session_id: String) -> AppResult<Session> {
    let source = store.session(&session_id)?;
    if source.mode == SessionMode::Isolated {
        return Err(AppError::msg("Isolated sessions cannot be duplicated; create a new one instead."));
    }
    let now = Utc::now();
    let copy = Session {
        id: new_id(),
        title: format!("{} (copia)", source.title),
        status: SessionStatus::Idle,
        claude_session_id: uuid::Uuid::new_v4().to_string(),
        has_conversation: false,
        created_at: now,
        last_activity_at: now,
        files_touched: Vec::new(),
        archived: false,
        last_error: None,
        last_model: None,
        pending: Vec::new(),
        approvals: Vec::new(),
        allowed_tools: Vec::new(),
        ..source.clone()
    };
    History::new(&store.dir()).copy(&source.id, &copy.id)?;
    History::new(&store.dir()).append(
        &copy.id,
        &[ChatItem::Notice { level: "info".into(), text: tr("Copy: the history is only visual; Claude starts a new conversation.", "Copia: el historial es visual; Claude empieza una conversación nueva.") }],
    )?;
    let created = copy.clone();
    store.write(|d| {
        d.sessions.push(copy);
        Ok(())
    })?;
    emit_session(&app, &created);
    Ok(created)
}

/// Archives or restores a session, optionally cleaning its worktrees.
#[tauri::command]
pub async fn archive_session(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, SessionManager>,
    session_id: String,
    archived: bool,
    cleanup: Option<WorktreeCleanup>,
) -> AppResult<Session> {
    if archived {
        manager.stop(&app, &session_id).await?;
        cleanup_worktrees(&store, &session_id, cleanup.unwrap_or(WorktreeCleanup::Keep)).await?;
    }
    let updated = store.update_session(&session_id, |s| {
        s.archived = archived;
        if matches!(s.status, SessionStatus::Working | SessionStatus::Queued) {
            s.status = SessionStatus::Interrupted;
        }
    })?;
    emit_session(&app, &updated);
    Ok(updated)
}

/// Deletes a session, its history and (optionally) its worktrees.
#[tauri::command]
pub async fn delete_session(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, SessionManager>,
    session_id: String,
    cleanup: Option<WorktreeCleanup>,
) -> AppResult<()> {
    manager.stop(&app, &session_id).await?;
    cleanup_worktrees(&store, &session_id, cleanup.unwrap_or(WorktreeCleanup::RemoveWorktree)).await?;
    let session = store.session(&session_id)?;
    store.write(|d| {
        d.sessions.retain(|s| s.id != session_id);
        Ok(())
    })?;
    History::new(&store.dir()).remove(&session_id);
    let _ = std::fs::remove_dir_all(store.dir().join("sessions").join(&session_id));
    let _ = tauri::Emitter::emit_to(
        &app,
        crate::commands::windows::project_window_label(&session.project_id).as_str(),
        "session-deleted",
        &session_id,
    );
    Ok(())
}

/// Removes worktrees (and branches) of an isolated session according to the user's choice.
async fn cleanup_worktrees(store: &Store, session_id: &str, cleanup: WorktreeCleanup) -> AppResult<()> {
    let session = store.session(session_id)?;
    if session.mode != SessionMode::Isolated || cleanup == WorktreeCleanup::Keep {
        return Ok(());
    }
    let project = store.project(&session.project_id)?;
    let repos = with_worktree(&session, session_repos(store, &session, &project));
    let branch = session.branch.clone().unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || -> AppResult<()> {
        for (_, _, repo, wt) in repos {
            worktree::remove(&repo, &wt, &branch, cleanup == WorktreeCleanup::RemoveWorktreeAndBranch)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

/// Sends the session's queued messages now, interrupting Claude's current turn if needed.
#[tauri::command]
pub async fn session_send_now(app: AppHandle, manager: State<'_, SessionManager>, session_id: String) -> AppResult<()> {
    manager.send_now(&app, &session_id).await
}

/// Removes a queued message; returns it so the UI can put it back in the composer.
#[tauri::command]
pub fn session_remove_pending(
    app: AppHandle,
    manager: State<SessionManager>,
    session_id: String,
    message_id: String,
) -> AppResult<Option<PendingMessage>> {
    manager.remove_pending(&app, &session_id, &message_id)
}

/// Answers a permission prompt or AskUserQuestion that Claude is waiting on.
#[tauri::command]
pub fn session_answer_approval(
    app: AppHandle,
    store: State<Store>,
    mcp: State<crate::mcp::McpState>,
    session_id: String,
    approval_id: String,
    decision: crate::mcp::tools::ApprovalDecision,
) -> AppResult<()> {
    if mcp.answer(&approval_id, decision) {
        return Ok(());
    }
    // Nothing is waiting (Claude already stopped): just drop the stale card.
    let updated = store.update_session(&session_id, |s| s.approvals.retain(|a| a.id != approval_id))?;
    emit_session(&app, &updated);
    Err(AppError::msg("Claude is no longer waiting for this answer."))
}

/// Saves a file pasted from the clipboard (raw bytes; name in the `x-file-name` header) and
/// returns its path, so it can be attached like a picked or dropped file.
#[tauri::command]
pub fn save_pasted_file(store: State<Store>, request: tauri::ipc::Request) -> AppResult<String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::msg("Expected the file's raw bytes"));
    };
    let raw_name = request.headers().get("x-file-name").and_then(|v| v.to_str().ok()).unwrap_or("pegado");
    let name = pasted_file_name(&percent_decode(raw_name));
    let dir = store.dir().join("pasted").join(new_id());
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(name);
    std::fs::write(&path, bytes)?;
    Ok(path.to_string_lossy().to_string())
}

/// Keeps only the file name part, without separators, so it cannot escape the target folder.
fn pasted_file_name(raw: &str) -> String {
    let name = raw.rsplit(['/', '\\']).next().unwrap_or_default().trim().trim_start_matches('.');
    if name.is_empty() { "pegado".into() } else { name.chars().take(120).collect() }
}

/// Decodes `encodeURIComponent` output (header values must be ASCII).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Working folders of a session: its worktrees when isolated, the repos themselves otherwise.
#[tauri::command]
pub fn session_folders(store: State<Store>, session_id: String) -> AppResult<Vec<SessionFolder>> {
    let session = store.session(&session_id)?;
    let project = store.project(&session.project_id)?;
    Ok(session_repos(&store, &session, &project)
        .into_iter()
        .map(|(repo_id, repo_name, _, wd)| SessionFolder { repo_id, repo_name, exists: wd.exists(), path: wd.to_string_lossy().to_string() })
        .collect())
}

/// Diff of every repo of an isolated session against its base branch.
#[tauri::command]
pub async fn session_diff(store: State<'_, Store>, session_id: String) -> AppResult<Vec<RepoDiff>> {
    let session = store.session(&session_id)?;
    let project = store.project(&session.project_id)?;
    let repos = session_repos(&store, &session, &project);
    let bases = session.base_branches.clone();
    let isolated = session.mode == SessionMode::Isolated;
    tauri::async_runtime::spawn_blocking(move || {
        repos
            .into_iter()
            .filter(|(_, _, _, wd)| crate::git::is_repo(wd))
            .map(|(repo_id, repo_name, _, wd)| {
                let base = if isolated { bases.get(&repo_id).cloned().unwrap_or_else(|| "HEAD".into()) } else { "HEAD".into() };
                let diff = worktree::diff(&wd, &base)?;
                Ok(RepoDiff { repo_id, repo_name, base, diff })
            })
            .collect()
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

/// Commits all changes in an isolated session's worktrees.
#[tauri::command]
pub async fn session_commit(store: State<'_, Store>, session_id: String, message: String) -> AppResult<Vec<String>> {
    let (repos, _, _) = isolated_parts(&store, &session_id)?;
    let message = if message.trim().is_empty() { "ClaudeStorm session changes".to_string() } else { message };
    tauri::async_runtime::spawn_blocking(move || {
        let mut committed = Vec::new();
        for (_, name, _, wt) in repos {
            if worktree::commit(&wt, &message)? {
                committed.push(name);
            }
        }
        Ok(committed)
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

/// Merges an isolated session's branch into each repo's base branch.
#[tauri::command]
pub async fn session_merge(store: State<'_, Store>, session_id: String) -> AppResult<Vec<String>> {
    let (repos, branch, bases) = isolated_parts(&store, &session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut merged = Vec::new();
        for (repo_id, name, repo, wt) in repos {
            if !run_porcelain(&wt)?.is_empty() {
                return Err(AppError::msg(format!("{name} has uncommitted changes in the session; commit them first.")));
            }
            let base = bases.get(&repo_id).cloned().unwrap_or_else(|| "main".into());
            worktree::merge(&repo, &base, &branch)?;
            merged.push(format!("{name} → {base}"));
        }
        Ok(merged)
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

/// Removes an isolated session's worktrees (keeping or deleting the branch).
#[tauri::command]
pub async fn session_remove_worktrees(app: AppHandle, store: State<'_, Store>, session_id: String, delete_branch: bool) -> AppResult<()> {
    let cleanup = if delete_branch { WorktreeCleanup::RemoveWorktreeAndBranch } else { WorktreeCleanup::RemoveWorktree };
    cleanup_worktrees(&store, &session_id, cleanup).await?;
    let updated = store.update_session(&session_id, |s| s.archived = true)?;
    emit_session(&app, &updated);
    Ok(())
}

/// Repos, branch and base branches of an isolated session.
#[allow(clippy::type_complexity)]
fn isolated_parts(
    store: &Store,
    session_id: &str,
) -> AppResult<(Vec<(String, String, PathBuf, PathBuf)>, String, std::collections::HashMap<String, String>)> {
    let session = store.session(session_id)?;
    if session.mode != SessionMode::Isolated {
        return Err(AppError::msg("Only isolated sessions have their own branch."));
    }
    let project = store.project(&session.project_id)?;
    Ok((with_worktree(&session, session_repos(store, &session, &project)), session.branch.clone().unwrap_or_default(), session.base_branches.clone()))
}

/// Porcelain status of a folder.
fn run_porcelain(dir: &Path) -> AppResult<String> {
    Ok(crate::git::run_git(dir, &["status", "--porcelain"])?.trim().to_string())
}

#[cfg(test)]
mod paste_tests {
    use super::*;

    #[test]
    fn sanitizes_pasted_names() {
        assert_eq!(pasted_file_name(&percent_decode("Captura%20de%20pantalla.png")), "Captura de pantalla.png");
        assert_eq!(pasted_file_name("../../etc/passwd"), "passwd");
        assert_eq!(pasted_file_name("..\\x.txt"), "x.txt");
        assert_eq!(pasted_file_name(".."), "pegado");
        assert_eq!(percent_decode("%C3%B1and%C3%BA"), "ñandú");
        assert_eq!(percent_decode("a%2"), "a%2");
    }
}
