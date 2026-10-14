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

/** Colored status pill; shows a spinner while working. */
export function SessionStatusBadge({ session }: { session: Session }) {
  const meta = META[session.status];
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
