import { useState } from "react";
import { ActionIcon, Group, Loader, Menu, Radio, Stack, Text, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconArchive, IconArchiveOff, IconCopy, IconDots, IconPencil, IconPlayerStop, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { archiveSession, deleteSession, duplicateSession, isBusy, stopSession, updateSession } from "../../api/sessions";
import { notifyError } from "../../hooks/notify";
import type { Session, WorktreeCleanup } from "../../types";
import { relativeTime } from "../../utils/time";
import { useProjectContext } from "../project/ProjectContext";
import { statusColor, statusText } from "./SessionStatusBadge";
import classes from "./sessions.module.css";
import { t, tn } from "../../i18n";

/** Card of one session in the Chats tool window. */
export function SessionCard({ session, selected }: { session: Session; selected: boolean }) {
  const { project } = useProjectContext();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  async function rename(title: string) {
    setEditing(false);
    if (title.trim() && title.trim() !== session.title) await updateSession(session.id, { title }).catch((e) => notifyError(e));
  }

  async function duplicate() {
    try {
      const copy = await duplicateSession(session.id);
      navigate(`/project/${project.id}/session/${copy.id}`);
    } catch (err) {
      notifyError(err);
    }
  }

  function leaveIfSelected() {
    if (selected) navigate(`/project/${project.id}`);
  }

  function archive() {
    if (session.archived) {
      archiveSession(session.id, false).catch((e) => notifyError(e));
      return;
    }
    askCleanup(session, t("Archive session"), t("Archive"), false, (cleanup) => {
      archiveSession(session.id, true, cleanup).then(leaveIfSelected).catch((e) => notifyError(e));
    });
  }

  function remove() {
    askCleanup(session, t("Delete session"), t("Delete"), true, (cleanup) => {
      deleteSession(session.id, cleanup).then(leaveIfSelected).catch((e) => notifyError(e));
    });
  }

  return (
    <div
      className={classes.card}
      data-selected={selected || undefined}
      onClick={() => navigate(`/project/${project.id}/session/${session.id}`)}
    >
      <Group justify="space-between" wrap="nowrap" gap={6} align="flex-start">
        {editing ? (
          <TextInput
            size="xs"
            defaultValue={session.title}
            autoFocus
            style={{ flex: 1 }}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => rename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename(e.currentTarget.value);
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <Text size="sm" fw={600} lineClamp={2} onDoubleClick={() => setEditing(true)} style={{ flex: 1 }}>
            {session.title}
          </Text>
        )}
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={(e) => e.stopPropagation()} aria-label={t("Session actions")}>
              <IconDots size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
            {isBusy(session) && (
              <Menu.Item leftSection={<IconPlayerStop size={13} />} color="red" onClick={() => stopSession(session.id).catch((e) => notifyError(e))}>
                {t("Stop")}
              </Menu.Item>
            )}
            <Menu.Item leftSection={<IconPencil size={13} />} onClick={() => setEditing(true)}>
              {t("Rename")}
            </Menu.Item>
            <Menu.Item leftSection={<IconCopy size={13} />} onClick={duplicate} disabled={session.mode === "isolated"}>
              {t("Duplicate")}
            </Menu.Item>
            <Menu.Item leftSection={session.archived ? <IconArchiveOff size={13} /> : <IconArchive size={13} />} onClick={archive}>
              {session.archived ? t("Unarchive") : t("Archive")}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<IconTrash size={13} />} onClick={remove}>
              {t("Delete")}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      {session.summary && (
        <Text size="xs" c="dimmed" mt={4} truncate>
          {plainSummary(session.summary)}
        </Text>
      )}
      <Group justify="space-between" mt={4} wrap="nowrap">
        <Group gap={4} wrap="nowrap" miw={0} style={{ overflow: "hidden", flex: 1 }}>
          {session.status === "working" && <Loader size={10} />}
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            {relativeTime(session.lastActivityAt)}
            {session.filesTouched.length > 0 && ` · ${tn(session.filesTouched.length, "{count} file", "{count} files")}`}
          </Text>
          {session.approvals.length > 0 ? (
            <Text size="xs" c="yellow.4" truncate>
              · {t("needs your answer")}
            </Text>
          ) : statusText(session.status) && (
            <Text size="xs" c={`${statusColor(session.status)}.4`} truncate>
              · {statusText(session.status)}
            </Text>
          )}
        </Group>
      </Group>
    </div>
  );
}

/** One-line summary without Markdown markers. */
function plainSummary(text: string): string {
  return text.replace(/[*_`#>]+/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
}

/** Confirms archive/delete; isolated sessions also choose what happens to the worktree and branch. */
function askCleanup(session: Session, title: string, confirmLabel: string, destructive: boolean, onConfirm: (c: WorktreeCleanup) => void) {
  let choice: WorktreeCleanup = destructive ? "removeWorktree" : "keep";
  modals.openConfirmModal({
    title,
    centered: true,
    children:
      session.mode === "isolated" ? (
        <Stack gap="xs">
          <Text size="sm">{t("What should happen to the worktree and the branch {branch}?", { branch: session.branch ?? "" })}</Text>
          <Radio.Group defaultValue={choice} onChange={(v) => (choice = v as WorktreeCleanup)}>
            <Stack gap={6}>
              <Radio value="keep" label={t("Keep worktree and branch")} />
              <Radio value="removeWorktree" label={t("Delete the worktree, keep the branch")} />
              <Radio value="removeWorktreeAndBranch" label={t("Delete worktree and branch (unmerged changes are lost)")} />
            </Stack>
          </Radio.Group>
        </Stack>
      ) : (
        <Text size="sm">{destructive ? t("The session and its history are deleted. Repo files are not touched.") : t("It is hidden from the list; you can see it with the archived filter.")}</Text>
      ),
    labels: { confirm: confirmLabel, cancel: t("Cancel") },
    confirmProps: destructive ? { color: "red" } : undefined,
    onConfirm: () => onConfirm(choice),
  });
}
