use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::models::{new_id, Project, Session, SessionMode, SessionStatus};
use crate::sessions::history::History;
use crate::sessions::manager::{emit_session, working_dir, SessionManager};
use crate::sessions::stream::ChatItem;
use crate::sessions::worktree;
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

/// Repos of the project included in a session, with their working folders.
fn session_repos(store: &Store, session: &Session, project: &Project) -> Vec<(String, String, PathBuf, PathBuf)> {
    session
        .repo_ids
        .iter()
        .filter_map(|id| project.repos.iter().find(|r| &r.id == id))
        .map(|r| {
            let wd = working_dir(&store.dir(), session, &r.path, &r.name);
            (r.id.clone(), r.name.clone(), PathBuf::from(&r.path), wd)
        })
        .collect()
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
    if repo_ids.is_empty() {
        return Err(AppError::msg("Pick at least one repo"));
    }
    let now = Utc::now();
    let id = new_id();
    let mut session = Session {
        id: id.clone(),
        project_id: project_id.clone(),
        title: title.clone(),
        description: input.description.filter(|d| !d.trim().is_empty()),
        profile_id: None,
        model: input.model.filter(|m| !m.trim().is_empty()),
        permission_mode: input.permission_mode.unwrap_or_else(|| "acceptEdits".into()),
        repo_ids,
        mode: input.mode,
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
    };

    if session.mode == SessionMode::Isolated {
        let branch = format!("claude-storm/{}-{}", worktree::slugify(&title), &id[..6]);
        let repos = session_repos(&store, &session, &project);
        let branch_for_task = branch.clone();
        let bases = tauri::async_runtime::spawn_blocking(move || -> AppResult<Vec<(String, String)>> {
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
            Ok(bases)
        })
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
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

/// Edits title, description, model or permission mode.
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
        ..source.clone()
    };
    History::new(&store.dir()).copy(&source.id, &copy.id)?;
    History::new(&store.dir()).append(
        &copy.id,
        &[ChatItem::Notice { level: "info".into(), text: "Copia: el historial es visual; Claude empieza una conversación nueva.".into() }],
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
    let repos = session_repos(store, &session, &project);
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
    let message = if message.trim().is_empty() { "claude-storm session changes".to_string() } else { message };
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
    Ok((session_repos(store, &session, &project), session.branch.clone().unwrap_or_default(), session.base_branches.clone()))
}

/// Porcelain status of a folder.
fn run_porcelain(dir: &Path) -> AppResult<String> {
    Ok(crate::git::run_git(dir, &["status", "--porcelain"])?.trim().to_string())
}
