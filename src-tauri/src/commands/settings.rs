use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::accounts;
use crate::commands::projects::notify_projects_changed;
use crate::error::{AppError, AppResult};
use crate::models::{new_id, AccountKind, ClaudeAccount};
use crate::usage::models::CatalogModel;
use crate::store::{find_project_mut, Store};

/// Broadcast to every window when global settings change.
pub const SETTINGS_CHANGED: &str = "settings-changed";

/// Global settings sent to the UI (never includes secrets).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub accounts: Vec<ClaudeAccount>,
    pub catalog: Vec<CatalogEntry>,
    pub catalog_updated_at: Option<chrono::DateTime<Utc>>,
    pub default_model: Option<String>,
    pub max_parallel_sessions: usize,
    pub editor: String,
    pub notifications: String,
    pub language: String,
}

/// Editor used when none is configured.
pub const DEFAULT_EDITOR: &str = "WebStorm";

/// A model of Claude Code's picker plus whether the user enabled it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    #[serde(flatten)]
    pub model: CatalogModel,
    pub enabled: bool,
}

/// Form to add an account.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAccount {
    pub alias: String,
    pub kind: Option<AccountKind>,
    pub secret: Option<String>,
    pub default_model: Option<String>,
}

/// Editable fields of an account; an empty `secret` keeps the stored one.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountPatch {
    pub alias: Option<String>,
    pub secret: Option<String>,
    pub default_model: Option<String>,
}

/// Builds the settings payload.
fn view(store: &Store) -> SettingsView {
    store.read(|d| SettingsView {
        accounts: d.accounts.clone(),
        catalog: d
            .settings
            .model_catalog
            .iter()
            .map(|m| CatalogEntry { model: m.clone(), enabled: !d.settings.disabled_models.contains(&m.id) })
            .collect(),
        catalog_updated_at: d.settings.catalog_updated_at,
        default_model: d.settings.default_model.clone(),
        max_parallel_sessions: d.settings.max_parallel_sessions,
        editor: d.settings.editor.clone().unwrap_or_else(|| DEFAULT_EDITOR.into()),
        notifications: d.settings.notifications.clone().unwrap_or_else(|| "background".into()),
        language: d.settings.language.clone().unwrap_or_else(|| "auto".into()),
    })
}

/// Notifies every window that settings changed.
pub fn broadcast<R: tauri::Runtime>(app: &tauri::AppHandle<R>, store: &Store) {
    let _ = app.emit(SETTINGS_CHANGED, view(store));
}

/// Returns the global settings.
#[tauri::command]
pub fn get_settings(store: State<Store>) -> SettingsView {
    view(&store)
}

/// Adds an API-key account (key stored in the keychain) or a "this machine's login" account.
/// Subscription accounts are created through the profile wizard instead.
#[tauri::command]
pub fn create_account(app: AppHandle, store: State<Store>, input: NewAccount) -> AppResult<ClaudeAccount> {
    let alias = input.alias.trim().to_string();
    if alias.is_empty() {
        return Err(AppError::msg("Alias cannot be empty"));
    }
    let kind = input.kind.unwrap_or(AccountKind::SystemLogin);
    let secret = input.secret.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    match kind {
        AccountKind::ApiKey if secret.is_none() => return Err(AppError::msg("An API key is required.")),
        AccountKind::ApiKey | AccountKind::SystemLogin => {}
        _ => return Err(AppError::msg("Subscription accounts are added with the login wizard.")),
    }
    let id = new_id();
    if let (AccountKind::ApiKey, Some(secret)) = (kind, &secret) {
        accounts::store_secret(&id, secret)?;
    }
    let account = ClaudeAccount {
        id,
        alias,
        kind,
        token_hint: secret.as_deref().filter(|_| kind == AccountKind::ApiKey).map(accounts::hint),
        default_model: input.default_model.filter(|m| !m.trim().is_empty()),
        created_at: Utc::now(),
        login_email: None,
        needs_login: false,
    };
    let created = account.clone();
    store.write(|d| {
        d.accounts.push(account);
        Ok(())
    })?;
    broadcast(&app, &store);
    Ok(created)
}

