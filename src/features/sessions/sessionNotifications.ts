import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { NotificationMode, Session } from "../../types";
import { t, tn } from "../../i18n";

/** Statuses that mean Claude finished a turn and the user may want to look. */
const FINISHED = new Set<Session["status"]>(["done", "waiting", "error"]);

let unseen = 0;
let focusListener: Promise<() => void> | null = null;

/** Clears the Dock badge once the window gets focus again. */
function watchFocus() {
  focusListener ??= getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused && unseen > 0) {
      unseen = 0;
      getCurrentWindow().setBadgeCount(undefined).catch(() => undefined);
    }
  });
}

/** True when Claude started waiting on a new permission prompt or question. */
export function newApproval(before: Session | undefined, after: Session): boolean {
  return after.approvals.length > (before?.approvals.length ?? 0);
}

/** Alerts that Claude is paused waiting for the user (same rules as finished turns). */
export async function notifyApproval(session: Session, mode: NotificationMode, selectedId: string | null) {
  if (mode === "off") return;
  const win = getCurrentWindow();
  const focused = await win.isFocused().catch(() => false);
  if (mode === "background" && focused && session.id === selectedId) return;
  if (!focused) win.requestUserAttention(UserAttentionType.Informational).catch(() => undefined);
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;
    const last = session.approvals[session.approvals.length - 1];
    const question = last?.toolName === "AskUserQuestion";
    sendNotification({
      title: question ? t("Claude has a question · {title}", { title: session.title }) : t("Claude needs your approval · {title}", { title: session.title }),
      body: question ? t("Open the session to answer it.") : t("Wants to use {tool}. Open the session to allow or deny it.", { tool: last?.toolName ?? "" }),
      sound: "Glass",
    });
  } catch {
    return;
  }
}

/** True when a working → finished transition should alert the user. */
export function finishedTurn(before: Session | undefined, after: Session): boolean {
  return before?.status === "working" && FINISHED.has(after.status);
}

/**
 * Tells the user a session finished: a desktop notification with sound, a Dock badge counting
 * finished sessions while the window is in the background, and a Dock bounce on errors.
 * "background" skips everything when the window is focused and showing that same session.
 */
export async function notifySessionFinished(session: Session, mode: NotificationMode, selectedId: string | null) {
  if (mode === "off") return;
  const win = getCurrentWindow();
  const focused = await win.isFocused().catch(() => false);
  if (mode === "background" && focused && session.id === selectedId) return;

  if (!focused) {
    watchFocus();
    unseen += 1;
    win.setBadgeCount(unseen).catch(() => undefined);
    if (session.status === "error") win.requestUserAttention(UserAttentionType.Informational).catch(() => undefined);
  }

  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;
    sendNotification({ title: title(session), body: body(session), sound: "Glass" });
  } catch {
    return;
  }
}

function title(session: Session): string {
  switch (session.status) {
    case "error":
      return t("Failed: {title}", { title: session.title });
    case "waiting":
      return t("Claude replied · {title}", { title: session.title });
    default:
      return t("Finished: {title}", { title: session.title });
  }
}

function body(session: Session): string {
  if (session.status === "error") return session.lastError ?? t("The session ended with an error");
  const files = session.filesTouched.length;
  const changes = session.status === "done" && files > 0 ? `${tn(files, "{count} file changed.", "{count} files changed.")} ` : "";
  return `${changes}${session.summary ?? t("Claude finished its turn")}`;
}
