use std::fs;
use std::path::Path;

use regex::Regex;
use serde_json::Value;

use crate::models::{new_id, Framework, RepoCommand};

/// Result of inspecting a folder: framework, package manager, port and suggested commands.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub framework: Framework,
    pub package_manager: Option<String>,
    pub port: Option<u16>,
    pub commands: Vec<RepoCommand>,
}

/// Detects the framework of a repository and preloads editable commands.
pub fn detect(dir: &Path) -> Detection {
    if let Some(d) = detect_laravel(dir) {
        return d;
    }
    if let Some(d) = detect_node(dir) {
        return d;
    }
    Detection { framework: Framework::Generic, package_manager: None, port: None, commands: Vec::new() }
}

/// Builds a command entry.
fn cmd(label: &str, command: String, long_running: bool) -> RepoCommand {
    RepoCommand { id: new_id(), label: label.into(), command, long_running }
}

/// Reads and parses a JSON file, if present.
fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// Detects a Laravel app through composer.json and the artisan script.
fn detect_laravel(dir: &Path) -> Option<Detection> {
    let composer = read_json(&dir.join("composer.json"))?;
    let is_laravel = composer.pointer("/require/laravel~1framework").is_some() && dir.join("artisan").is_file();
    if !is_laravel {
        return None;
    }
    let port = laravel_port(dir).unwrap_or(8000);
    Some(Detection {
        framework: Framework::Laravel,
        package_manager: Some("composer".into()),
        port: Some(port),
        commands: vec![
            cmd("serve", format!("php artisan serve --port={port}"), true),
            cmd("migrate", "php artisan migrate".into(), false),
            cmd("install", "composer install".into(), false),
        ],
    })
}

/// Reads the port from APP_URL in .env when it is a localhost URL with an explicit port.
fn laravel_port(dir: &Path) -> Option<u16> {
    let env = fs::read_to_string(dir.join(".env")).ok()?;
    let re = Regex::new(r"(?m)^APP_URL=.*(?:localhost|127\.0\.0\.1):(\d{2,5})").ok()?;
    re.captures(&env)?.get(1)?.as_str().parse().ok()
}

/// Detects Node-based projects (Expo, Next, Vite, React, plain Node).
fn detect_node(dir: &Path) -> Option<Detection> {
    let pkg = read_json(&dir.join("package.json"))?;
    let has_dep = |name: &str| {
        ["dependencies", "devDependencies"].iter().any(|k| pkg.get(k).and_then(|d| d.get(name)).is_some())
    };
    let framework = if has_dep("expo") {
        Framework::Expo
    } else if has_dep("next") {
        Framework::Next
    } else if has_dep("vite") {
        Framework::Vite
    } else if has_dep("react") {
        Framework::React
    } else {
        Framework::Node
    };
    let pm = package_manager(dir);
    let scripts = pkg.get("scripts").and_then(Value::as_object);
    let script = |name: &str| scripts.and_then(|s| s.get(name)).and_then(Value::as_str);
    let run = |name: &str| if pm == "npm" { format!("npm run {name}") } else { format!("{pm} {name}") };

    let mut commands = Vec::new();
    if framework == Framework::Expo {
        commands.push(cmd("expo start", "npx expo start".into(), true));
    } else if script("dev").is_some() {
        commands.push(cmd("dev", run("dev"), true));
    } else if script("start").is_some() {
        commands.push(cmd("start", run("start"), true));
    }
    if script("build").is_some() {
        commands.push(cmd("build", run("build"), false));
    }
    commands.push(cmd("install", format!("{pm} install"), false));

    let dev_script = script("dev").or_else(|| script("start")).unwrap_or("");
    let port = port_from_script(dev_script).or_else(|| port_from_config(dir, framework));
    Some(Detection { framework, package_manager: Some(pm.into()), port, commands })
}

/// Picks the package manager from the lockfile present in the repo.
fn package_manager(dir: &Path) -> &'static str {
    if dir.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if dir.join("yarn.lock").exists() {
        "yarn"
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        "bun"
    } else {
        "npm"
    }
}

/// Extracts an explicit `--port N` / `-p N` from a package script.
fn port_from_script(script: &str) -> Option<u16> {
    let re = Regex::new(r"(?:--port[= ]|-p )(\d{2,5})").ok()?;
    re.captures(script)?.get(1)?.as_str().parse().ok()
}

/// Reads `port:` from a Vite config, falling back to each framework's default port.
fn port_from_config(dir: &Path, framework: Framework) -> Option<u16> {
    let re = Regex::new(r"port\s*:\s*(\d{2,5})").ok()?;
    let from_vite = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"]
        .iter()
        .filter_map(|f| fs::read_to_string(dir.join(f)).ok())
        .find_map(|src| re.captures(&src)?.get(1)?.as_str().parse().ok());
    from_vite.or(match framework {
        Framework::Vite => Some(5173),
        Framework::Next | Framework::React => Some(3000),
        Framework::Expo => Some(8081),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("claude-storm-detect-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn detects_vite_with_pnpm_and_config_port() {
        let dir = temp_dir("vite");
        fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"vite","build":"vite build"},"devDependencies":{"vite":"7"}}"#).unwrap();
        fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        fs::write(dir.join("vite.config.ts"), "export default { server: { port: 4321 } }").unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Vite);
        assert_eq!(d.package_manager.as_deref(), Some("pnpm"));
        assert_eq!(d.port, Some(4321));
        let labels: Vec<_> = d.commands.iter().map(|c| c.command.as_str()).collect();
        assert_eq!(labels, ["pnpm dev", "pnpm build", "pnpm install"]);
    }

    #[test]
    fn detects_laravel() {
        let dir = temp_dir("laravel");
        fs::write(dir.join("composer.json"), r#"{"require":{"laravel/framework":"^11"}}"#).unwrap();
        fs::write(dir.join("artisan"), "").unwrap();
        fs::write(dir.join(".env"), "APP_URL=http://localhost:8010\n").unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Laravel);
        assert_eq!(d.commands[0].command, "php artisan serve --port=8010");
    }

    #[test]
    fn detects_expo_before_react() {
        let dir = temp_dir("expo");
        fs::write(dir.join("package.json"), r#"{"dependencies":{"expo":"51","react":"18"}}"#).unwrap();
        let d = detect(&dir);
        assert_eq!(d.framework, Framework::Expo);
        assert_eq!(d.commands[0].command, "npx expo start");
    }

    #[test]
    fn unknown_folder_is_generic() {
        let d = detect(&temp_dir("generic"));
        assert_eq!(d.framework, Framework::Generic);
        assert!(d.commands.is_empty());
    }
}
