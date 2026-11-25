import { call } from "./tauri";

export const KEEP_AWAKE_CHANGED = "keep-awake-changed";

/** Whether this OS can keep the screen awake (caffeinate, systemd-inhibit, Windows API) and whether it is on. */
export interface KeepAwakeState {
  supported: boolean;
  active: boolean;
}

export function keepAwakeState(): Promise<KeepAwakeState> {
  return call("keep_awake_state");
}

/** Turns "keep the screen awake" on or off; the change reaches every window. */
export function setKeepAwake(on: boolean): Promise<KeepAwakeState> {
  return call("set_keep_awake", { on });
}
