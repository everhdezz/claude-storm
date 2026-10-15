import { Badge, Loader } from "@mantine/core";
import type { Session, SessionStatus } from "../../types";
import { t } from "../../i18n";

const META: Record<SessionStatus, { label: string; color: string }> = {
  idle: { label: t("idle"), color: "gray" },
  queued: { label: t("queued"), color: "violet" },
  working: { label: t("working"), color: "blue" },
  waiting: { label: t("waiting for you"), color: "yellow" },
  done: { label: t("finished with changes"), color: "teal" },
  error: { label: t("error"), color: "red" },
  interrupted: { label: t("interrupted"), color: "orange" },
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
