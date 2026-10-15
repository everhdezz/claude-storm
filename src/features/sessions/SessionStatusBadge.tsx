import { Badge, Loader } from "@mantine/core";
import type { Session, SessionStatus } from "../../types";

const META: Record<SessionStatus, { label: string; color: string }> = {
  idle: { label: "inactiva", color: "gray" },
  queued: { label: "en cola", color: "violet" },
  working: { label: "trabajando", color: "blue" },
  waiting: { label: "esperando tu respuesta", color: "yellow" },
  done: { label: "terminó con cambios", color: "teal" },
  error: { label: "error", color: "red" },
  interrupted: { label: "interrumpida", color: "orange" },
};

/** States worth surfacing; resting states (idle, waiting for the user) show nothing. */
const QUIET: SessionStatus[] = ["idle", "waiting"];

/** Short text for a status, or null when nothing needs to be shown. */
export function statusText(status: SessionStatus): string | null {
  return QUIET.includes(status) ? null : META[status].label;
}

/** Color of a status text. */
export function statusColor(status: SessionStatus): string {
  return META[status].color;
}

/** Colored status pill; shows a spinner while working and nothing in resting states. */
export function SessionStatusBadge({ session }: { session: Session }) {
  const meta = META[session.status];
  if (QUIET.includes(session.status)) return null;
  return (
    <Badge
      size="xs"
      variant="light"
      color={meta.color}
      leftSection={session.status === "working" ? <Loader size={8} color={meta.color} /> : undefined}
    >
      {meta.label}
    </Badge>
  );
}
