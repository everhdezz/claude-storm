use tauri::ipc::Channel;
use tauri::State;

use crate::error::AppResult;
use crate::terminal::{TerminalEvent, TerminalInfo, TerminalManager};

/// Opens a shell in a folder of the project.
#[tauri::command]
pub fn terminal_open(
    terminals: State<TerminalManager>,
    project_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> AppResult<TerminalInfo> {
    terminals.open(&project_id, &cwd, cols, rows, on_event)
}

/// Forwards keystrokes to a terminal.
#[tauri::command]
pub fn terminal_write(terminals: State<TerminalManager>, id: String, data: String) -> AppResult<()> {
    terminals.write(&id, &data)
}

/// Resizes a terminal.
#[tauri::command]
pub fn terminal_resize(terminals: State<TerminalManager>, id: String, cols: u16, rows: u16) -> AppResult<()> {
    terminals.resize(&id, cols, rows)
}

/// Closes a terminal and its shell.
#[tauri::command]
pub fn terminal_close(terminals: State<TerminalManager>, id: String) {
    terminals.close(&id);
}
