import type { AppSettings, CatalogModel, ChatItem, ClaudeAccount, NewSessionInput, RepoDiff, Session, WorktreeCleanup } from "../types";
import { call } from "./tauri";

export const SESSION_CHANGED = "session-changed";
export const SESSION_ITEM = "session-item";
export const SESSION_DELTA = "session-delta";
export const SESSION_DELETED = "session-deleted";

export const PERMISSION_OPTIONS = [
  { value: "acceptEdits", label: "Aceptar ediciones" },
  { value: "auto", label: "Auto" },
  { value: "plan", label: "Solo planear" },
  { value: "bypassPermissions", label: "Sin restricciones" },
];

/** Lists a project's sessions. */
export function listSessions(projectId: string): Promise<Session[]> {
  return call("list_sessions", { projectId });
}

/** Creates a session (isolated ones get worktrees). */
export function createSession(projectId: string, input: NewSessionInput): Promise<Session> {
  return call("create_session", { projectId, input });
}

/** Loads a session's stored conversation. */
export function sessionHistory(sessionId: string): Promise<ChatItem[]> {
  return call("session_history", { sessionId });
}

/** Sends a prompt, optionally overriding the model for this prompt only. */
export function sendSessionPrompt(sessionId: string, prompt: string, model?: string | null, attachments: string[] = []): Promise<Session> {
  return call("send_session_prompt", { sessionId, prompt, model: model ?? null, attachments });
}

/** Stops a working or queued session. */
export function stopSession(sessionId: string): Promise<void> {
  return call("stop_session", { sessionId });
}

/** Edits a session's title, description, model or permission mode. */
export function updateSession(
  sessionId: string,
  patch: { title?: string; description?: string; model?: string; permissionMode?: string },
): Promise<Session> {
  return call("update_session", { sessionId, patch });
}

/** Duplicates a session. */
export function duplicateSession(sessionId: string): Promise<Session> {
  return call("duplicate_session", { sessionId });
}

/** Archives or restores a session. */
export function archiveSession(sessionId: string, archived: boolean, cleanup?: WorktreeCleanup): Promise<Session> {
  return call("archive_session", { sessionId, archived, cleanup: cleanup ?? null });
}

/** Deletes a session and its history. */
export function deleteSession(sessionId: string, cleanup?: WorktreeCleanup): Promise<void> {
  return call("delete_session", { sessionId, cleanup: cleanup ?? null });
}

/** Diff of a session's repos against their base. */
export function sessionDiff(sessionId: string): Promise<RepoDiff[]> {
  return call("session_diff", { sessionId });
}

/** Commits an isolated session's changes. */
export function sessionCommit(sessionId: string, message: string): Promise<string[]> {
  return call("session_commit", { sessionId, message });
}

/** Merges an isolated session's branch into its base branches. */
export function sessionMerge(sessionId: string): Promise<string[]> {
  return call("session_merge", { sessionId });
}

/** Removes an isolated session's worktrees. */
export function sessionRemoveWorktrees(sessionId: string, deleteBranch: boolean): Promise<void> {
  return call("session_remove_worktrees", { sessionId, deleteBranch });
}

/** True while the session has a live or queued process. */
export function isBusy(session: Session): boolean {
  return session.status === "working" || session.status === "queued";
}

/** Label for a model id given Claude Code's catalog. */
export function modelLabel(model: string | null | undefined, catalog: CatalogModel[] = []): string {
  if (!model) return "Por defecto";
  return catalog.find((m) => m.id === model)?.label ?? model;
}

/** Model a session actually uses: the one Claude Code reported, else the configured fallback chain. */
export function sessionModelLabel(session: Session, account: ClaudeAccount | null, settings: AppSettings): string {
  const model = session.lastModel ?? session.model ?? account?.defaultModel ?? settings.defaultModel;
  return model ? modelLabel(model, settings.catalog) : "Modelo de Claude Code";
}
