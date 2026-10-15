use chrono::Utc;
use tauri::{AppHandle, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};

use crate::commands::projects::notify_projects_changed;
use crate::error::AppResult;
use crate::store::{find_project_mut, Store};

const PROJECT_LABEL_PREFIX: &str = "project-";
pub const WELCOME_LABEL: &str = "main";

/// Window label used for a project's dedicated window.
pub fn project_window_label(project_id: &str) -> String {
    format!("{PROJECT_LABEL_PREFIX}{project_id}")
}

/// Extracts the project id from a window label, if it belongs to a project window.
pub fn project_id_from_label(label: &str) -> Option<&str> {
    label.strip_prefix(PROJECT_LABEL_PREFIX)
}

/// Opens a project in its own window (or focuses it) and closes the welcome window.
#[tauri::command]
pub fn open_project_window(app: AppHandle, store: State<Store>, id: String) -> AppResult<()> {
    let project = store.project(&id)?;
    let label = project_window_label(&id);

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        window.show()?;
        window.set_focus()?;
    } else {
        let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
            .title(format!("{} — claude-storm", project.name))
            .inner_size(1360.0, 880.0)
            .min_inner_size(960.0, 640.0)
            .center();
        #[cfg(target_os = "macos")]
        let builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 22.0));
        builder.build()?;
        store.write(|d| {
            find_project_mut(d, &id)?.last_opened_at = Some(Utc::now());
            Ok(())
        })?;
    }

    if let Some(welcome) = app.get_webview_window(WELCOME_LABEL) {
        let _ = welcome.close();
    }
    notify_projects_changed(&app);
    Ok(())
}

/// Shows the welcome window, recreating it if it was closed.
pub fn show_welcome<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    if let Some(window) = app.get_webview_window(WELCOME_LABEL) {
        let _ = window.unminimize();
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }
    WebviewWindowBuilder::new(app, WELCOME_LABEL, WebviewUrl::App("index.html".into()))
        .title("Bienvenido a claude-storm")
        .inner_size(620.0, 540.0)
        .min_inner_size(520.0, 420.0)
        .center()
        .build()?;
    Ok(())
}

/// Brings the welcome window ("all projects") to the front.
#[tauri::command]
pub fn focus_welcome_window(app: AppHandle) -> AppResult<()> {
    show_welcome(&app)
}

/// True when no project window and no welcome window remain.
pub fn no_windows_left<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.webview_windows().is_empty()
}
