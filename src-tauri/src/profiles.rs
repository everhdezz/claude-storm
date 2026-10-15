//! Creation of isolated Claude Code profiles and syncing of the user's shared (non-secret) config.

use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::error::AppResult;

/// Files and folders copied from `~/.claude` into each profile. Credentials, history, projects,
/// todos and caches are never copied.
const SHARED_FILES: &[&str] = &["settings.json", "CLAUDE.md"];
const SHARED_DIRS: &[&str] = &["agents", "commands", "skills"];

/// Settings keys that could carry or produce credentials; stripped from the copied settings.json.
const SECRET_SETTINGS: &[&str] = &["apiKeyHelper", "awsAuthRefresh", "awsCredentialExport", "otelHeadersHelper"];
const SECRET_ENV: &[&str] = &["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];

/// Copies the shared config of `source_dir` (usually `~/.claude`) and the user-scope MCP servers
/// of `source_json` (usually `~/.claude.json`) into `profile_dir`.
pub fn sync_shared_config(source_dir: &Path, source_json: &Path, profile_dir: &Path) -> AppResult<Vec<String>> {
    fs::create_dir_all(profile_dir)?;
    let mut copied = Vec::new();
    for name in SHARED_FILES {
        let src = source_dir.join(name);
        if !src.is_file() {
            continue;
        }
        if *name == "settings.json" {
            fs::write(profile_dir.join(name), sanitized_settings(&fs::read_to_string(&src)?))?;
        } else {
            fs::copy(&src, profile_dir.join(name))?;
        }
        copied.push(name.to_string());
    }
    for name in SHARED_DIRS {
        let src = source_dir.join(name);
        if src.is_dir() {
            let dst = profile_dir.join(name);
            if dst.exists() {
                fs::remove_dir_all(&dst)?;
            }
            copy_dir(&src, &dst)?;
            copied.push(format!("{name}/"));
        }
    }
    if merge_mcp_servers(source_json, &profile_dir.join(".claude.json"))? {
        copied.push("MCP (user scope)".into());
    }
    Ok(copied)
}

/// Removes credential-producing keys from a settings.json document.
fn sanitized_settings(raw: &str) -> String {
    let Ok(mut v) = serde_json::from_str::<Value>(raw) else { return raw.to_string() };
    if let Some(obj) = v.as_object_mut() {
        for key in SECRET_SETTINGS {
            obj.remove(*key);
        }
        if let Some(env) = obj.get_mut("env").and_then(Value::as_object_mut) {
            for key in SECRET_ENV {
                env.remove(*key);
            }
        }
    }
    serde_json::to_string_pretty(&v).unwrap_or_else(|_| raw.to_string())
}

/// Copies only the `mcpServers` key of the user's `.claude.json` into the profile's one.
fn merge_mcp_servers(source_json: &Path, target_json: &Path) -> AppResult<bool> {
    let Ok(raw) = fs::read_to_string(source_json) else { return Ok(false) };
    let Ok(source) = serde_json::from_str::<Value>(&raw) else { return Ok(false) };
    let Some(servers) = source.get("mcpServers").filter(|s| s.as_object().is_some_and(|o| !o.is_empty())) else {
        return Ok(false);
    };
    let mut target: Value = fs::read_to_string(target_json)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| Value::Object(Default::default()));
    if let Some(obj) = target.as_object_mut() {
        obj.insert("mcpServers".into(), servers.clone());
    }
    fs::write(target_json, serde_json::to_string_pretty(&target)?)?;
    Ok(true)
}

/// Recursive copy that skips symlinks to avoid loops.
fn copy_dir(src: &Path, dst: &Path) -> AppResult<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if kind.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_shared_config_but_never_credentials_or_history() {
        let root = std::env::temp_dir().join(format!("devhub-profile-sync-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let home = root.join("home/.claude");
        fs::create_dir_all(home.join("agents")).unwrap();
        fs::create_dir_all(home.join("projects/x")).unwrap();
        fs::write(home.join("agents/reviewer.md"), "agent").unwrap();
        fs::write(home.join("CLAUDE.md"), "rules").unwrap();
        fs::write(home.join(".credentials.json"), "{\"secret\":1}").unwrap();
        fs::write(home.join("history.jsonl"), "{}").unwrap();
        fs::write(
            home.join("settings.json"),
            r#"{"model":"opus","apiKeyHelper":"x","env":{"ANTHROPIC_API_KEY":"k","FOO":"1"}}"#,
        )
        .unwrap();
        let user_json = root.join("home/.claude.json");
        fs::write(&user_json, r#"{"oauthAccount":{"email":"me@x"},"mcpServers":{"gh":{"command":"gh-mcp"}}}"#).unwrap();

        let profile = root.join("profile");
        let copied = sync_shared_config(&home, &user_json, &profile).unwrap();

        assert!(copied.contains(&"agents/".to_string()));
        assert!(profile.join("agents/reviewer.md").exists());
        assert!(profile.join("CLAUDE.md").exists());
        assert!(!profile.join(".credentials.json").exists());
        assert!(!profile.join("history.jsonl").exists());
        assert!(!profile.join("projects").exists());
        let settings: Value = serde_json::from_str(&fs::read_to_string(profile.join("settings.json")).unwrap()).unwrap();
        assert!(settings.get("apiKeyHelper").is_none());
        assert!(settings["env"].get("ANTHROPIC_API_KEY").is_none());
        assert_eq!(settings["env"]["FOO"], "1");
        let claude_json: Value = serde_json::from_str(&fs::read_to_string(profile.join(".claude.json")).unwrap()).unwrap();
        assert_eq!(claude_json["mcpServers"]["gh"]["command"], "gh-mcp");
        assert!(claude_json.get("oauthAccount").is_none());
        let _ = fs::remove_dir_all(root);
    }
}
