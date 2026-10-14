use std::collections::HashMap;
use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::usage::service::{UsageService, UsageSnapshot, UsageTarget};

/// Empty folder owned by DevHub where `/usage` is queried, so no real repo needs to be trusted.
fn probe_cwd(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().map(|d| d.join("claude-probe")).unwrap_or_else(|_| std::env::temp_dir().join("devhub-claude-probe"))
}

/// Returns plan usage for the default Claude login, refreshing when stale or forced.
#[tauri::command]
pub async fn claude_usage(
    app: AppHandle,
    usage: State<'_, UsageService>,
    project_id: Option<String>,
    force: bool,
) -> Result<UsageSnapshot, ()> {
    let target = UsageTarget {
        key: "default".into(),
        env: HashMap::new(),
        remove_env: vec!["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
        cwd: probe_cwd(&app),
        accept_trust: true,
        api_key: false,
    };
    let _ = project_id;
    Ok(usage.get(&app, target, force).await)
}

/// Returns the cached usage without triggering a query.
#[tauri::command]
pub fn claude_usage_cached(usage: State<UsageService>) -> Option<UsageSnapshot> {
    usage.cached("default")
}
