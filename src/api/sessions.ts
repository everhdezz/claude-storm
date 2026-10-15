import type { ApprovalDecision, AppSettings, CatalogModel, ChatItem, ClaudeAccount, NewSessionInput, PendingMessage, RepoDiff, Session, SessionFolder, WorktreeCleanup } from "../types";
import { invoke } from "@tauri-apps/api/core";
import { call, errorMessage } from "./tauri";
import { t } from "../i18n";

export const SESSION_CHANGED = "session-changed";
export const SESSION_ITEM = "session-item";
export const SESSION_DELTA = "session-delta";
export const SESSION_DELETED = "session-deleted";

/** Claude Code permission modes, in Shift+Tab cycling order. */
export const PERMISSION_OPTIONS = [
  { value: "default", label: t("Ask permissions"), description: t("Asks before editing files or running commands"), color: "gray" },
  { value: "acceptEdits", label: t("Accept edits"), description: t("Edits files without asking; asks before commands"), color: "violet" },
  { value: "plan", label: t("Plan only"), description: t("Explores and proposes a plan without changing anything"), color: "teal" },
  { value: "auto", label: "Auto", description: t("Decides on its own and only asks for risky actions"), color: "orange" },
  { value: "bypassPermissions", label: t("No restrictions"), description: t("Never asks; use it only in trusted repos"), color: "red" },
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

/** Edits a session's title, description, model or permission mode, or forgets its "always allow" rules. */
export function updateSession(
  sessionId: string,
  patch: { title?: string; description?: string; model?: string; permissionMode?: string; clearAllowedTools?: boolean },
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
  if (!model) return t("Default");
  return catalog.find((m) => m.id === model)?.label ?? model;
}

/** Model a session actually uses: the one Claude Code reported, else the configured fallback chain. */
export function sessionModelLabel(session: Session, account: ClaudeAccount | null, settings: AppSettings): string {
  const model = session.lastModel ?? session.model ?? account?.defaultModel ?? settings.defaultModel;
  return model ? modelLabel(model, settings.catalog) : t("Claude Code's model");
}

/** Folders a session works in: its worktrees, or the repos themselves for direct sessions. */
export function sessionFolders(sessionId: string): Promise<SessionFolder[]> {
  return call("session_folders", { sessionId });
}

/** Writes a file pasted from the clipboard to disk and returns its path, ready to attach. */
export async function savePastedFile(file: File, name = file.name): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return await invoke<string>("save_pasted_file", bytes, { headers: { "x-file-name": encodeURIComponent(name) } });
  } catch (err) {
    throw new Error(errorMessage(err));
  }
}

/** Sends the queued messages now, interrupting Claude's current turn if it is working. */
export function sessionSendNow(sessionId: string): Promise<void> {
  return call("session_send_now", { sessionId });
}

/** Removes a queued message and returns it (to edit it in the composer). */
export function sessionRemovePending(sessionId: string, messageId: string): Promise<PendingMessage | null> {
  return call("session_remove_pending", { sessionId, messageId });
}

/** Answers a permission prompt or question Claude is waiting on. */
export function sessionAnswerApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<void> {
  return call("session_answer_approval", { sessionId, approvalId, decision });
}
