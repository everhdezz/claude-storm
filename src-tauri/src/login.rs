//! Drives `claude auth login --claudeai` in a hidden PTY for a profile, so Claude Code performs and
//! stores the login itself. DevHub only forwards the authorization URL and an optional pasted code.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::error::{AppError, AppResult};
use crate::pty;

pub const LOGIN_PROGRESS: &str = "login-progress";
const TIMEOUT: Duration = Duration::from_secs(300);

/// What the login output tells us so far.
#[derive(Debug, Default, PartialEq)]
pub struct LoginSignals {
    pub manual_url: Option<String>,
    pub waiting_code: bool,
    pub invalid_codes: usize,
    pub success: bool,
    pub failure: Option<String>,
}

/// Reads the (ANSI-stripped) output of `claude auth login`.
pub fn parse_login_output(text: &str) -> LoginSignals {
    let url = Regex::new(r"visit:\s*(https://\S+)").unwrap();
    let failed = Regex::new(r"Login failed:\s*([^\n]+)").unwrap();
    LoginSignals {
        manual_url: url.captures(text).map(|c| c[1].to_string()),
        waiting_code: text.contains("Paste code here"),
        invalid_codes: text.matches("Invalid code").count(),
        success: text.contains("Login successful"),
        failure: failed.captures(text).map(|c| c[1].trim().to_string()),
    }
}

/// Hides OAuth parameters before showing raw output to the user.
pub fn redact(text: &str) -> String {
    let re = Regex::new(r"(code_challenge|state|code)=[A-Za-z0-9_\-%.~]+").unwrap();
    re.replace_all(text, "$1=…").to_string()
}

/// Progress event for the wizard.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginProgress {
    pub login_id: String,
    pub account_id: String,
    pub stage: &'static str,
    pub url: Option<String>,
    pub manual_url: Option<String>,
    pub message: Option<String>,
    pub details: Option<String>,
}

struct LoginRun {
    account_id: String,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
    url: Option<String>,
}

/// Live hidden logins keyed by login id.
#[derive(Default)]
pub struct LoginManager {
    runs: Mutex<HashMap<String, LoginRun>>,
}

/// Writes the tiny `BROWSER` helper that records the URL Claude Code wants to open.
#[cfg(unix)]
fn browser_helper(app_data: &Path) -> AppResult<Option<PathBuf>> {
    use std::os::unix::fs::PermissionsExt;
    let path = app_data.join("bin").join("devhub-login-browser.sh");
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(&path, "#!/bin/sh\nprintf '%s\\n' \"$1\" > \"$DEVHUB_LOGIN_URL_FILE\"\n")?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))?;
    Ok(Some(path))
}

/// On Windows Claude Code opens the browser itself; DevHub only shows the manual link.
#[cfg(windows)]
fn browser_helper(_app_data: &Path) -> AppResult<Option<PathBuf>> {
    Ok(None)
}

impl LoginManager {
    /// Starts `claude auth login` for a profile dir and streams progress events.
    pub fn start<R: Runtime>(&self, app: &AppHandle<R>, account_id: &str, profile_dir: &Path, app_data: &Path) -> AppResult<String> {
        let claude = crate::shell_env::which("claude").ok_or_else(|| AppError::msg("The `claude` CLI was not found in PATH."))?;
        let login_id = crate::models::new_id();
        let url_file = app_data.join("login").join(format!("{login_id}.url"));
        std::fs::create_dir_all(url_file.parent().unwrap())?;
        let mut env = HashMap::new();
        env.insert("CLAUDE_CONFIG_DIR".to_string(), profile_dir.to_string_lossy().to_string());
        if let Some(helper) = browser_helper(app_data)? {
            env.insert("BROWSER".to_string(), helper.to_string_lossy().to_string());
            env.insert("DEVHUB_LOGIN_URL_FILE".to_string(), url_file.to_string_lossy().to_string());
        }
        let removed: Vec<&str> = crate::accounts::AUTH_VARS.to_vec();
        let proc = pty::spawn(&claude.to_string_lossy(), &["auth", "login", "--claudeai"], profile_dir, &env, &removed, 40, 200)?;
        let mut reader = proc.master.try_clone_reader().map_err(|e| AppError::msg(e.to_string()))?;
        let writer = proc.master.take_writer().map_err(|e| AppError::msg(e.to_string()))?;
        let killer = proc.child.clone_killer();
        self.runs.lock().unwrap().insert(
            login_id.clone(),
            LoginRun { account_id: account_id.to_string(), writer, killer, url: None },
        );

        let output: Arc<Mutex<Vec<u8>>> = Arc::default();
        let sink = output.clone();
        std::thread::spawn(move || {
            let mut chunk = [0u8; 8192];
            while let Ok(n) = reader.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                sink.lock().unwrap().extend_from_slice(&chunk[..n]);
            }
        });

