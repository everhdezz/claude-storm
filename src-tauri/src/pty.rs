use std::collections::HashMap;
use std::path::Path;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use crate::error::{AppError, AppResult};

/// A process running inside a pseudo-terminal.
pub struct PtyProcess {
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}

/// Spawns `program` inside a new PTY with the login environment plus `env` overrides.
pub fn spawn(
    program: &str,
    args: &[&str],
    cwd: &Path,
    env: &HashMap<String, String>,
    remove_env: &[&str],
    rows: u16,
    cols: u16,
) -> AppResult<PtyProcess> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| AppError::msg(format!("Could not open a pseudo-terminal: {e}")))?;
    let mut cmd = CommandBuilder::new(program);
    cmd.args(args);
    cmd.cwd(cwd);
    cmd.env_clear();
    for (k, v) in crate::shell_env::login_env() {
        cmd.env(k, v);
    }
    for key in remove_env {
        cmd.env_remove(key);
    }
    for (k, v) in env {
        cmd.env(k, v);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::msg(format!("Could not start {program}: {e}")))?;
    drop(pair.slave);
    Ok(PtyProcess { master: pair.master, child })
}

/// Splits a byte buffer into valid UTF-8 text plus an incomplete trailing sequence.
pub fn take_utf8(carry: &mut Vec<u8>) -> String {
    match std::str::from_utf8(carry) {
        Ok(text) => {
            let out = text.to_string();
            carry.clear();
            out
        }
        Err(err) if err.error_len().is_none() => {
            let valid = err.valid_up_to();
            let out = String::from_utf8_lossy(&carry[..valid]).to_string();
            carry.drain(..valid);
            out
        }
        Err(_) => {
            let out = String::from_utf8_lossy(carry).to_string();
            carry.clear();
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::take_utf8;

    #[test]
    fn keeps_split_multibyte_sequence_for_next_chunk() {
        let bytes = "añ".as_bytes();
        let mut carry = bytes[..2].to_vec();
        assert_eq!(take_utf8(&mut carry), "a");
        carry.extend_from_slice(&bytes[2..]);
        assert_eq!(take_utf8(&mut carry), "ñ");
        assert!(carry.is_empty());
    }
}