/// Updates alias, default model or secret of an account.
#[tauri::command]
pub fn update_account(app: AppHandle, store: State<Store>, id: String, patch: AccountPatch) -> AppResult<()> {
    let kind = store.read(|d| d.accounts.iter().find(|a| a.id == id).map(|a| a.kind));
    let secret = patch.secret.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).filter(|_| kind == Some(AccountKind::ApiKey));
    if let Some(secret) = &secret {
        accounts::store_secret(&id, secret)?;
    }
    store.write(|d| {
        let account = d.accounts.iter_mut().find(|a| a.id == id).ok_or_else(|| AppError::NotFound(format!("account {id}")))?;
        if let Some(alias) = patch.alias.map(|a| a.trim().to_string()).filter(|a| !a.is_empty()) {
            account.alias = alias;
        }
        if let Some(model) = patch.default_model {
            account.default_model = Some(model).filter(|m| !m.trim().is_empty());
        }
        if let Some(secret) = &secret {
            account.token_hint = Some(accounts::hint(secret));
        }
        Ok(())
    })?;
    broadcast(&app, &store);
    Ok(())
}

/// Deletes an account; projects using it are left without account. Profiles are logged out by
/// Claude Code itself and their folder removed; API keys are removed from the keychain.
#[tauri::command]
pub async fn delete_account(app: AppHandle, store: State<'_, Store>, id: String) -> AppResult<()> {
    let account = store.read(|d| d.accounts.iter().find(|a| a.id == id).cloned());
    if let Some(account) = account.filter(|a| matches!(a.kind, AccountKind::Profile | AccountKind::OauthToken)) {
        crate::commands::profiles::remove_profile(&store, &account).await;
    }
    store.write(|d| {
        d.accounts.retain(|a| a.id != id);
        for project in &mut d.projects {
            if project.account_id.as_deref() == Some(id.as_str()) {
                project.account_id = None;
            }
        }
        Ok(())
    })?;
    accounts::delete_secret(&id);
    broadcast(&app, &store);
    notify_projects_changed(&app);
    Ok(())
}

/// Enables or disables a model of the catalog (models are never deleted or renamed).
#[tauri::command]
pub fn set_model_enabled(app: AppHandle, store: State<Store>, id: String, enabled: bool) -> AppResult<()> {
    store.write(|d| {
        d.settings.disabled_models.retain(|m| m != &id);
        if !enabled {
            d.settings.disabled_models.push(id.clone());
            if d.settings.default_model.as_deref() == Some(id.as_str()) {
                d.settings.default_model = None;
            }
        }
        Ok(())
    })?;
    broadcast(&app, &store);
    Ok(())
}

/// Sets the global default model (none lets Claude Code decide).
#[tauri::command]
pub fn set_default_model(app: AppHandle, store: State<Store>, id: Option<String>) -> AppResult<()> {
    store.write(|d| {
        d.settings.default_model = id.filter(|m| !m.trim().is_empty());
        Ok(())
    })?;
    broadcast(&app, &store);
    Ok(())
}

/// Re-reads the model list from Claude Code's `/model` picker, using the project's account when given.
#[tauri::command]
pub async fn refresh_model_catalog(app: AppHandle, store: State<'_, Store>, project_id: Option<String>) -> AppResult<()> {
    let account = project_id
        .and_then(|id| store.project(&id).ok())
        .and_then(|p| p.account_id)
        .and_then(|id| store.read(|d| d.accounts.iter().find(|a| a.id == id).cloned()))
        .filter(|a| a.kind != AccountKind::ApiKey);
    refresh_catalog(&app, &store, account.as_ref()).await
}

/// Probes `/model` and stores the catalog; shared by the command and the daily background refresh.
pub async fn refresh_catalog<R: tauri::Runtime>(app: &tauri::AppHandle<R>, store: &Store, account: Option<&ClaudeAccount>) -> AppResult<()> {
    let (env, remove) = match account {
        Some(a) => accounts::account_env(a, &store.dir())?,
        None => (Default::default(), vec!["ANTHROPIC_API_KEY"]),
    };
    let cwd = store.dir().join("claude-probe");
    let models = tauri::async_runtime::spawn_blocking(move || {
        let claude = crate::shell_env::which("claude").ok_or_else(|| AppError::msg("The `claude` CLI was not found in PATH."))?;
        std::fs::create_dir_all(&cwd)?;
        crate::usage::probe::read_model_picker(&claude, &cwd, &env, &remove, true)
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))??;
    store.write(|d| {
        d.settings.model_catalog = models;
        d.settings.catalog_updated_at = Some(Utc::now());
        Ok(())
    })?;
    broadcast(app, store);
    Ok(())
}

