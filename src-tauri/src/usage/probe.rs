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
/// `accept_trust` may only be true for DevHub's own empty probe folder: trusting it exposes nothing.
pub fn run(
    claude: &Path,
    cwd: &Path,
    env: &HashMap<String, String>,
    remove_env: &[&str],
    accept_trust: bool,
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
    let result = drive(&mut screen, &mut writer, accept_trust);
    let _ = writer.write_all(b"\x1b");
    let _ = proc.child.kill();
    let _ = proc.child.wait();
    result.map(|_| ProbeOutput { screen: screen.text() })
}

/// Performs the interactive steps, returning an explanatory error when something blocks.
fn drive(screen: &mut Screen, writer: &mut Box<dyn Write + Send>, accept_trust: bool) -> AppResult<()> {
    let ready = screen.wait(Duration::from_secs(30), |t| {
        t.contains("for shortcuts") || t.contains('❯') || t.contains("trust this folder") || t.contains("trust the files") || login_needed(t)
    });
    let mut text = screen.text();
    if accept_trust && needs_trust(&text) {
        accept_trust_dialog(screen, writer)?;
        text = screen.text();
    }
    if !ready {
        return Err(AppError::msg(format!("Claude Code did not become ready in time.\n\n{}", text.trim())));
    }
    if needs_trust(&text) {
        return Err(AppError::msg(format!(
            "Claude Code asks to trust the working folder. Open `claude` once in that folder and accept, then retry.\n\n{}",
            text.trim()
        )));
    }
    if login_needed(&text) {
        return Err(AppError::msg("This Claude profile is not logged in."));
    }
    std::thread::sleep(Duration::from_millis(1200));
    for ch in "/usage".chars() {
        writer.write_all(ch.to_string().as_bytes())?;
        writer.flush()?;
        std::thread::sleep(Duration::from_millis(40));
    }
    std::thread::sleep(Duration::from_millis(700));
    writer.write_all(b"\r")?;
    writer.flush()?;

    let bar = Regex::new(r"\d+\s*%\s*used").unwrap();
    let shown = screen.wait(Duration::from_secs(30), |t| bar.is_match(t) && t.contains("Resets"));
    if !shown {
        return Err(AppError::msg(format!("/usage did not show usage bars.\n\n{}", screen.text().trim())));
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
        return Err(AppError::msg("Could not select the trust option for DevHub's probe folder."));
    }
    writer.write_all(b"\r")?;
    writer.flush()?;
    screen.wait(Duration::from_secs(20), |t| !needs_trust(t) && (t.contains('❯') || t.contains("for shortcuts")));
    Ok(())
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
struct Screen {
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
    fn pump(&mut self) {
        let buf = self.buffer.lock().unwrap();
        if buf.len() > self.consumed {
            self.parser.process(&buf[self.consumed..]);
            self.consumed = buf.len();
            self.last_change = Instant::now();
        }
    }

    /// Current rendered text.
    fn text(&self) -> String {
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
    /// Runs the real probe; `DEVHUB_PROBE_CWD=<trusted dir> cargo test real_probe -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_probe() {
        let cwd = std::env::var("DEVHUB_PROBE_CWD").expect("set DEVHUB_PROBE_CWD");
        let claude = crate::shell_env::which("claude").expect("claude in PATH");
        let out = super::run(&claude, std::path::Path::new(&cwd), &Default::default(), &["ANTHROPIC_API_KEY"], std::env::var("DEVHUB_PROBE_TRUST").is_ok()).unwrap();
        let bars = crate::usage::parser::parse_usage(&out.screen, chrono::Utc::now());
        for b in &bars {
            println!("{} -> {}% resets {:?} ({:?})", b.label, b.percent, b.resets_text, b.resets_at);
        }
        assert!(!bars.is_empty(), "{}", out.screen);
    }
}
