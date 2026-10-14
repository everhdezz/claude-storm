use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::commands::projects::notify_projects_changed;
use crate::detect::{self, Detection};
use crate::error::{AppError, AppResult};
use crate::models::{new_id, Repo, RepoCommand};
use crate::store::{find_project_mut, Store};

/// Editable fields of a repo sent back from the UI.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoPatch {
    pub name: String,
    pub port: Option<u16>,
    pub commands: Vec<RepoCommand>,
}

/// Canonical absolute path for a user-picked folder.
fn canonical(path: &str) -> AppResult<PathBuf> {
    let p = Path::new(path);
    if !p.is_dir() {
        return Err(AppError::msg(format!("{path} is not a folder")));
    }
    Ok(p.canonicalize()?)
}

/// Folder name used as the default repo name.
fn folder_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// Detects the framework of a single folder without adding it.
#[tauri::command]
pub fn detect_repo(path: String) -> AppResult<Detection> {
    Ok(detect::detect(&canonical(&path)?))
}

/// Adds folders to a project, detecting each framework; duplicates are ignored.
#[tauri::command]
pub fn add_repos(app: AppHandle, store: State<Store>, project_id: String, paths: Vec<String>) -> AppResult<Vec<Repo>> {
    let mut repos = Vec::new();
    for raw in paths {
        let path = canonical(&raw)?;
        let d = detect::detect(&path);
        repos.push(Repo {
            id: new_id(),
            name: folder_name(&path),
            path: path.to_string_lossy().to_string(),
            framework: d.framework,
            package_manager: d.package_manager,
            port: d.port,
            commands: d.commands,
        });
    }
    let added = store.write(|data| {
        let project = find_project_mut(data, &project_id)?;
        let fresh: Vec<Repo> = repos.into_iter().filter(|r| !project.repos.iter().any(|e| e.path == r.path)).collect();
        project.repos.extend(fresh.iter().cloned());
        Ok(fresh)
    })?;
    notify_projects_changed(&app);
    Ok(added)
}

/// Removes a repo from a project (files on disk are untouched).
#[tauri::command]
pub fn remove_repo(app: AppHandle, store: State<Store>, project_id: String, repo_id: String) -> AppResult<()> {
    store.write(|data| {
        find_project_mut(data, &project_id)?.repos.retain(|r| r.id != repo_id);
        Ok(())
    })?;
    notify_projects_changed(&app);
    Ok(())
}

/// Saves the editable fields of a repo.
#[tauri::command]
pub fn update_repo(app: AppHandle, store: State<Store>, project_id: String, repo_id: String, patch: RepoPatch) -> AppResult<()> {
    let name = patch.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::msg("Repo name cannot be empty"));
    }
    store.write(|data| {
        let repo = find_project_mut(data, &project_id)?
            .repos
            .iter_mut()
            .find(|r| r.id == repo_id)
            .ok_or_else(|| AppError::NotFound(format!("repo {repo_id}")))?;
        repo.name = name;
        repo.port = patch.port;
        repo.commands = patch
            .commands
            .into_iter()
            .filter(|c| !c.command.trim().is_empty())
            .map(|c| RepoCommand { id: if c.id.is_empty() { new_id() } else { c.id }, ..c })
            .collect();
        Ok(())
    })?;
    notify_projects_changed(&app);
    Ok(())
}

/// Re-runs detection and replaces a repo's framework metadata and commands.
#[tauri::command]
pub fn redetect_repo(app: AppHandle, store: State<Store>, project_id: String, repo_id: String) -> AppResult<()> {
    store.write(|data| {
        let repo = find_project_mut(data, &project_id)?
            .repos
            .iter_mut()
            .find(|r| r.id == repo_id)
            .ok_or_else(|| AppError::NotFound(format!("repo {repo_id}")))?;
        let d = detect::detect(Path::new(&repo.path));
        repo.framework = d.framework;
        repo.package_manager = d.package_manager;
        repo.port = d.port;
        repo.commands = d.commands;
        Ok(())
    })?;
    notify_projects_changed(&app);
    Ok(())
}
