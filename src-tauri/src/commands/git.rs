use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::git::{self, GitStatus};

/// Reads the git status of a repository folder.
#[tauri::command]
pub async fn git_status(path: String) -> AppResult<GitStatus> {
    tauri::async_runtime::spawn_blocking(move || git::status(&PathBuf::from(path)))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}
