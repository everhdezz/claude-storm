//! Drives an interactive Claude Code session inside a PTY to read the `/usage` screen.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use regex::Regex;

use crate::error::{AppError, AppResult};
use crate::pty;

const ROWS: u16 = 50;
const COLS: u16 = 120;

/// Final rendered screen plus the raw bytes received after `/usage` was sent.
pub struct ProbeOutput {
    pub screen: String,
}

/// Runs `claude`, sends `/usage`, waits for the bars to render and returns the screen.
///
/// `accept_trust` may only be true for claude-storm's own empty probe folder: trusting it exposes nothing.
pub fn run(
    claude: &Path,
    cwd: &Path,
    env: &HashMap<String, String>,
    remove_env: &[&str],
    accept_trust: bool,
) -> AppResult<ProbeOutput> {
    let bar = Regex::new(r"\d+\s*%\s*used").unwrap();
    run_slash_command(claude, cwd, env, remove_env, accept_trust, "/usage", &|t: &str| bar.is_match(t) && t.contains("Resets"), None)
}

/// Opens `/model` and scrolls the whole picker, returning every model it lists.
pub fn read_model_picker(
    claude: &Path,
    cwd: &Path,
    env: &HashMap<String, String>,
    remove_env: &[&str],
    accept_trust: bool,
) -> AppResult<Vec<crate::usage::models::CatalogModel>> {
    use crate::usage::models::{merge_rows, parse_picker};
    let mut rows = Vec::new();
    let mut scroll = |screen: &mut Screen, writer: &mut Box<dyn Write + Send>| -> AppResult<()> {
        rows.extend(parse_picker(&screen.text()));
        let mut idle = 0;
        for step in 0..40 {
            writer.write_all(b"\x1b[B")?;
            writer.flush()?;
            std::thread::sleep(Duration::from_millis(150));
            screen.pump();
            let before = merge_rows(rows.clone()).len();
            rows.extend(parse_picker(&screen.text()));
            idle = if merge_rows(rows.clone()).len() == before { idle + 1 } else { 0 };
            if step > before + 2 && idle >= 4 {
                break;
            }
        }
        Ok(())
    };
    run_slash_command(claude, cwd, env, remove_env, accept_trust, "/model", &|t: &str| t.contains("Select model"), Some(&mut scroll))?;
    let models = merge_rows(rows);
    if models.is_empty() {
        return Err(AppError::msg("Could not read any model from /model."));
    }
    Ok(models)
}

/// Runs `claude`, types a slash command and returns the screen once `shown` matches and output settles.
pub fn run_slash_command(
    claude: &Path,
    cwd: &Path,
    env: &HashMap<String, String>,
    remove_env: &[&str],
    accept_trust: bool,
    command: &str,
    shown: &dyn Fn(&str) -> bool,
    after: Option<&mut dyn FnMut(&mut Screen, &mut Box<dyn Write + Send>) -> AppResult<()>>,
) -> AppResult<ProbeOutput> {
    let program = claude.to_string_lossy().to_string();
    let mut proc = pty::spawn(&program, &[], cwd, env, remove_env, ROWS, COLS)?;
    let mut reader = proc.master.try_clone_reader().map_err(|e| AppError::msg(e.to_string()))?;
    let mut writer = proc.master.take_writer().map_err(|e| AppError::msg(e.to_string()))?;

    let buffer: Arc<Mutex<Vec<u8>>> = Arc::default();
    let sink = buffer.clone();
    std::thread::spawn(move || {
        let mut chunk = [0u8; 16384];
        while let Ok(n) = reader.read(&mut chunk) {
            if n == 0 {
                break;
            }
            sink.lock().unwrap().extend_from_slice(&chunk[..n]);
        }
    });

    let mut screen = Screen::new(buffer);
    let mut result = drive(&mut screen, &mut writer, accept_trust, command, shown);
    if let (Ok(()), Some(step)) = (&result, after) {
        result = step(&mut screen, &mut writer);
    }
    let _ = writer.write_all(b"\x1b");
    let _ = proc.child.kill();
    let _ = proc.child.wait();
    result.map(|_| ProbeOutput { screen: screen.text() })
}

