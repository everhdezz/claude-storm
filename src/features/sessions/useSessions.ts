import { useEffect, useRef, useState } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { listSessions, SESSION_CHANGED, SESSION_DELETED } from "../../api/sessions";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import type { Session } from "../../types";

/** Live list of a project's sessions; notifies when an unselected session finishes or fails. */
export function useSessions(projectId: string, selectedId: string | null) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => {
    listSessions(projectId).then(setSessions).catch(() => setSessions([]));
  }, [projectId]);

  useTauriEvent<Session>(SESSION_CHANGED, (session) => {
    if (session.projectId !== projectId) return;
    setSessions((prev) => {
      const before = prev.find((s) => s.id === session.id);
      if (before?.status === "working" && session.status !== "working" && session.id !== selectedRef.current) {
        notifyFinished(session);
      }
      const rest = prev.filter((s) => s.id !== session.id);
      return [session, ...rest].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    });
  });

  useTauriEvent<string>(SESSION_DELETED, (id) => setSessions((prev) => prev.filter((s) => s.id !== id)));

  return sessions;
}

/** Sends a desktop notification about a finished session. */
async function notifyFinished(session: Session) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;
    const failed = session.status === "error";
    sendNotification({
      title: failed ? `Falló: ${session.title}` : `Terminó: ${session.title}`,
      body: failed ? (session.lastError ?? "La sesión terminó con error") : (session.summary ?? "Claude terminó su turno"),
    });
  } catch {
    return;
  }
}
