use std::collections::{HashMap, VecDeque};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;

use crate::commands::windows::project_window_label;
use crate::error::{AppError, AppResult};
use crate::proc_tree::{self, ProcessTree};

/// Maximum log lines kept in memory per process.
const MAX_LOG_LINES: usize = 3000;

pub const PROCESS_LOG: &str = "process-log";
pub const PROCESS_STATUS: &str = "process-status";

/// Lifecycle of a managed command.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessStatus {
    Running,
    Stopping,
    Stopped,
    Exited,
    Failed,
}

/// Public view of a managed process.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub id: String,
    pub project_id: String,
    pub repo_id: String,
    pub command_id: String,
    pub label: String,
    pub command: String,
    pub long_running: bool,
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub ready: bool,
    pub exit_code: Option<i32>,
    pub started_at: DateTime<Utc>,
}

/// One captured output line.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub seq: u64,
    pub stream: &'static str,
    pub text: String,
}

/// Event payload for a new log line.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEvent<'a> {
    process_id: &'a str,
    repo_id: &'a str,
    line: &'a LogLine,
}

/// What DevHub needs to launch a command.
pub struct SpawnRequest {
    pub project_id: String,
    pub repo_id: String,
    pub command_id: String,
    pub label: String,
    pub command: String,
    pub cwd: String,
    pub long_running: bool,
    pub port: Option<u16>,
}

struct Managed {
    info: ProcessInfo,
    tree: Option<Arc<ProcessTree>>,
    logs: VecDeque<LogLine>,
    next_seq: u64,
}

/// Registry of every command started from any project window.
#[derive(Default)]
pub struct ProcessManager {
    procs: Mutex<HashMap<String, Managed>>,
}

/// Stable id of the process running a given repo command.
pub fn process_id(repo_id: &str, command_id: &str) -> String {
    format!("{repo_id}:{command_id}")
}

/// Removes ANSI escape sequences so logs render as plain text.
pub fn strip_ansi(text: &str) -> String {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\r").unwrap());
    re.replace_all(text, "").to_string()
}

/// Returns true when something already listens on the port (IPv4 or IPv6 loopback).
pub fn port_in_use(port: u16) -> bool {
    let timeout = Duration::from_millis(250);
    let addrs: [SocketAddr; 2] = [([127, 0, 0, 1], port).into(), (std::net::Ipv6Addr::LOCALHOST, port).into()];
    addrs.iter().any(|a| TcpStream::connect_timeout(a, timeout).is_ok())
        || TcpListener::bind(("0.0.0.0", port)).is_err()
}

impl ProcessManager {
    /// Lists the processes that belong to a project.
    pub fn list(&self, project_id: &str) -> Vec<ProcessInfo> {
        let procs = self.procs.lock().unwrap();
        let mut list: Vec<_> = procs.values().filter(|m| m.info.project_id == project_id).map(|m| m.info.clone()).collect();
        list.sort_by_key(|p| p.started_at);
        list
    }

    /// Returns the buffered output of a process.
    pub fn logs(&self, id: &str) -> Vec<LogLine> {
        self.procs.lock().unwrap().get(id).map(|m| m.logs.iter().cloned().collect()).unwrap_or_default()
    }

    /// Clears the buffered output of a process.
    pub fn clear_logs(&self, id: &str) {
        if let Some(m) = self.procs.lock().unwrap().get_mut(id) {
            m.logs.clear();
        }
    }

    /// Forgets finished processes of a project (used by the "clear" button).
    pub fn forget(&self, id: &str) {
        let mut procs = self.procs.lock().unwrap();
        if procs.get(id).is_some_and(|m| !matches!(m.info.status, ProcessStatus::Running | ProcessStatus::Stopping)) {
            procs.remove(id);
        }
    }

