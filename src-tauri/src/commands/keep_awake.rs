use tauri::{AppHandle, Emitter, State};

use crate::error::AppResult;
use crate::keep_awake::{KeepAwake, KeepAwakeState};

/// Every window shows the same toggle, so all of them hear about changes.
pub const KEEP_AWAKE_CHANGED: &str = "keep-awake-changed";

/// Whether this OS can keep the screen awake and whether it is on.
#[tauri::command]
pub fn keep_awake_state(keep_awake: State<KeepAwake>) -> KeepAwakeState {
    keep_awake.state()
}

/// Turns "keep the screen awake" on or off.
#[tauri::command]
pub fn set_keep_awake(app: AppHandle, keep_awake: State<KeepAwake>, on: bool) -> AppResult<KeepAwakeState> {
    let state = keep_awake.set(on)?;
    let _ = app.emit(KEEP_AWAKE_CHANGED, state);
    Ok(state)
}
