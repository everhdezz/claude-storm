mod accounts;
mod commands;
mod detect;
mod error;
mod git;
mod login;
mod models;
mod proc_tree;
mod process_manager;
mod profiles;
mod pty;
mod sessions;
mod shell_env;
mod store;
mod terminal;
mod usage;

use tauri::{Manager, RunEvent, WindowEvent};

use commands::projects::notify_projects_changed;
use commands::windows::{no_windows_left, project_id_from_label, show_welcome};
use process_manager::ProcessManager;
use sessions::manager::SessionManager;
use store::Store;
use login::LoginManager;
use terminal::TerminalManager;
use usage::service::UsageService;

/// Builds and runs the Tauri application.
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ProcessManager::default())
        .manage(TerminalManager::default())
        .manage(UsageService::default())
        .manage(SessionManager::default())
        .manage(LoginManager::default())
        .setup(|app| {
            std::thread::spawn(|| {
                shell_env::login_env();
            });
            let dir = app.path().app_data_dir()?;
            app.manage(Store::load(dir)?);
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let store = handle.state::<Store>();
                let stale = store.read(|d| d.settings.catalog_updated_at.is_none_or(|t| (chrono::Utc::now() - t).num_hours() >= 24));
                if stale {
                    if let Err(err) = commands::settings::refresh_catalog(&handle, &store, None).await {
                        eprintln!("model catalog refresh failed: {err}");
                    }
                }
            });
            #[cfg(debug_assertions)]
            if let Ok(id) = std::env::var("CLAUDE_STORM_OPEN_PROJECT") {
                let handle = app.handle().clone();
                let store = app.state::<Store>();
                if let Err(err) = commands::windows::open_project_window(handle, store, id) {
                    eprintln!("CLAUDE_STORM_OPEN_PROJECT failed: {err}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                if let Some(project_id) = project_id_from_label(window.label()) {
                    window.app_handle().state::<ProcessManager>().stop_project(project_id);
                    window.app_handle().state::<TerminalManager>().close_project(project_id);
                    window.app_handle().state::<SessionManager>().stop_project(window.app_handle(), project_id);
                    notify_projects_changed(window.app_handle());
                    if no_windows_left(window.app_handle()) {
                        let _ = show_welcome(window.app_handle());
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::create_project,
            commands::projects::rename_project,
            commands::projects::delete_project,
            commands::projects::save_project_ui_state,
            commands::windows::open_project_window,
            commands::windows::focus_welcome_window,
            commands::repos::detect_repo,
            commands::repos::add_repos,
            commands::repos::remove_repo,
            commands::repos::update_repo,
            commands::repos::redetect_repo,
            commands::repos::save_repo_layout,
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
            commands::usage::account_usage,
            commands::profiles::create_profile_account,
            commands::profiles::prepare_profile,
            commands::profiles::start_profile_login,
            commands::profiles::submit_login_code,
            commands::profiles::reopen_login_url,
            commands::profiles::cancel_profile_login,
            commands::profiles::verify_profile,
            commands::profiles::profile_status,
            commands::profiles::resync_profile,
            commands::sessions::list_sessions,
            commands::sessions::create_session,
            commands::sessions::session_history,
            commands::sessions::send_session_prompt,
            commands::sessions::stop_session,
            commands::sessions::update_session,
            commands::sessions::duplicate_session,
            commands::sessions::archive_session,
            commands::sessions::delete_session,
            commands::sessions::session_diff,
            commands::sessions::session_commit,
            commands::sessions::session_merge,
            commands::sessions::session_remove_worktrees,
            commands::settings::get_settings,
            commands::settings::create_account,
            commands::settings::update_account,
            commands::settings::delete_account,
            commands::settings::set_model_enabled,
            commands::settings::set_default_model,
            commands::settings::refresh_model_catalog,
            commands::settings::set_max_parallel_sessions,
            commands::settings::set_project_account,
            commands::settings::set_project_color,
        ])
        .build(tauri::generate_context!())
        .expect("error while building claude-storm");

    app.run(|handle, event| {
        if let RunEvent::ExitRequested { code: None, api, .. } = &event {
            if !no_windows_left(handle) {
                api.prevent_exit();
            }
        }
        if let RunEvent::Exit = event {
            handle.state::<ProcessManager>().kill_all_blocking();
            handle.state::<TerminalManager>().close_all();
            handle.state::<SessionManager>().kill_all();
            handle.state::<LoginManager>().cancel_all();
        }
    });
}
