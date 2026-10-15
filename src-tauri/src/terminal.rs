use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;

use portable_pty::{Child, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;

use crate::error::{AppError, AppResult};
use crate::models::new_id;
use crate::pty;

/// Messages streamed to the terminal view.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum TerminalEvent {
    Output { data: String },
    Exit,
}

/// Public description of an open terminal.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub id: String,
    pub project_id: String,
    pub cwd: String,
    pub title: String,
}

struct Terminal {
    info: TerminalInfo,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// Interactive shells opened from project windows.
#[derive(Default)]
pub struct TerminalManager {
    terms: Mutex<HashMap<String, Terminal>>,
}

/// The user's interactive shell for the current platform.
fn user_shell() -> (String, Vec<&'static str>) {
    if cfg!(windows) {
        let shell = crate::shell_env::login_env().get("COMSPEC").cloned().unwrap_or_else(|| "cmd.exe".into());
        (shell, vec![])
    } else {
        let shell = crate::shell_env::login_env().get("SHELL").cloned().unwrap_or_else(|| "/bin/zsh".into());
        (shell, vec!["-l"])
    }
}

impl TerminalManager {
    /// Opens a login shell in `cwd` and streams its output through `channel`.
    pub fn open(&self, project_id: &str, cwd: &str, cols: u16, rows: u16, channel: Channel<TerminalEvent>) -> AppResult<TerminalInfo> {
        let (shell, args) = user_shell();
        let proc = pty::spawn(&shell, &args, Path::new(cwd), &HashMap::new(), &[], rows.max(2), cols.max(10))?;
        let mut reader = proc.master.try_clone_reader().map_err(|e| AppError::msg(e.to_string()))?;
        let writer = proc.master.take_writer().map_err(|e| AppError::msg(e.to_string()))?;
        let title = Path::new(cwd).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| cwd.to_string());
        let info = TerminalInfo { id: new_id(), project_id: project_id.to_string(), cwd: cwd.to_string(), title };

        std::thread::spawn(move || {
            let mut chunk = [0u8; 8192];
            let mut carry = Vec::new();
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        carry.extend_from_slice(&chunk[..n]);
                        let data = pty::take_utf8(&mut carry);
                        if !data.is_empty() && channel.send(TerminalEvent::Output { data }).is_err() {
                            break;
                        }
                    }
                }
            }
            let _ = channel.send(TerminalEvent::Exit);
        });

        #[cfg(debug_assertions)]
        eprintln!("[terminal] open {} in {}", info.id, info.cwd);
        self.terms.lock().unwrap().insert(
            info.id.clone(),
            Terminal { info: info.clone(), master: proc.master, writer, child: proc.child },
        );
        Ok(info)
    }

    /// Sends keystrokes to a terminal.
    pub fn write(&self, id: &str, data: &str) -> AppResult<()> {
        let mut terms = self.terms.lock().unwrap();
        let term = terms.get_mut(id).ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
        term.writer.write_all(data.as_bytes())?;
        term.writer.flush()?;
        Ok(())
    }

    /// Resizes the PTY to match the view.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let terms = self.terms.lock().unwrap();
        let term = terms.get(id).ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
        term.master
            .resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| AppError::msg(e.to_string()))
    }

    /// Kills the shell and releases the PTY (which hangs up its whole session).
    pub fn close(&self, id: &str) {
        #[cfg(debug_assertions)]
        eprintln!("[terminal] close {id}");
        if let Some(mut term) = self.terms.lock().unwrap().remove(id) {
            let _ = term.child.kill();
            let _ = term.child.wait();
        }
    }

    /// Lists terminals of a project.
    pub fn list(&self, project_id: &str) -> Vec<TerminalInfo> {
        self.terms.lock().unwrap().values().filter(|t| t.info.project_id == project_id).map(|t| t.info.clone()).collect()
    }

    /// Closes every terminal of a project.
    pub fn close_project(&self, project_id: &str) {
        let ids: Vec<String> = self.list(project_id).into_iter().map(|t| t.id).collect();
        for id in ids {
            self.close(&id);
        }
    }

    /// Closes every terminal (app exit).
    pub fn close_all(&self) {
        let ids: Vec<String> = self.terms.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.close(&id);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use tauri::ipc::{Channel, InvokeResponseBody};

    use super::TerminalManager;

    #[test]
    fn shell_echoes_written_command() {
        let output = Arc::new(Mutex::new(String::new()));
        let sink = output.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push_str(&json);
            }
            Ok(())
        });
        let manager = TerminalManager::default();
        let info = manager.open("p", &std::env::temp_dir().to_string_lossy(), 80, 24, channel).unwrap();
        manager.write(&info.id, "echo claude-storm-$((40+2))\r").unwrap();
        let start = Instant::now();
        while !output.lock().unwrap().contains("claude-storm-42") {
            assert!(start.elapsed() < Duration::from_secs(15), "no echo: {}", output.lock().unwrap());
            std::thread::sleep(Duration::from_millis(100));
        }
        manager.resize(&info.id, 120, 40).unwrap();
        manager.close(&info.id);
        assert!(manager.list("p").is_empty());
    }
}
