use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::accounts::{account_env, profile_dir};
use crate::commands::settings::broadcast;
use crate::error::{AppError, AppResult};
use crate::login::LoginManager;
use crate::models::{new_id, AccountKind, ClaudeAccount};
use crate::profiles::sync_shared_config;
use crate::store::Store;

/// Step 1 of the wizard.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProfile {
    pub alias: String,
    pub default_model: Option<String>,
}

/// Result of checking a profile with Claude Code itself.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCheck {
    pub logged_in: bool,
    pub auth_method: Option<String>,
    pub email: Option<String>,
    pub subscription: Option<String>,
    pub reply_ok: Option<bool>,
    pub details: String,
}

/// Finds an account by id.
fn find_account(store: &Store, id: &str) -> AppResult<ClaudeAccount> {
    store.read(|d| d.accounts.iter().find(|a| a.id == id).cloned()).ok_or_else(|| AppError::NotFound(format!("account {id}")))
}

/// Runs `claude <args>` with a profile's environment and returns (exit ok, stdout, stderr).
async fn run_claude(store: &Store, account: &ClaudeAccount, args: Vec<String>) -> AppResult<(bool, String, String)> {
    let (env, removed) = account_env(account, &store.dir())?;
    let cwd = store.dir().join("claude-probe");
    tauri::async_runtime::spawn_blocking(move || {
        let claude = crate::shell_env::which("claude").ok_or_else(|| AppError::msg("The `claude` CLI was not found in PATH."))?;
        std::fs::create_dir_all(&cwd)?;
        let mut cmd = crate::shell_env::command(&claude.to_string_lossy());
        for var in removed {
            cmd.env_remove(var);
        }
        let out = cmd.envs(&env).args(&args).current_dir(&cwd).stdin(std::process::Stdio::null()).output()?;
        Ok((
            out.status.success(),
            String::from_utf8_lossy(&out.stdout).to_string(),
            String::from_utf8_lossy(&out.stderr).to_string(),
        ))
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

/// Reads `claude auth status --json` for an account (no credentials are read by claude-storm).
async fn auth_status(store: &Store, account: &ClaudeAccount) -> AppResult<Value> {
    let (_, stdout, stderr) = run_claude(store, account, vec!["auth".into(), "status".into(), "--json".into()]).await?;
    serde_json::from_str(stdout.trim()).map_err(|_| AppError::msg(format!("Unexpected `claude auth status` output: {}", stderr.trim())))
}

/// Picks a string field from the status JSON, trying several possible names.
fn pick(v: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_str).map(str::to_string))
}

/// Step 1: registers a profile account (still without login).
#[tauri::command]
pub fn create_profile_account(app: AppHandle, store: State<Store>, input: NewProfile) -> AppResult<ClaudeAccount> {
    let alias = input.alias.trim().to_string();
    if alias.is_empty() {
        return Err(AppError::msg("Alias cannot be empty"));
    }
    let account = ClaudeAccount {
        id: new_id(),
        alias,
        kind: AccountKind::Profile,
        token_hint: None,
        default_model: input.default_model.filter(|m| !m.trim().is_empty()),
        created_at: Utc::now(),
        login_email: None,
        needs_login: true,
    };
    let created = account.clone();
    store.write(|d| {
        d.accounts.push(account);
        Ok(())
    })?;
    broadcast(&app, &store);
    Ok(created)
}

/// Step 2: creates the profile folder and copies the shared (non-secret) Claude Code config.
#[tauri::command]
pub async fn prepare_profile(store: State<'_, Store>, account_id: String) -> AppResult<Vec<String>> {
    let dir = profile_dir(&store.dir(), &account_id);
    let home = dirs::home_dir().ok_or_else(|| AppError::msg("No home directory"))?;
    tauri::async_runtime::spawn_blocking(move || sync_shared_config(&home.join(".claude"), &home.join(".claude.json"), &dir))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

/// Step 3: starts `claude auth login` in a hidden PTY for the profile.
#[tauri::command]
pub fn start_profile_login(app: AppHandle, store: State<Store>, logins: State<LoginManager>, account_id: String) -> AppResult<String> {
    let account = find_account(&store, &account_id)?;
    if account.kind != AccountKind::Profile {
        return Err(AppError::msg("Only subscription profiles log in through the wizard."));
    }
    let dir = profile_dir(&store.dir(), &account_id);
    std::fs::create_dir_all(&dir)?;
    logins.start(&app, &account_id, &dir, &store.dir())
}

/// Step 4: types the authorization code the browser showed.
#[tauri::command]
pub fn submit_login_code(logins: State<LoginManager>, login_id: String, code: String) -> AppResult<()> {
    if code.trim().is_empty() {
        return Err(AppError::msg("Paste the code first."));
    }
    logins.submit_code(&login_id, &code)
}

/// Opens the authorization URL again.
#[tauri::command]
pub fn reopen_login_url(app: AppHandle, logins: State<LoginManager>, login_id: String) -> AppResult<()> {
    let url = logins.url(&login_id).ok_or_else(|| AppError::msg("The login is no longer running."))?;
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::msg(e.to_string()))
}

/// Cancels the hidden login; `discard` also deletes a profile that never logged in.
#[tauri::command]
pub async fn cancel_profile_login(
    app: AppHandle,
    store: State<'_, Store>,
    logins: State<'_, LoginManager>,
    login_id: Option<String>,
    account_id: String,
    discard: bool,
) -> AppResult<()> {
    if let Some(id) = login_id {
        logins.cancel(&id);
    }
    if discard {
        let account = find_account(&store, &account_id)?;
        remove_profile(&store, &account).await;
        store.write(|d| {
            d.accounts.retain(|a| a.id != account_id);
            Ok(())
        })?;
        broadcast(&app, &store);
    }
    Ok(())
}

/// Step 5: confirms with Claude Code that the profile is logged in with a subscription and answers.
#[tauri::command]
pub async fn verify_profile(app: AppHandle, store: State<'_, Store>, account_id: String) -> AppResult<ProfileCheck> {
    let account = find_account(&store, &account_id)?;
    let status = auth_status(&store, &account).await?;
    let logged_in = status.get("loggedIn").and_then(Value::as_bool).unwrap_or(false);
    let auth_method = pick(&status, &["authMethod"]);
    let email = pick(&status, &["email", "emailAddress", "accountEmail"]);
    let subscription = pick(&status, &["subscriptionType", "subscription", "plan"]);
    let mut details = format!("auth status: loggedIn={logged_in} authMethod={}", auth_method.as_deref().unwrap_or("?"));
    let mut reply_ok = None;
    if logged_in {
        let (ok, stdout, stderr) = run_claude(
            &store,
            &account,
            vec!["-p".into(), "responde solo: ok".into(), "--output-format".into(), "json".into()],
        )
        .await?;
        let reply: Value = serde_json::from_str(stdout.trim()).unwrap_or(Value::Null);
        let text = reply.get("result").and_then(Value::as_str).unwrap_or_default().to_lowercase();
        let good = ok && !reply.get("is_error").and_then(Value::as_bool).unwrap_or(true) && text.contains("ok");
        reply_ok = Some(good);
        details.push_str(&format!("\nclaude -p: exit_ok={ok} is_error={:?} result={text:?}", reply.get("is_error")));
        if !good && !stderr.trim().is_empty() {
            details.push_str(&format!("\nstderr: {}", crate::login::redact(stderr.trim())));
        }
    }
    if logged_in && reply_ok == Some(true) {
        store.write(|d| {
            if let Some(a) = d.accounts.iter_mut().find(|a| a.id == account_id) {
                a.needs_login = false;
                a.login_email = email.clone();
            }
            Ok(())
        })?;
        broadcast(&app, &store);
    }
    Ok(ProfileCheck { logged_in, auth_method, email, subscription, reply_ok, details })
}

/// Cheap status check for account cards (`claude auth status`, no model call).
#[tauri::command]
pub async fn profile_status(app: AppHandle, store: State<'_, Store>, account_id: String) -> AppResult<bool> {
    let account = find_account(&store, &account_id)?;
    let logged_in = auth_status(&store, &account).await?.get("loggedIn").and_then(Value::as_bool).unwrap_or(false);
    if account.needs_login == logged_in {
        store.write(|d| {
            if let Some(a) = d.accounts.iter_mut().find(|a| a.id == account_id) {
                a.needs_login = !logged_in;
            }
            Ok(())
        })?;
        broadcast(&app, &store);
    }
    Ok(logged_in)
}

/// Re-copies the shared config into an existing profile.
#[tauri::command]
pub async fn resync_profile(store: State<'_, Store>, account_id: String) -> AppResult<Vec<String>> {
    prepare_profile(store, account_id).await
}

/// Lets Claude Code log the profile out (removing its own stored login) and deletes the folder.
pub async fn remove_profile(store: &Store, account: &ClaudeAccount) {
    let dir: PathBuf = profile_dir(&store.dir(), &account.id);
    if dir.exists() {
        let _ = run_claude(store, account, vec!["auth".into(), "logout".into()]).await;
        let _ = std::fs::remove_dir_all(&dir);
    }
}
