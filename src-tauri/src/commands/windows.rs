use chrono::Utc;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::commands::projects::notify_projects_changed;
use crate::error::AppResult;
use crate::store::{find_project_mut, Store};

const PROJECT_LABEL_PREFIX: &str = "project-";

/// Window label used for a project's dedicated window.
pub fn project_window_label(project_id: &str) -> String {
    format!("{PROJECT_LABEL_PREFIX}{project_id}")
}

/// Extracts the project id from a window label, if it belongs to a project window.
pub fn project_id_from_label(label: &str) -> Option<&str> {
    label.strip_prefix(PROJECT_LABEL_PREFIX)
}

/// Opens a project in its own window, or focuses it when already open.
#[tauri::command]
pub fn open_project_window(app: AppHandle, store: State<Store>, id: String) -> AppResult<()> {
    let project = store.project(&id)?;
    let label = project_window_label(&id);

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title(format!("{} — DevHub", project.name))
        .inner_size(1360.0, 880.0)
        .min_inner_size(960.0, 640.0)
        .center()
        .build()?;

    store.write(|d| {
        find_project_mut(d, &id)?.last_opened_at = Some(Utc::now());
        Ok(())
    })?;
    notify_projects_changed(&app);
    Ok(())
}

/// Brings the welcome window to the front.
#[tauri::command]
pub fn focus_welcome_window(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}
