//! Claude accounts and the environment each one injects when DevHub launches `claude`.
//!
//! Profile accounts point Claude Code at their own `CLAUDE_CONFIG_DIR`; Claude Code stores the
//! login there (macOS: its own Keychain item, named from a hash of that dir). DevHub never reads,
//! copies or stores those credentials. Only API keys are kept by DevHub, in the OS keychain.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::models::{AccountKind, ClaudeAccount};

const SERVICE: &str = "dev.devhub.app";

/// Variables that select Claude credentials or their storage; cleared before applying an account.
pub const AUTH_VARS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_SECURESTORAGE_CONFIG_DIR",
];

/// Keychain entry of an account's API key.
fn entry(account_id: &str) -> AppResult<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, &format!("claude-account-{account_id}"))?)
}

/// Stores an API key in the OS keychain.
pub fn store_secret(account_id: &str, secret: &str) -> AppResult<()> {
    entry(account_id)?.set_password(secret)?;
    Ok(())
}

/// Reads an API key from the OS keychain.
pub fn read_secret(account_id: &str) -> AppResult<String> {
    entry(account_id)?
        .get_password()
        .map_err(|e| AppError::msg(format!("Could not read this account's API key from the keychain: {e}")))
}

/// Deletes an API key, ignoring a missing entry.
pub fn delete_secret(account_id: &str) {
    if let Ok(e) = entry(account_id) {
        let _ = e.delete_credential();
    }
}

/// Short, non-secret hint shown in the UI ("…a1b2").
pub fn hint(secret: &str) -> String {
    let tail: String = secret.trim().chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("…{tail}")
}

/// Config dir of a profile account.
pub fn profile_dir(app_data: &Path, account_id: &str) -> PathBuf {
    app_data.join("claude-profiles").join(account_id)
}

/// Environment for running `claude` as `account`: (variables to set, variables to remove).
pub fn account_env(account: &ClaudeAccount, app_data: &Path) -> AppResult<(HashMap<String, String>, Vec<&'static str>)> {
    let mut set = HashMap::new();
    match account.kind {
        AccountKind::Profile | AccountKind::OauthToken => {
            set.insert("CLAUDE_CONFIG_DIR".to_string(), profile_dir(app_data, &account.id).to_string_lossy().to_string());
        }
        AccountKind::ApiKey => {
            set.insert("ANTHROPIC_API_KEY".to_string(), read_secret(&account.id)?);
        }
        AccountKind::SystemLogin => {}
    }
    Ok((set, AUTH_VARS.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn account(kind: AccountKind) -> ClaudeAccount {
        ClaudeAccount {
            id: "acc1".into(),
            alias: "a".into(),
            kind,
            token_hint: None,
            default_model: None,
            created_at: Utc::now(),
            login_email: None,
            needs_login: false,
        }
    }

    #[test]
    fn profile_sets_only_its_config_dir_and_clears_auth_vars() {
        let (set, removed) = account_env(&account(AccountKind::Profile), Path::new("/data")).unwrap();
        assert_eq!(set.len(), 1);
        assert_eq!(set["CLAUDE_CONFIG_DIR"], "/data/claude-profiles/acc1");
        for var in ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_SECURESTORAGE_CONFIG_DIR"] {
            assert!(removed.contains(&var));
        }
    }

    #[test]
    fn system_login_uses_default_config() {
        let (set, removed) = account_env(&account(AccountKind::SystemLogin), Path::new("/data")).unwrap();
        assert!(set.is_empty());
        assert!(removed.contains(&"CLAUDE_CONFIG_DIR"));
    }

    #[test]
    fn hint_shows_only_last_four() {
        assert_eq!(hint("sk-ant-api03-secretWXYZ"), "…WXYZ");
    }
}
