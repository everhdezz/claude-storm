use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::accounts;
use crate::commands::projects::notify_projects_changed;
use crate::error::{AppError, AppResult};
use crate::models::{new_id, AccountKind, ClaudeAccount, ModelOption};
use crate::store::{find_project_mut, Store};

/// Broadcast to every window when global settings change.
pub const SETTINGS_CHANGED: &str = "settings-changed";

/// Global settings sent to the UI (never includes secrets).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub accounts: Vec<ClaudeAccount>,
    pub models: Vec<ModelOption>,
    pub default_model: Option<String>,
    pub max_parallel_sessions: usize,
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
        models: d.settings.models.clone(),
        default_model: d.settings.default_model.clone(),
        max_parallel_sessions: d.settings.max_parallel_sessions,
    })
}

/// Notifies every window that settings changed.
fn broadcast(app: &AppHandle, store: &Store) {
    let _ = app.emit(SETTINGS_CHANGED, view(store));
}

/// Returns the global settings.
#[tauri::command]
pub fn get_settings(store: State<Store>) -> SettingsView {
    view(&store)
}

/// Adds a Claude account, storing its token or API key in the keychain.
#[tauri::command]
pub fn create_account(app: AppHandle, store: State<Store>, input: NewAccount) -> AppResult<ClaudeAccount> {
    let alias = input.alias.trim().to_string();
    if alias.is_empty() {
        return Err(AppError::msg("Alias cannot be empty"));
    }
    let secret = input.secret.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let kind = match (input.kind, secret.as_deref()) {
        (Some(kind), _) => kind,
        (None, Some(s)) => accounts::detect_kind(s).ok_or_else(|| AppError::msg("Unrecognized token: pick its type."))?,
        (None, None) => AccountKind::SystemLogin,
    };
    if kind != AccountKind::SystemLogin && secret.is_none() {
        return Err(AppError::msg("This account type needs a token or API key."));
    }
    let id = new_id();
    if let Some(secret) = &secret {
        accounts::store_secret(&id, secret)?;
    }
    let account = ClaudeAccount {
        id,
        alias,
        kind,
        token_hint: secret.as_deref().map(accounts::hint),
        default_model: input.default_model.filter(|m| !m.trim().is_empty()),
        created_at: Utc::now(),
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
    let secret = patch.secret.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
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

/// Deletes an account and its keychain secret; projects using it are left without account.
#[tauri::command]
pub fn delete_account(app: AppHandle, store: State<Store>, id: String) -> AppResult<()> {
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

/// Replaces the list of models offered in pickers and the global default model.
#[tauri::command]
pub fn save_models(app: AppHandle, store: State<Store>, models: Vec<ModelOption>, default_model: Option<String>) -> AppResult<()> {
    let models: Vec<ModelOption> = models
        .into_iter()
        .map(|m| ModelOption { value: m.value.trim().to_string(), label: m.label.trim().to_string() })
        .filter(|m| !m.value.is_empty())
        .map(|m| if m.label.is_empty() { ModelOption { label: m.value.clone(), ..m } } else { m })
        .collect();
    store.write(|d| {
        d.settings.models = models;
        d.settings.default_model = default_model.filter(|m| !m.trim().is_empty());
        Ok(())
    })?;
    broadcast(&app, &store);
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
