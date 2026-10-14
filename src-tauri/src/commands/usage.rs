use std::collections::HashMap;
use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::store::Store;
use crate::usage::service::{UsageService, UsageSnapshot, UsageTarget};

/// Picks a folder Claude Code already trusts: the project's first repo, else the home dir.
fn probe_cwd(store: &Store, project_id: Option<&str>) -> PathBuf {
    project_id
        .and_then(|id| store.project(id).ok())
        .and_then(|p| p.repos.first().map(|r| PathBuf::from(&r.path)))
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// Returns plan usage for the default Claude login, refreshing when stale or forced.
#[tauri::command]
pub async fn claude_usage(
    app: AppHandle,
    store: State<'_, Store>,
    usage: State<'_, UsageService>,
    project_id: Option<String>,
    force: bool,
) -> Result<UsageSnapshot, ()> {
    let target = UsageTarget {
        key: "default".into(),
        env: HashMap::new(),
        remove_env: vec!["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
        cwd: probe_cwd(&store, project_id.as_deref()),
        api_key: false,
    };
    Ok(usage.get(&app, target, force).await)
}

/// Returns the cached usage without triggering a query.
#[tauri::command]
pub fn claude_usage_cached(usage: State<UsageService>) -> Option<UsageSnapshot> {
    usage.cached("default")
}
