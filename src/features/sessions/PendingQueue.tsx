import { ActionIcon, Button, Group, Text, Tooltip } from "@mantine/core";
import { IconClockHour4, IconPaperclip, IconPencil, IconPlayerTrackNext, IconX } from "@tabler/icons-react";
import { isBusy, sessionRemovePending, sessionSendNow } from "../../api/sessions";
import { notifyError } from "../../hooks/notify";
import type { Session } from "../../types";
import classes from "./sessions.module.css";
import { t } from "../../i18n";

/**
 * Messages queued while Claude works (like Claude Code): they go out together when the turn ends.
 * "Enviar ya" interrupts the turn and sends them now; each one can be edited or discarded.
 */
export function PendingQueue({ session, onEdit }: { session: Session; onEdit: (text: string) => void }) {
  if (session.pending.length === 0) return null;
  const working = isBusy(session);

  async function edit(id: string) {
    try {
      const removed = await sessionRemovePending(session.id, id);
      if (removed) onEdit(removed.text);
    } catch (err) {
      notifyError(err, t("Could not edit"));
    }
  }

  return (
    <div className={classes.queue}>
      <Group justify="space-between" wrap="nowrap" mb={4}>
        <Group gap={6} wrap="nowrap">
          <IconClockHour4 size={13} color="var(--mantine-color-indigo-3)" />
          <Text size="xs" c="dimmed">
            {working
              ? t("{count} queued · sent when Claude finishes", { count: session.pending.length })
              : t("{count} queued · Claude is not working; send them whenever you want", { count: session.pending.length })}
          </Text>
        </Group>
        <Tooltip label={working ? t("Interrupt Claude and send the queue now") : t("Send the queue now")}>
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconPlayerTrackNext size={12} />}
            onClick={() => sessionSendNow(session.id).catch((err) => notifyError(err, t("Could not send")))}
          >
            {working ? t("Send now") : t("Send")}
          </Button>
        </Tooltip>
      </Group>
      {session.pending.map((m) => (
        <div key={m.id} className={classes.queueItem}>
          <Text size="xs" style={{ flex: 1, minWidth: 0 }} lineClamp={2}>
            {m.text || t("(attachments only)")}
          </Text>
          {m.attachments.length > 0 && (
            <Tooltip label={m.attachments.join(", ")}>
              <Group gap={2} wrap="nowrap">
                <IconPaperclip size={12} />
                <Text size="xs" c="dimmed">
                  {m.attachments.length}
                </Text>
              </Group>
            </Tooltip>
          )}
          <Tooltip label={t("Edit (moves it back to the text box)")}>
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => edit(m.id)} aria-label={t("Edit queued message")}>
              <IconPencil size={13} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Remove from the queue")}>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={() => sessionRemovePending(session.id, m.id).catch((err) => notifyError(err))}
              aria-label={t("Remove from the queue")}
            >
              <IconX size={13} />
            </ActionIcon>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
