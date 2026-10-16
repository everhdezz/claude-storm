use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::commands::projects::notify_projects_changed;
use crate::detect::{self, Detection};
use crate::error::{AppError, AppResult};
use crate::models::{new_id, LayoutItem, Repo, RepoCommand};
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
    let added = attach_paths(&store, &project_id, &paths)?.into_iter().filter(|(_, fresh)| *fresh).map(|(r, _)| r).collect();
    notify_projects_changed(&app);
    Ok(added)
}

/// Adds folders to a project (detecting each framework) and returns the repo of every path, in
/// order, with whether it was new; a folder the project already has keeps its existing repo.
pub fn attach_paths(store: &Store, project_id: &str, paths: &[String]) -> AppResult<Vec<(Repo, bool)>> {
    let mut repos = Vec::new();
    for raw in paths {
        let path = canonical(raw)?;
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
    store.write(|data| {
        let project = find_project_mut(data, project_id)?;
        let mut out: Vec<(Repo, bool)> = Vec::new();
        for repo in repos {
            if let Some(existing) = project.repos.iter().find(|e| e.path == repo.path) {
                out.push((existing.clone(), false));
            } else {
                project.repos.push(repo.clone());
                out.push((repo, true));
            }
        }
        Ok(out)
    })
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

/// Refreshes the framework and package manager of every repo of a project, keeping its port and
/// commands. Missing folders are skipped; nothing is saved or broadcast when nothing changed.
#[tauri::command]
pub fn refresh_repo_frameworks(app: AppHandle, store: State<Store>, project_id: String) -> AppResult<()> {
    let detected: Vec<(String, Detection)> = store
        .project(&project_id)?
        .repos
        .iter()
        .filter(|r| Path::new(&r.path).is_dir())
        .map(|r| (r.id.clone(), detect::detect(Path::new(&r.path))))
        .collect();
    let changed = store.read(|data| {
        data.projects.iter().find(|p| p.id == project_id).is_some_and(|p| {
            p.repos.iter().any(|r| {
                detected
                    .iter()
                    .any(|(id, d)| *id == r.id && (r.framework != d.framework || r.package_manager != d.package_manager || (r.commands.is_empty() && !d.commands.is_empty())))
            })
        })
    });
    if !changed {
        return Ok(());
    }
    store.write(|data| {
        for repo in find_project_mut(data, &project_id)?.repos.iter_mut() {
            if let Some((_, d)) = detected.iter().find(|(id, _)| *id == repo.id) {
                repo.framework = d.framework;
                repo.package_manager = d.package_manager.clone();
                // A repo that had nothing to run (e.g. detected as generic before) gets the detected commands.
                if repo.commands.is_empty() {
                    repo.commands = d.commands.clone();
                }
            }
        }
        Ok(())
    })?;
    notify_projects_changed(&app);
    Ok(())
}

/// Saves the order and grouping of a project's repos (loose repos and one-level groups).
#[tauri::command]
pub fn save_repo_layout(app: AppHandle, store: State<Store>, project_id: String, layout: Vec<LayoutItem>) -> AppResult<()> {
    store.write(|data| {
        let project = find_project_mut(data, &project_id)?;
        project.layout = layout;
        project.layout = project.normalized_layout();
        Ok(())
    })?;
    notify_projects_changed(&app);
    Ok(())
}