    /// Spawns a command through the login shell and starts streaming its output.
    pub fn spawn<R: Runtime>(&self, app: &AppHandle<R>, req: SpawnRequest) -> AppResult<ProcessInfo> {
        let id = process_id(&req.repo_id, &req.command_id);
        if self.procs.lock().unwrap().get(&id).is_some_and(|m| matches!(m.info.status, ProcessStatus::Running | ProcessStatus::Stopping)) {
            return Err(AppError::msg(format!("\"{}\" is already running", req.label)));
        }

        let runtime = tauri::async_runtime::handle();
        let _context = runtime.inner().enter();
        let (program, args) = crate::shell_env::shell_invocation(&req.command);
        let mut cmd: Command = crate::shell_env::async_command(&program);
        cmd.args(&args)
            .current_dir(&req.cwd)
            .env("FORCE_COLOR", "0")
            .env("BROWSER", "none")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        proc_tree::isolate(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| AppError::msg(format!("Could not start \"{}\": {e}", req.command)))?;
        let tree = Arc::new(ProcessTree::attach(&child)?);

        let info = ProcessInfo {
            id: id.clone(),
            project_id: req.project_id.clone(),
            repo_id: req.repo_id,
            command_id: req.command_id,
            label: req.label,
            command: req.command.clone(),
            long_running: req.long_running,
            status: ProcessStatus::Running,
            pid: Some(tree.pid()),
            port: req.port.filter(|_| req.long_running),
            ready: false,
            exit_code: None,
            started_at: Utc::now(),
        };
        let mut logs = VecDeque::new();
        logs.push_back(LogLine { seq: 0, stream: "system", text: format!("$ {}  (in {})", req.command, req.cwd) });
        self.procs.lock().unwrap().insert(id.clone(), Managed { info: info.clone(), tree: Some(tree), logs, next_seq: 1 });
        emit_status(app, &info);

        if let Some(out) = child.stdout.take() {
            pump(app.clone(), id.clone(), "stdout", out);
        }
        if let Some(err) = child.stderr.take() {
            pump(app.clone(), id.clone(), "stderr", err);
        }
        if let Some(port) = info.port {
            watch_ready(app.clone(), id.clone(), port);
        }
        let app_wait = app.clone();
        tauri::async_runtime::spawn(async move {
            let status = child.wait().await;
            let manager = app_wait.state::<ProcessManager>();
            let info = manager.update(&id, |m| {
                let code = status.as_ref().ok().and_then(|s| s.code());
                m.info.exit_code = code;
                m.info.ready = false;
                m.info.status = match (m.info.status, code) {
                    (ProcessStatus::Stopping, _) => ProcessStatus::Stopped,
                    (_, Some(0)) => ProcessStatus::Exited,
                    _ => ProcessStatus::Failed,
                };
                m.tree = None;
            });
            if let Some(info) = info {
                let text = match info.status {
                    ProcessStatus::Stopped => "Process stopped".to_string(),
                    _ => format!("Process exited with code {}", info.exit_code.map_or("?".into(), |c| c.to_string())),
                };
                manager.push_log(&app_wait, &id, "system", text);
                emit_status(&app_wait, &info);
            }
        });
        Ok(info)
    }

    /// Stops a process tree: SIGTERM, then SIGKILL after a grace period.
    pub async fn stop<R: Runtime>(&self, app: &AppHandle<R>, id: &str) -> AppResult<()> {
        let tree = {
            let mut procs = self.procs.lock().unwrap();
            let m = procs.get_mut(id).ok_or_else(|| AppError::NotFound(format!("process {id}")))?;
            m.info.status = ProcessStatus::Stopping;
            emit_status(app, &m.info);
            m.tree.clone()
        };
        if let Some(tree) = tree {
            tree.shutdown().await;
        }
        Ok(())
    }

    /// Stops every process of a project (window closed).
    pub fn stop_project(&self, project_id: &str) {
        let trees: Vec<Arc<ProcessTree>> = {
            let mut procs = self.procs.lock().unwrap();
            procs
                .values_mut()
                .filter(|m| m.info.project_id == project_id)
                .filter_map(|m| {
                    m.info.status = ProcessStatus::Stopping;
                    m.tree.clone()
                })
                .collect()
        };
        tauri::async_runtime::spawn(async move {
            for tree in &trees {
                tree.terminate();
            }
            tokio::time::sleep(Duration::from_millis(2500)).await;
            for tree in &trees {
                tree.kill();
            }
        });
    }

    /// Kills everything synchronously; called when the app exits.
    pub fn kill_all_blocking(&self) {
        let trees: Vec<Arc<ProcessTree>> = self.procs.lock().unwrap().values().filter_map(|m| m.tree.clone()).collect();
        for tree in &trees {
            tree.terminate();
        }
        if !trees.is_empty() {
            std::thread::sleep(Duration::from_millis(800));
        }
        for tree in &trees {
            tree.kill();
        }
    }

    /// Mutates a managed process and returns its updated info.
    fn update(&self, id: &str, f: impl FnOnce(&mut Managed)) -> Option<ProcessInfo> {
        let mut procs = self.procs.lock().unwrap();
        let m = procs.get_mut(id)?;
        f(m);
        Some(m.info.clone())
    }

    /// Appends a log line, trims the buffer and emits it to the project window.
    fn push_log<R: Runtime>(&self, app: &AppHandle<R>, id: &str, stream: &'static str, text: String) {
        let mut procs = self.procs.lock().unwrap();
        let Some(m) = procs.get_mut(id) else { return };
        let line = LogLine { seq: m.next_seq, stream, text };
        m.next_seq += 1;
        m.logs.push_back(line.clone());
        while m.logs.len() > MAX_LOG_LINES {
            m.logs.pop_front();
        }
        let label = project_window_label(&m.info.project_id);
        let _ = app.emit_to(label.as_str(), PROCESS_LOG, LogEvent { process_id: id, repo_id: &m.info.repo_id, line: &line });
    }
}

