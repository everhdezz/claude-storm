import { useState } from "react";
import { ActionIcon, Badge, Group, Menu, Radio, Stack, Text, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconArchive, IconArchiveOff, IconCopy, IconDots, IconGitBranch, IconPencil, IconPlayerStop, IconTrash } from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { archiveSession, deleteSession, duplicateSession, isBusy, modelLabel, stopSession, updateSession } from "../../api/sessions";
import { notifyError } from "../../hooks/notify";
import type { Session, WorktreeCleanup } from "../../types";
import { relativeTime } from "../../utils/time";
import { useProjectContext } from "../project/ProjectContext";
import { SessionStatusBadge } from "./SessionStatusBadge";
import classes from "./sessions.module.css";

/** Card of one session in the Chats tool window. */
export function SessionCard({ session, selected }: { session: Session; selected: boolean }) {
  const { project, settings } = useProjectContext();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const repoNames = session.repoIds.map((id) => project.repos.find((r) => r.id === id)?.name).filter(Boolean) as string[];

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
    askCleanup(session, "Archivar sesión", "Archivar", false, (cleanup) => {
      archiveSession(session.id, true, cleanup).then(leaveIfSelected).catch((e) => notifyError(e));
    });
  }

  function remove() {
    askCleanup(session, "Eliminar sesión", "Eliminar", true, (cleanup) => {
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
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={(e) => e.stopPropagation()} aria-label="Acciones de la sesión">
              <IconDots size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
            {isBusy(session) && (
              <Menu.Item leftSection={<IconPlayerStop size={13} />} color="red" onClick={() => stopSession(session.id).catch((e) => notifyError(e))}>
                Detener
              </Menu.Item>
            )}
            <Menu.Item leftSection={<IconPencil size={13} />} onClick={() => setEditing(true)}>
              Renombrar
            </Menu.Item>
            <Menu.Item leftSection={<IconCopy size={13} />} onClick={duplicate} disabled={session.mode === "isolated"}>
              Duplicar
            </Menu.Item>
            <Menu.Item leftSection={session.archived ? <IconArchiveOff size={13} /> : <IconArchive size={13} />} onClick={archive}>
              {session.archived ? "Desarchivar" : "Archivar"}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<IconTrash size={13} />} onClick={remove}>
              Eliminar
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      <Group gap={4} mt={4}>
        <SessionStatusBadge session={session} />
        <Badge size="xs" variant="default">
          {modelLabel(session.model, settings.catalog)}
        </Badge>
        {repoNames.map((n) => (
          <Badge key={n} size="xs" variant="light" color="gray">
            {n}
          </Badge>
        ))}
      </Group>
      {session.summary && (
        <Text size="xs" c="dimmed" mt={4} truncate>
          {session.summary}
        </Text>
      )}
      <Group justify="space-between" mt={4} wrap="nowrap">
        <Text size="xs" c="dimmed">
          {relativeTime(session.lastActivityAt)}
          {session.filesTouched.length > 0 && ` · ${session.filesTouched.length} archivo(s)`}
        </Text>
        {session.branch && (
          <Group gap={3} wrap="nowrap" miw={0}>
            <IconGitBranch size={11} />
            <Text size="xs" c="dimmed" ff="monospace" truncate maw={120}>
              {session.branch.replace("devhub/", "")}
            </Text>
          </Group>
        )}
      </Group>
    </div>
  );
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
          <Text size="sm">¿Qué hago con el worktree y la rama {session.branch}?</Text>
          <Radio.Group defaultValue={choice} onChange={(v) => (choice = v as WorktreeCleanup)}>
            <Stack gap={6}>
              <Radio value="keep" label="Conservar worktree y rama" />
              <Radio value="removeWorktree" label="Borrar el worktree, conservar la rama" />
              <Radio value="removeWorktreeAndBranch" label="Borrar worktree y rama (se pierden cambios sin merge)" />
            </Stack>
          </Radio.Group>
        </Stack>
      ) : (
        <Text size="sm">{destructive ? "Se borra la sesión y su historial. Los archivos de los repos no se tocan." : "Se oculta de la lista; puedes verla con el filtro de archivadas."}</Text>
      ),
    labels: { confirm: confirmLabel, cancel: "Cancelar" },
    confirmProps: destructive ? { color: "red" } : undefined,
    onConfirm: () => onConfirm(choice),
  });
}
