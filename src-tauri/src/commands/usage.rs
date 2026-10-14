use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::accounts::account_env;
use crate::error::AppResult;
use crate::models::{AccountKind, ClaudeAccount};
use crate::store::Store;
use crate::usage::service::{UsageService, UsageSnapshot, UsageTarget};

/// Empty folder owned by DevHub where `/usage` is queried, so no real repo needs to be trusted.
fn probe_cwd(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().map(|d| d.join("claude-probe")).unwrap_or_else(|_| std::env::temp_dir().join("devhub-claude-probe"))
}

/// Account selected by a project, if any.
fn project_account(store: &Store, project_id: &str) -> AppResult<Option<ClaudeAccount>> {
    let project = store.project(project_id)?;
    Ok(project.account_id.and_then(|id| store.read(|d| d.accounts.iter().find(|a| a.id == id).cloned())))
}

/// Returns plan usage of the project's account, refreshing when stale or forced; None without account.
#[tauri::command]
pub async fn claude_usage(
    app: AppHandle,
    store: State<'_, Store>,
    usage: State<'_, UsageService>,
    project_id: String,
    force: bool,
) -> AppResult<Option<UsageSnapshot>> {
    let Some(account) = project_account(&store, &project_id)? else { return Ok(None) };
    let (env, remove_env) = account_env(&account)?;
    let target = UsageTarget {
        key: account.id.clone(),
        env,
        remove_env,
        cwd: probe_cwd(&app),
        accept_trust: true,
        api_key: account.kind == AccountKind::ApiKey,
    };
    Ok(Some(usage.get(&app, target, force).await))
}

/// Returns the cached usage of the project's account without querying Claude Code.
#[tauri::command]
pub fn claude_usage_cached(store: State<Store>, usage: State<UsageService>, project_id: String) -> AppResult<Option<UsageSnapshot>> {
    Ok(project_account(&store, &project_id)?.and_then(|a| usage.cached(&a.id)))
}
