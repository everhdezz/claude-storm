import type { LogLine, ProcessInfo } from "../types";
import { call } from "./tauri";

export const PROCESS_LOG = "process-log";
export const PROCESS_STATUS = "process-status";

/** Starts a configured repo command. */
export function startCommand(projectId: string, repoId: string, commandId: string): Promise<ProcessInfo> {
  return call("start_command", { projectId, repoId, commandId });
}

/** Stops a process and its whole tree. */
export function stopProcess(processId: string): Promise<void> {
  return call("stop_process", { processId });
}

/** Lists processes of a project. */
export function listProcesses(projectId: string): Promise<ProcessInfo[]> {
  return call("list_processes", { projectId });
}

/** Reads buffered output of a process. */
export function processLogs(processId: string): Promise<LogLine[]> {
  return call("process_logs", { processId });
}

/** Clears buffered output of a process. */
export function clearProcessLogs(processId: string): Promise<void> {
  return call("clear_process_logs", { processId });
}

/** Removes a finished process from the list. */
export function forgetProcess(processId: string): Promise<void> {
  return call("forget_process", { processId });
}

/** Returns true when the port is already taken. */
export function checkPort(port: number): Promise<boolean> {
  return call("check_port", { port });
}

/** Process id used by the backend for a repo command. */
export function processKey(repoId: string, commandId: string): string {
  return `${repoId}:${commandId}`;
}

/** True while the process is alive. */
export function isActive(p: ProcessInfo | undefined): boolean {
  return p?.status === "running" || p?.status === "stopping";
}
