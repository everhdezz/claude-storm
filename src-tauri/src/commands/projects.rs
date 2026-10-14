use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::windows::project_window_label;
use crate::error::{AppError, AppResult};
use crate::models::{common_root, new_id, Project, ProjectSummary};
use crate::store::{find_project_mut, Store};

/// Event broadcast to every window whenever the project list changes.
pub const PROJECTS_CHANGED: &str = "projects-changed";

/// Notifies all windows that project data changed.
pub fn notify_projects_changed(app: &AppHandle) {
    let _ = app.emit(PROJECTS_CHANGED, ());
}

/// Validates and trims a project name.
fn clean_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::msg("Project name cannot be empty"));
    }
    Ok(trimmed.to_string())
}

/// Lists every project, most recently opened first.
#[tauri::command]
pub fn list_projects(app: AppHandle, store: State<Store>) -> Vec<ProjectSummary> {
    let mut rows: Vec<ProjectSummary> = store.read(|d| {
        d.projects
            .iter()
            .map(|p| ProjectSummary {
                id: p.id.clone(),
                name: p.name.clone(),
                repo_count: p.repos.len(),
                root_hint: common_root(&p.repos.iter().map(|r| r.path.as_str()).collect::<Vec<_>>()),
                created_at: p.created_at,
                last_opened_at: p.last_opened_at,
                is_open: app.get_webview_window(&project_window_label(&p.id)).is_some(),
            })
            .collect()
    });
    rows.sort_by(|a, b| {
        b.last_opened_at
            .unwrap_or(b.created_at)
            .cmp(&a.last_opened_at.unwrap_or(a.created_at))
    });
    rows
}

/// Returns a full project including its repos.
#[tauri::command]
pub fn get_project(store: State<Store>, id: String) -> AppResult<Project> {
    store.project(&id)
}

/// Creates an empty project.
#[tauri::command]
pub fn create_project(app: AppHandle, store: State<Store>, name: String) -> AppResult<Project> {
    let name = clean_name(&name)?;
    let project = Project {
        id: new_id(),
        name,
        created_at: Utc::now(),
        last_opened_at: None,
        repos: Vec::new(),
    };
    let created = project.clone();
    store.write(|d| {
        d.projects.push(project);
        Ok(())
    })?;
    notify_projects_changed(&app);
    Ok(created)
}

/// Renames a project and updates its window title if it is open.
#[tauri::command]
pub fn rename_project(app: AppHandle, store: State<Store>, id: String, name: String) -> AppResult<()> {
    let name = clean_name(&name)?;
    store.write(|d| {
        find_project_mut(d, &id)?.name = name.clone();
        Ok(())
    })?;
    if let Some(window) = app.get_webview_window(&project_window_label(&id)) {
        let _ = window.set_title(&format!("{name} — DevHub"));
    }
    notify_projects_changed(&app);
    Ok(())
}

/// Removes a project record (never touches files on disk) and closes its window.
#[tauri::command]
pub fn delete_project(app: AppHandle, store: State<Store>, id: String) -> AppResult<()> {
    store.write(|d| {
        let before = d.projects.len();
        d.projects.retain(|p| p.id != id);
        if d.projects.len() == before {
            return Err(AppError::NotFound(format!("project {id}")));
        }
        Ok(())
    })?;
    if let Some(window) = app.get_webview_window(&project_window_label(&id)) {
        let _ = window.destroy();
    }
    notify_projects_changed(&app);
    Ok(())
}
