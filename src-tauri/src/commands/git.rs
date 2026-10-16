use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::git::{self, run_git, BranchList, GitStatus};

/// Runs blocking git work off the async runtime.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| AppError::msg(e.to_string()))?
}

/// Reads the git status of a repository folder.
#[tauri::command]
pub async fn git_status(path: String) -> AppResult<GitStatus> {
    blocking(move || git::status(&PathBuf::from(path))).await
}

/// Runs `git init` in a folder that is not a repository yet.
#[tauri::command]
pub async fn git_init(path: String) -> AppResult<()> {
    blocking(move || git::init(&PathBuf::from(path))).await
}

/// Lists local, remote and recent branches of a repository.
#[tauri::command]
pub async fn git_branches(path: String) -> AppResult<BranchList> {
    blocking(move || git::branches(&PathBuf::from(path))).await
}

/// Checks out a branch; a remote one gets a local tracking branch.
#[tauri::command]
pub async fn git_checkout(path: String, name: String, remote: bool) -> AppResult<()> {
    blocking(move || git::checkout(&PathBuf::from(path), &name, remote)).await
}

/// Creates a branch from `start` (or HEAD) and optionally checks it out.
#[tauri::command]
pub async fn git_create_branch(path: String, name: String, start: Option<String>, checkout: bool) -> AppResult<()> {
    blocking(move || git::create_branch(&PathBuf::from(path), name.trim(), start.as_deref(), checkout)).await
}

/// Renames a local branch.
#[tauri::command]
pub async fn git_rename_branch(path: String, from: String, to: String) -> AppResult<()> {
    blocking(move || run_git(&PathBuf::from(path), &["branch", "-m", &from, to.trim()]).map(|_| ())).await
}

/// Deletes a local branch; `force` also drops unmerged commits.
#[tauri::command]
pub async fn git_delete_branch(path: String, name: String, force: bool) -> AppResult<()> {
    blocking(move || run_git(&PathBuf::from(path), &["branch", if force { "-D" } else { "-d" }, &name]).map(|_| ())).await
}

/// Merges a branch into the current one.
#[tauri::command]
pub async fn git_merge(path: String, name: String) -> AppResult<String> {
    blocking(move || run_git(&PathBuf::from(path), &["merge", "--no-edit", &name])).await
}

/// Fetches every remote and prunes deleted branches.
#[tauri::command]
pub async fn git_fetch(path: String) -> AppResult<()> {
    blocking(move || run_git(&PathBuf::from(path), &["fetch", "--all", "--prune"]).map(|_| ())).await
}

/// Pulls the current branch, fast-forward only.
#[tauri::command]
pub async fn git_pull(path: String) -> AppResult<String> {
    blocking(move || run_git(&PathBuf::from(path), &["pull", "--ff-only"])).await
}
