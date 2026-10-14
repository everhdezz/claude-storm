import { Channel } from "@tauri-apps/api/core";
import { call } from "./tauri";

export type TerminalEvent = { kind: "output"; data: string } | { kind: "exit" };

export interface TerminalInfo {
  id: string;
  projectId: string;
  cwd: string;
  title: string;
}

/** Opens a login shell in a folder; output arrives through `onEvent`. */
export function openTerminal(
  projectId: string,
  cwd: string,
  cols: number,
  rows: number,
  onEvent: (event: TerminalEvent) => void,
): Promise<TerminalInfo> {
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = onEvent;
  return call("terminal_open", { projectId, cwd, cols, rows, onEvent: channel });
}

/** Sends keystrokes to a terminal. */
export function writeTerminal(id: string, data: string): Promise<void> {
  return call("terminal_write", { id, data });
}

/** Resizes a terminal's PTY. */
export function resizeTerminal(id: string, cols: number, rows: number): Promise<void> {
  return call("terminal_resize", { id, cols, rows });
}

/** Closes a terminal and kills its shell. */
export function closeTerminal(id: string): Promise<void> {
  return call("terminal_close", { id });
}
