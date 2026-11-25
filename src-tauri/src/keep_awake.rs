//! Keeps the screen and the computer awake while ClaudeStorm works, with the OS's own tool running
//! in the background: `caffeinate -d` on macOS, `systemd-inhibit` on Linux and
//! `SetThreadExecutionState` (through PowerShell) on Windows. Each one also watches ClaudeStorm's
//! pid, so it ends by itself if the app crashes.

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Whether this OS can keep awake, and whether it is doing it now.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepAwakeState {
    pub supported: bool,
    pub active: bool,
}

/// The background process holding the "stay awake" assertion, if any.
#[derive(Default)]
pub struct KeepAwake {
    child: Mutex<Option<Child>>,
}

impl KeepAwake {
    pub fn state(&self) -> KeepAwakeState {
        let mut child = self.child.lock().unwrap();
        // Something else may have ended it (killed from a terminal, systemd gone…).
        if child.as_mut().is_some_and(|c| !matches!(c.try_wait(), Ok(None))) {
            *child = None;
        }
        KeepAwakeState { supported: command().is_some(), active: child.is_some() }
    }

    pub fn set(&self, on: bool) -> AppResult<KeepAwakeState> {
        if on && !self.state().active {
            let mut cmd = command().ok_or_else(|| AppError::msg("This system has no tool to keep the screen awake."))?;
            cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            let child = cmd.spawn().map_err(|e| AppError::msg(format!("Could not keep the screen awake: {e}")))?;
            *self.child.lock().unwrap() = Some(child);
        } else if !on {
            self.stop();
        }
        Ok(self.state())
    }

    /// Lets the computer sleep again (also on app exit).
    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// The OS-specific command, or None when this system has no such tool.
fn command() -> Option<Command> {
    let pid = std::process::id().to_string();
    if cfg!(target_os = "macos") {
        let path = crate::shell_env::which("caffeinate")?;
        let mut cmd = crate::shell_env::command(&path.to_string_lossy());
        // -d: display, -i: idle sleep; -w: ends when ClaudeStorm ends.
        cmd.args(["-d", "-i", "-w", &pid]);
        Some(cmd)
    } else if cfg!(target_os = "linux") {
        let path = crate::shell_env::which("systemd-inhibit")?;
        let mut cmd = crate::shell_env::command(&path.to_string_lossy());
        cmd.args(["--what=idle:sleep", "--who=ClaudeStorm", "--why=Keep the screen awake", "--mode=block"])
            .args(["sh", "-c", &format!("while kill -0 {pid} 2>/dev/null; do sleep 30; done")]);
        Some(cmd)
    } else if cfg!(windows) {
        let path = crate::shell_env::which("powershell")?;
        let mut cmd = crate::shell_env::command(&path.to_string_lossy());
        // ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED, held while ClaudeStorm runs.
        let script = format!(
            "$t = Add-Type -Name P -Namespace W -PassThru -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'; \
             [void]$t::SetThreadExecutionState(0x80000003); Wait-Process -Id {pid}"
        );
        cmd.args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script]);
        Some(cmd)
    } else {
        None
    }
}
