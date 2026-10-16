use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::process_manager::{port_in_use, LogLine, ProcessInfo, ProcessManager, SpawnRequest};
use crate::models::{Session, SessionMode};
use crate::sessions::manager::working_dir;
use crate::store::Store;

/// Starts one of a repo's configured commands.
#[tauri::command]
pub async fn start_command(
    app: AppHandle,
    store: State<'_, Store>,
    manager: State<'_, ProcessManager>,
    project_id: String,
    repo_id: String,
    command_id: String,
    session_id: Option<String>,
) -> AppResult<ProcessInfo> {
    let session = session_id.map(|id| store.session(&id)).transpose()?;
    spawn_repo_command(&app, &store, &manager, &project_id, &repo_id, &command_id, session.as_ref(), None)
}

/// Launches a repo command. It runs inside `session`'s worktree when the session is isolated and
/// includes the repo, otherwise in the main checkout. `started_by` marks processes Claude launched.
#[allow(clippy::too_many_arguments)]
pub fn spawn_repo_command<R: tauri::Runtime>(
    app: &AppHandle<R>,
    store: &Store,
    manager: &ProcessManager,
    project_id: &str,
    repo_id: &str,
    command_id: &str,
    session: Option<&Session>,
    started_by: Option<String>,
) -> AppResult<ProcessInfo> {
    let project = store.project(project_id)?;
    let repo = project.repos.iter().find(|r| r.id == repo_id).ok_or_else(|| AppError::NotFound(format!("repo {repo_id}")))?;
    let command = repo
        .commands
        .iter()
        .find(|c| c.id == command_id)
        .ok_or_else(|| AppError::NotFound(format!("command {command_id}")))?;
    let session = session.filter(|s| s.mode == SessionMode::Isolated && s.repo_ids.contains(&repo.id));
    let cwd = match session {
        Some(s) => {
            let wd = working_dir(&store.dir(), s, &repo.id, &repo.path, &repo.name);
            if !wd.exists() {
                return Err(AppError::msg(format!("The worktree of \"{}\" no longer exists.", s.title)));
            }
            wd.to_string_lossy().to_string()
        }
        None => repo.path.clone(),
    };
    manager.spawn(
        app,
        SpawnRequest {
            project_id: project_id.to_string(),
            repo_id: repo.id.clone(),
            command_id: command.id.clone(),
            label: command.label.clone(),
            command: command.command.clone(),
            cwd,
            session_id: session.map(|s| s.id.clone()),
            started_by,
            long_running: command.long_running,
            port: repo.port,
        },
    )
}

/// Stops a running process and its whole tree.
#[tauri::command]
pub async fn stop_process(app: AppHandle, manager: State<'_, ProcessManager>, process_id: String) -> AppResult<()> {
    manager.stop(&app, &process_id).await
}

/// Lists processes started from a project.
#[tauri::command]
pub fn list_processes(manager: State<ProcessManager>, project_id: String) -> Vec<ProcessInfo> {
    manager.list(&project_id)
}

/// Returns buffered log lines of a process.
#[tauri::command]
pub fn process_logs(manager: State<ProcessManager>, process_id: String) -> Vec<LogLine> {
    manager.logs(&process_id)
}

/// Clears the log buffer of a process.
#[tauri::command]
pub fn clear_process_logs(manager: State<ProcessManager>, process_id: String) {
    manager.clear_logs(&process_id);
}

/// Removes a finished process from the list.
#[tauri::command]
pub fn forget_process(manager: State<ProcessManager>, process_id: String) {
    manager.forget(&process_id);
}

/// Checks whether a TCP port is already taken on this machine.
#[tauri::command]
pub async fn check_port(port: u16) -> bool {
    tauri::async_runtime::spawn_blocking(move || port_in_use(port)).await.unwrap_or(false)
}