/// Updates the global limit of sessions working at once.
#[tauri::command]
pub fn set_max_parallel_sessions(app: AppHandle, store: State<Store>, value: usize) -> AppResult<()> {
    store.write(|d| {
        d.settings.max_parallel_sessions = value.clamp(1, 10);
        Ok(())
    })?;
    broadcast(&app, &store);
    Ok(())
}

/// Sets the editor used by "Abrir en editor" (an app name on macOS, a command elsewhere).
#[tauri::command]
pub fn set_editor(app: AppHandle, store: State<Store>, editor: String) -> AppResult<()> {
    store.write(|d| {
        d.settings.editor = Some(editor.trim().to_string()).filter(|e| !e.is_empty());
        Ok(())
    })?;
    broadcast(&app, &store);
    Ok(())
}

/// Sets when finished sessions trigger a desktop notification.
#[tauri::command]
pub fn set_notifications(app: AppHandle, store: State<Store>, mode: String) -> AppResult<()> {
    if !matches!(mode.as_str(), "background" | "always" | "off") {
        return Err(AppError::msg(format!("Unknown notification mode {mode}")));
    }
    store.write(|d| {
        d.settings.notifications = Some(mode);
        Ok(())
    })?;
    broadcast(&app, &store);
    Ok(())
}

/// Sets the UI language ("auto" follows the operating system).
#[tauri::command]
pub fn set_language(app: AppHandle, store: State<Store>, language: String) -> AppResult<()> {
    let language = language.trim().to_string();
    if language.is_empty() || language.len() > 10 {
        return Err(AppError::msg("Invalid language"));
    }
    store.write(|d| {
        d.settings.language = Some(language).filter(|l| l != "auto");
        Ok(())
    })?;
    broadcast(&app, &store);
    Ok(())
}

/// Opens a folder in the configured editor.
#[tauri::command]
pub fn open_in_editor(store: State<Store>, path: String) -> AppResult<()> {
    let editor = store.read(|d| d.settings.editor.clone()).unwrap_or_else(|| DEFAULT_EDITOR.into());
    if cfg!(target_os = "macos") {
        let out = crate::shell_env::command("open").args(["-a", &editor, &path]).output()?;
        if !out.status.success() {
            return Err(AppError::msg(format!("Could not open {editor}: {}", String::from_utf8_lossy(&out.stderr).trim())));
        }
        return Ok(());
    }
    crate::shell_env::command(&editor)
        .arg(&path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| AppError::msg(format!("Could not open {editor}: {e}")))?;
    Ok(())
}

/// Selects the Claude account a project uses everywhere (chat, sessions, usage).
#[tauri::command]
pub fn set_project_account(app: AppHandle, store: State<Store>, project_id: String, account_id: Option<String>) -> AppResult<()> {
    if let Some(id) = &account_id {
        if !store.read(|d| d.accounts.iter().any(|a| &a.id == id)) {
            return Err(AppError::NotFound(format!("account {id}")));
        }
    }
    store.write(|d| {
        find_project_mut(d, &project_id)?.account_id = account_id;
        Ok(())
    })?;
    notify_projects_changed(&app);
    Ok(())
}

/// Sets the header color of a project (hex like `#4b6eaf`, or none).
#[tauri::command]
pub fn set_project_color(app: AppHandle, store: State<Store>, project_id: String, color: Option<String>) -> AppResult<()> {
    let color = color.filter(|c| c.starts_with('#') && (c.len() == 7 || c.len() == 4));
    store.write(|d| {
        find_project_mut(d, &project_id)?.color = color;
        Ok(())
    })?;
    notify_projects_changed(&app);
    Ok(())
}
