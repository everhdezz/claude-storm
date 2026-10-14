//! Claude accounts: keychain storage of their secrets and the environment each one injects.

use std::collections::HashMap;

use crate::error::{AppError, AppResult};
use crate::models::{AccountKind, ClaudeAccount};

const SERVICE: &str = "dev.devhub.app";

/// Variables that select Claude credentials; all are cleared before applying an account.
pub const AUTH_VARS: &[&str] = &["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"];

/// Keychain entry of an account.
fn entry(account_id: &str) -> AppResult<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, &format!("claude-account-{account_id}"))?)
}

/// Stores an account secret in the OS keychain.
pub fn store_secret(account_id: &str, secret: &str) -> AppResult<()> {
    entry(account_id)?.set_password(secret)?;
    Ok(())
}

/// Reads an account secret from the OS keychain.
pub fn read_secret(account_id: &str) -> AppResult<String> {
    entry(account_id)?
        .get_password()
        .map_err(|e| AppError::msg(format!("Could not read this account's token from the keychain: {e}")))
}

/// Deletes an account secret, ignoring a missing entry.
pub fn delete_secret(account_id: &str) {
    if let Ok(e) = entry(account_id) {
        let _ = e.delete_credential();
    }
}

/// Guesses the kind of a pasted secret from Anthropic's prefixes.
pub fn detect_kind(secret: &str) -> Option<AccountKind> {
    let s = secret.trim();
    if s.starts_with("sk-ant-oat") {
        Some(AccountKind::OauthToken)
    } else if s.starts_with("sk-ant-api") {
        Some(AccountKind::ApiKey)
    } else {
        None
    }
}

/// Short, non-secret hint shown in the UI ("…a1b2").
pub fn hint(secret: &str) -> String {
    let tail: String = secret.trim().chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("…{tail}")
}

/// Environment for running `claude` as `account`: (variables to set, variables to remove).
pub fn account_env(account: &ClaudeAccount) -> AppResult<(HashMap<String, String>, Vec<&'static str>)> {
    let mut set = HashMap::new();
    match account.kind {
        AccountKind::OauthToken => {
            set.insert("CLAUDE_CODE_OAUTH_TOKEN".to_string(), read_secret(&account.id)?);
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

    #[test]
    fn detects_kind_by_prefix() {
        assert_eq!(detect_kind("sk-ant-oat01-abc"), Some(AccountKind::OauthToken));
        assert_eq!(detect_kind(" sk-ant-api03-xyz "), Some(AccountKind::ApiKey));
        assert_eq!(detect_kind("hello"), None);
    }

    #[test]
    fn hint_shows_only_last_four() {
        assert_eq!(hint("sk-ant-oat01-secretWXYZ"), "…WXYZ");
    }
}
