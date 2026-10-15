import { useEffect, useRef, useState } from "react";
import { listSessions, SESSION_CHANGED, SESSION_DELETED } from "../../api/sessions";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import type { NotificationMode, Session } from "../../types";
import { finishedTurn, newApproval, notifyApproval, notifySessionFinished } from "./sessionNotifications";

/** Live list of a project's sessions; notifies when a session finishes a turn (see `notifications`). */
export function useSessions(projectId: string, selectedId: string | null, notifications: NotificationMode) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const modeRef = useRef(notifications);
  modeRef.current = notifications;
  // Last status seen per session, kept outside state so notifying stays out of the state updater.
  const known = useRef(new Map<string, Session>());

  useEffect(() => {
    listSessions(projectId)
      .then((list) => {
        known.current = new Map(list.map((s) => [s.id, s]));
        setSessions(list);
      })
      .catch(() => setSessions([]));
  }, [projectId]);

  useTauriEvent<Session>(SESSION_CHANGED, (session) => {
    if (session.projectId !== projectId) return;
    const before = known.current.get(session.id);
    if (finishedTurn(before, session)) {
      notifySessionFinished(session, modeRef.current, selectedRef.current);
    } else if (newApproval(before, session)) {
      notifyApproval(session, modeRef.current, selectedRef.current);
    }
    known.current.set(session.id, session);
    setSessions((prev) => {
      const rest = prev.filter((s) => s.id !== session.id);
      return [session, ...rest].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    });
  });

  useTauriEvent<string>(SESSION_DELETED, (id) => setSessions((prev) => prev.filter((s) => s.id !== id)));

  return sessions;
}
