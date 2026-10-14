mod commands;
mod detect;
mod error;
mod git;
mod models;
mod proc_tree;
mod process_manager;
mod pty;
mod shell_env;
mod store;
mod terminal;
mod usage;

use tauri::{Manager, RunEvent, WindowEvent};

use commands::projects::notify_projects_changed;
use commands::windows::project_id_from_label;
use process_manager::ProcessManager;
use store::Store;
use terminal::TerminalManager;
use usage::service::UsageService;

/// Builds and runs the Tauri application.
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ProcessManager::default())
        .manage(TerminalManager::default())
        .manage(UsageService::default())
        .setup(|app| {
            std::thread::spawn(|| {
                shell_env::login_env();
            });
            let dir = app.path().app_data_dir()?;
            app.manage(Store::load(dir)?);
            #[cfg(debug_assertions)]
            if let Ok(id) = std::env::var("DEVHUB_OPEN_PROJECT") {
                let handle = app.handle().clone();
                let store = app.state::<Store>();
                if let Err(err) = commands::windows::open_project_window(handle, store, id) {
                    eprintln!("DEVHUB_OPEN_PROJECT failed: {err}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                if let Some(project_id) = project_id_from_label(window.label()) {
                    window.app_handle().state::<ProcessManager>().stop_project(project_id);
                    window.app_handle().state::<TerminalManager>().close_project(project_id);
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
            commands::processes::start_command,
            commands::processes::stop_process,
            commands::processes::list_processes,
            commands::processes::process_logs,
            commands::processes::clear_process_logs,
            commands::processes::forget_process,
            commands::processes::check_port,
            commands::terminals::terminal_open,
            commands::terminals::terminal_write,
            commands::terminals::terminal_resize,
            commands::terminals::terminal_close,
            commands::usage::claude_usage,
            commands::usage::claude_usage_cached,
        ])
        .build(tauri::generate_context!())
        .expect("error while building DevHub");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle.state::<ProcessManager>().kill_all_blocking();
            handle.state::<TerminalManager>().close_all();
        }
    });
}