/// Sends the current status of a process to its project window.
fn emit_status<R: Runtime>(app: &AppHandle<R>, info: &ProcessInfo) {
    let _ = app.emit_to(project_window_label(&info.project_id).as_str(), PROCESS_STATUS, info);
}

/// Streams a child pipe line by line into the log buffer.
fn pump<R: Runtime>(app: AppHandle<R>, id: String, stream: &'static str, pipe: impl AsyncRead + Unpin + Send + 'static) {
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(pipe);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let text = strip_ansi(String::from_utf8_lossy(&buf).trim_end_matches(['\n', '\r']));
                    app.state::<ProcessManager>().push_log(&app, &id, stream, text);
                }
            }
        }
    });
}

/// Polls the configured port until the server accepts connections, then flags it as ready.
fn watch_ready<R: Runtime>(app: AppHandle<R>, id: String, port: u16) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(1000)).await;
            let manager = app.state::<ProcessManager>();
            let running = manager.procs.lock().unwrap().get(&id).is_some_and(|m| m.info.status == ProcessStatus::Running);
            if !running {
                return;
            }
            let open = tokio::task::spawn_blocking(move || {
                let addrs: [SocketAddr; 2] = [([127, 0, 0, 1], port).into(), (std::net::Ipv6Addr::LOCALHOST, port).into()];
                addrs.iter().any(|a| TcpStream::connect_timeout(a, Duration::from_millis(300)).is_ok())
            })
            .await
            .unwrap_or(false);
            if open {
                if let Some(info) = manager.update(&id, |m| m.info.ready = true) {
                    emit_status(&app, &info);
                }
                return;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::strip_ansi;

    #[test]
    fn strips_colors_and_carriage_returns() {
        assert_eq!(strip_ansi("\x1b[32m  VITE\x1b[39m ready\r"), "  VITE ready");
        assert_eq!(strip_ansi("\x1b]0;title\x07plain"), "plain");
    }
}

#[cfg(all(test, unix))]
mod integration {
    use super::*;

    /// Waits until a predicate over the manager holds, failing after a timeout.
    async fn wait_for<R: Runtime>(app: &AppHandle<R>, what: &str, f: impl Fn(&ProcessManager) -> bool) {
        for _ in 0..100 {
            if f(&app.state::<ProcessManager>()) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("timed out waiting for {what}");
    }

    #[tokio::test]
    async fn spawn_streams_logs_and_stop_kills_tree() {
        let app = tauri::test::mock_builder()
            .manage(ProcessManager::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle().clone();
        let manager = handle.state::<ProcessManager>();
        let info = manager
            .spawn(
                &handle,
                SpawnRequest {
                    project_id: "p".into(),
                    repo_id: "r".into(),
                    command_id: "c".into(),
                    label: "dev".into(),
                    command: "printf '\\033[32mhello\\033[0m\\n'; echo oops >&2; sleep 30".into(),
                    cwd: std::env::temp_dir().to_string_lossy().to_string(),
                    long_running: true,
                    port: None,
                },
            )
            .unwrap();
        assert_eq!(info.status, ProcessStatus::Running);
        wait_for(&handle, "logs", |m| m.logs(&info.id).iter().any(|l| l.text == "hello" && l.stream == "stdout")).await;
        wait_for(&handle, "stderr", |m| m.logs(&info.id).iter().any(|l| l.text == "oops" && l.stream == "stderr")).await;
        assert!(manager.spawn(&handle, SpawnRequest {
            project_id: "p".into(), repo_id: "r".into(), command_id: "c".into(), label: "dev".into(),
            command: "true".into(), cwd: "/".into(), long_running: false, port: None,
        }).is_err(), "duplicate start must be rejected");

        manager.stop(&handle, &info.id).await.unwrap();
        wait_for(&handle, "stopped", |m| m.list("p")[0].status == ProcessStatus::Stopped).await;
    }

    /// Regression: sync Tauri commands run on the main thread without a Tokio context.
    #[test]
    fn spawn_works_outside_a_tokio_runtime() {
        let app = tauri::test::mock_builder()
            .manage(ProcessManager::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle().clone();
        let info = handle
            .state::<ProcessManager>()
            .spawn(
                &handle,
                SpawnRequest {
                    project_id: "p".into(),
                    repo_id: "r".into(),
                    command_id: "c".into(),
                    label: "echo".into(),
                    command: "echo ok".into(),
                    cwd: std::env::temp_dir().to_string_lossy().to_string(),
                    long_running: false,
                    port: None,
                },
            )
            .unwrap();
        assert_eq!(info.status, ProcessStatus::Running);
    }

    #[test]
    fn detects_busy_port() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(port_in_use(port));
        drop(listener);
    }
}