        let app = app.clone();
        let id = login_id.clone();
        let account = account_id.to_string();
        std::thread::spawn(move || {
            let master = proc.master;
            let mut child = proc.child;
            let started = Instant::now();
            let mut announced_url = false;
            let mut seen_invalid = 0;
            let emit = |stage: &'static str, url: Option<String>, manual: Option<String>, message: Option<String>, details: Option<String>| {
                let _ = app.emit(
                    LOGIN_PROGRESS,
                    LoginProgress { login_id: id.clone(), account_id: account.clone(), stage, url, manual_url: manual, message, details },
                );
            };
            let text = |buf: &Arc<Mutex<Vec<u8>>>| crate::process_manager::strip_ansi(&String::from_utf8_lossy(&buf.lock().unwrap()));
            loop {
                std::thread::sleep(Duration::from_millis(250));
                if !app.state::<LoginManager>().runs.lock().unwrap().contains_key(&id) {
                    let _ = child.kill();
                    break;
                }
                let current = text(&output);
                let signals = parse_login_output(&current);
                let auto_url = std::fs::read_to_string(&url_file).ok().map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
                if !announced_url && (auto_url.is_some() || (signals.manual_url.is_some() && started.elapsed() > Duration::from_secs(3))) {
                    announced_url = true;
                    let open = auto_url.clone().or(signals.manual_url.clone());
                    if let Some(url) = &open {
                        if let Some(run) = app.state::<LoginManager>().runs.lock().unwrap().get_mut(&id) {
                            run.url = Some(url.clone());
                        }
                        let _ = tauri_plugin_opener::OpenerExt::opener(&app).open_url(url, None::<&str>);
                    }
                    emit("browser", open, signals.manual_url.clone(), None, None);
                }
                if signals.invalid_codes > seen_invalid {
                    seen_invalid = signals.invalid_codes;
                    emit("codeInvalid", None, None, Some("El código no es válido. Cópialo completo e inténtalo otra vez.".into()), None);
                }
                if signals.success {
                    emit("authorized", None, None, None, None);
                    break;
                }
                let exited = child.try_wait().ok().flatten();
                if let Some(reason) = signals.failure.clone().or_else(|| exited.as_ref().map(|s| format!("claude terminó (código {})", s.exit_code()))) {
                    emit("failed", None, None, Some(human_error(&reason)), Some(redact(current.trim())));
                    break;
                }
                if started.elapsed() > TIMEOUT {
                    emit("timeout", None, None, Some("Pasaron 5 minutos sin completar la autorización.".into()), Some(redact(current.trim())));
                    break;
                }
            }
            let _ = child.kill();
            let _ = child.wait();
            drop(master);
            let _ = std::fs::remove_file(&url_file);
            app.state::<LoginManager>().runs.lock().unwrap().remove(&id);
        });
        Ok(login_id)
    }

    /// Types a pasted authorization code into the hidden login.
    pub fn submit_code(&self, login_id: &str, code: &str) -> AppResult<()> {
        let mut runs = self.runs.lock().unwrap();
        let run = runs.get_mut(login_id).ok_or_else(|| AppError::msg("The login is no longer running; start it again."))?;
        let clean: String = code.trim().chars().filter(|c| !c.is_control()).collect();
        run.writer.write_all(format!("{clean}\r").as_bytes())?;
        run.writer.flush()?;
        Ok(())
    }

    /// URL to reopen in the browser.
    pub fn url(&self, login_id: &str) -> Option<String> {
        self.runs.lock().unwrap().get(login_id).and_then(|r| r.url.clone())
    }

    /// Kills a hidden login; returns its account id.
    pub fn cancel(&self, login_id: &str) -> Option<String> {
        let mut run = self.runs.lock().unwrap().remove(login_id)?;
        let _ = run.killer.kill();
        Some(run.account_id)
    }

    /// Kills every hidden login (app exit).
    pub fn cancel_all(&self) {
        for (_, mut run) in self.runs.lock().unwrap().drain() {
            let _ = run.killer.kill();
        }
    }
}

/// Plain-language version of a login failure.
fn human_error(reason: &str) -> String {
    if reason.contains("400") {
        "Anthropic rechazó la autorización (el código expiró o no corresponde a este intento). Reintenta el login.".into()
    } else if reason.contains("ENOTFOUND") || reason.contains("ECONN") || reason.contains("network") {
        "No hay conexión con Anthropic. Revisa tu internet y reintenta.".into()
    } else {
        format!("El login no se completó: {reason}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        let raw = std::fs::read(format!("{}/tests/fixtures/login/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap();
        crate::process_manager::strip_ansi(&String::from_utf8_lossy(&raw))
    }

    #[test]
    fn prompt_stage_exposes_manual_url_and_code_prompt() {
        let s = parse_login_output(&fixture("prompt.raw"));
        assert!(s.manual_url.unwrap().starts_with("https://claude.com/cai/oauth/authorize?code=true"));
        assert!(s.waiting_code);
        assert!(!s.success && s.failure.is_none() && s.invalid_codes == 0);
    }

    #[test]
    fn detects_invalid_code_without_failing() {
        let s = parse_login_output(&fixture("invalid-code.raw"));
        assert_eq!(s.invalid_codes, 1);
        assert!(s.failure.is_none());
    }

    #[test]
    fn detects_failed_login() {
        let s = parse_login_output(&fixture("failed.raw"));
        assert_eq!(s.failure.as_deref(), Some("Request failed with status code 400"));
        assert!(human_error("Request failed with status code 400").contains("rechazó"));
    }

    #[test]
    fn detects_success_line() {
        assert!(parse_login_output("Paste code here if prompted > \nLogin successful.\n").success);
    }

    #[test]
    fn redacts_oauth_parameters() {
        let out = redact("https://x/authorize?code=true&state=abc123&code_challenge=zz");
        assert!(!out.contains("abc123") && !out.contains("zz"));
    }
}
