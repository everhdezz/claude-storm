mod commands;
mod detect;
mod error;
mod git;
mod models;
mod shell_env;
mod store;

use tauri::{Manager, WindowEvent};

use commands::projects::notify_projects_changed;
use commands::windows::project_id_from_label;
use store::Store;

/// Builds and runs the Tauri application.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            std::thread::spawn(|| {
                shell_env::login_env();
            });
            let dir = app.path().app_data_dir()?;
            app.manage(Store::load(dir)?);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                if project_id_from_label(window.label()).is_some() {
                    notify_projects_changed(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::create_project,
            commands::projects::rename_project,
            commands::projects::delete_project,
            commands::windows::open_project_window,
            commands::windows::focus_welcome_window,
            commands::repos::detect_repo,
            commands::repos::scan_repos,
            commands::repos::add_repos,
            commands::repos::remove_repo,
            commands::repos::update_repo,
            commands::repos::redetect_repo,
            commands::git::git_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DevHub");
}