/// Performs the interactive steps, returning an explanatory error when something blocks.
fn drive(
    screen: &mut Screen,
    writer: &mut Box<dyn Write + Send>,
    accept_trust: bool,
    command: &str,
    shown: &dyn Fn(&str) -> bool,
) -> AppResult<()> {
    let deadline = std::time::Instant::now() + Duration::from_secs(45);
    loop {
        screen.pump();
        let text = screen.text();
        if needs_trust(&text) {
            if !accept_trust {
                return Err(AppError::msg(format!(
                    "Claude Code asks to trust the working folder. Open `claude` once in that folder and accept, then retry.\n\n{}",
                    text.trim()
                )));
            }
            accept_trust_dialog(screen, writer)?;
        } else if first_run_screen(&text) {
            writer.write_all(b"\r")?;
            writer.flush()?;
            std::thread::sleep(Duration::from_millis(1500));
        } else if login_needed(&text) {
            return Err(AppError::msg("This Claude profile is not logged in."));
        } else if prompt_ready(&text) {
            break;
        }
        if std::time::Instant::now() > deadline {
            return Err(AppError::msg(format!("Claude Code did not become ready in time.\n\n{}", text.trim())));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    std::thread::sleep(Duration::from_millis(1200));
    for ch in command.chars() {
        writer.write_all(ch.to_string().as_bytes())?;
        writer.flush()?;
        std::thread::sleep(Duration::from_millis(40));
    }
    std::thread::sleep(Duration::from_millis(700));
    writer.write_all(b"\r")?;
    writer.flush()?;

    if !screen.wait(Duration::from_secs(30), shown) {
        return Err(AppError::msg(format!("{command} did not show the expected screen.\n\n{}", screen.text().trim())));
    }
    screen.settle(Duration::from_millis(2500), Duration::from_secs(12));
    Ok(())
}

/// Moves the trust dialog selection to "Yes, I trust this folder" and confirms it.
fn accept_trust_dialog(screen: &mut Screen, writer: &mut Box<dyn Write + Send>) -> AppResult<()> {
    let yes_selected = Regex::new(r"❯\s*(?:\d\.\s*)?Yes").unwrap();
    for _ in 0..3 {
        if yes_selected.is_match(&screen.text()) {
            break;
        }
        writer.write_all(b"\x1b[B")?;
        writer.flush()?;
        screen.wait(Duration::from_millis(800), |t| yes_selected.is_match(t));
    }
    if !yes_selected.is_match(&screen.text()) {
        return Err(AppError::msg("Could not select the trust option for claude-storm's probe folder."));
    }
    writer.write_all(b"\r")?;
    writer.flush()?;
    screen.wait(Duration::from_secs(20), |t| !needs_trust(t) && (t.contains('❯') || t.contains("for shortcuts")));
    Ok(())
}

/// First-run screens of a new profile that only need Enter (theme picker, security notes).
fn first_run_screen(text: &str) -> bool {
    text.contains("Choose the text style") || text.contains("Press Enter to continue")
}

/// The input prompt box is visible and no dialog or menu is on screen.
fn prompt_ready(text: &str) -> bool {
    if first_run_screen(text) || needs_trust(text) || text.contains("Enter to confirm") {
        return false;
    }
    text.contains("for shortcuts") || (text.contains("────") && text.lines().any(|l| l.trim_start().starts_with('❯')))
}

/// Detects Claude Code's folder trust dialog.
fn needs_trust(text: &str) -> bool {
    text.contains("trust this folder") || text.contains("trust the files")
}

/// Heuristic for the first-run login screen.
fn login_needed(text: &str) -> bool {
    text.contains("Select login method") || text.contains("/login") && text.contains("not logged in")
}

/// Incrementally rendered virtual terminal fed from the PTY output buffer.
pub struct Screen {
    buffer: Arc<Mutex<Vec<u8>>>,
    consumed: usize,
    parser: vt100::Parser,
    last_change: Instant,
}

impl Screen {
    /// Creates a screen bound to the shared output buffer.
    fn new(buffer: Arc<Mutex<Vec<u8>>>) -> Self {
        Self { buffer, consumed: 0, parser: vt100::Parser::new(ROWS, COLS, 0), last_change: Instant::now() }
    }

    /// Feeds any new bytes into the virtual terminal.
    pub fn pump(&mut self) {
        let buf = self.buffer.lock().unwrap();
        if buf.len() > self.consumed {
            self.parser.process(&buf[self.consumed..]);
            self.consumed = buf.len();
            self.last_change = Instant::now();
        }
    }

    /// Current rendered text.
    pub fn text(&self) -> String {
        self.parser.screen().contents()
    }

    /// Polls until the predicate holds or the timeout expires.
    fn wait(&mut self, timeout: Duration, predicate: impl Fn(&str) -> bool) -> bool {
        let start = Instant::now();
        while start.elapsed() < timeout {
            self.pump();
            if predicate(&self.text()) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        false
    }

    /// Waits until no output arrives for `quiet`, bounded by `max`.
    fn settle(&mut self, quiet: Duration, max: Duration) {
        let start = Instant::now();
        while start.elapsed() < max {
            self.pump();
            if self.last_change.elapsed() >= quiet {
                return;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }
}

#[cfg(test)]
mod manual {
    /// Runs the real probe; `CLAUDE_STORM_PROBE_CWD=<trusted dir> cargo test real_probe -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_probe() {
        let cwd = std::env::var("CLAUDE_STORM_PROBE_CWD").expect("set CLAUDE_STORM_PROBE_CWD");
        let claude = crate::shell_env::which("claude").expect("claude in PATH");
        let out = super::run(&claude, std::path::Path::new(&cwd), &Default::default(), &["ANTHROPIC_API_KEY"], std::env::var("CLAUDE_STORM_PROBE_TRUST").is_ok()).unwrap();
        let bars = crate::usage::parser::parse_usage(&out.screen, chrono::Utc::now());
        for b in &bars {
            println!("{} -> {}% resets {:?} ({:?})", b.label, b.percent, b.resets_text, b.resets_at);
        }
        assert!(!bars.is_empty(), "{}", out.screen);
    }

    /// Prints the `/model` picker of the installed Claude Code.
    #[test]
    #[ignore]
    fn real_model_picker() {
        let cwd = std::env::var("CLAUDE_STORM_PROBE_CWD").expect("set CLAUDE_STORM_PROBE_CWD");
        let claude = crate::shell_env::which("claude").expect("claude in PATH");
        let models = super::read_model_picker(&claude, std::path::Path::new(&cwd), &Default::default(), &["ANTHROPIC_API_KEY"], true).unwrap();
        for m in &models {
            println!("{} | {} | {}", m.id, m.label, m.description);
        }
        assert!(models.len() >= 4);
    }
}

#[cfg(test)]
mod screen_tests {
    use super::{first_run_screen, prompt_ready};

    const THEME: &str = "Welcome to Claude Code v2.1.300\n Choose the text style that looks best with your terminal\n ❯ ✔ Dark mode\n     Light mode";
    const NOTES: &str = "Welcome to Claude Code\n Security notes:\n 1. Claude can make mistakes.\n Press Enter to continue…";
    const PROMPT: &str = "────────────\n❯\u{a0}Try \"fix lint errors\"\n────────────\n  ⏵⏵ auto mode on";

    #[test]
    fn first_run_screens_are_not_the_prompt() {
        assert!(first_run_screen(THEME) && !prompt_ready(THEME));
        assert!(first_run_screen(NOTES) && !prompt_ready(NOTES));
    }

    #[test]
    fn real_prompt_box_is_ready() {
        assert!(prompt_ready(PROMPT));
        assert!(!first_run_screen(PROMPT));
    }
}

#[cfg(test)]
mod onboarding_capture {
    use std::io::{Read, Write};
    use std::time::Duration;

    /// Prints the first screens of a profile: `CLAUDE_STORM_PROFILE_DIR=<dir> cargo test capture_first_run -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn capture_first_run() {
        let profile = std::env::var("CLAUDE_STORM_PROFILE_DIR").expect("set CLAUDE_STORM_PROFILE_DIR");
        let cwd = std::env::temp_dir().join("claude-storm-onboarding-probe");
        std::fs::create_dir_all(&cwd).unwrap();
        let claude = crate::shell_env::which("claude").unwrap();
        let mut env = std::collections::HashMap::new();
        env.insert("CLAUDE_CONFIG_DIR".to_string(), profile);
        let proc = crate::pty::spawn(&claude.to_string_lossy(), &[], &cwd, &env, crate::accounts::AUTH_VARS, 50, 120).unwrap();
        let mut reader = proc.master.try_clone_reader().unwrap();
        let mut writer = proc.master.take_writer().unwrap();
        let buf = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = buf.clone();
        std::thread::spawn(move || {
            let mut chunk = [0u8; 8192];
            while let Ok(n) = reader.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                sink.lock().unwrap().extend_from_slice(&chunk[..n]);
            }
        });
        for round in 0..6 {
            std::thread::sleep(Duration::from_secs(4));
            let mut parser = vt100::Parser::new(50, 120, 0);
            parser.process(&buf.lock().unwrap());
            println!("===== round {round} =====\n{}", parser.screen().contents().lines().filter(|l| !l.trim().is_empty()).collect::<Vec<_>>().join("\n"));
            let _ = writer.write_all(b"\r");
            let _ = writer.flush();
        }
        let mut child = proc.child;
        let _ = child.kill();
    }
}
