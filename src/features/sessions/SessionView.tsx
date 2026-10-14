import { useEffect, useRef, useState } from "react";
import { ActionIcon, Badge, Center, Group, Loader, Menu, ScrollArea, Text, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconDots, IconFileDiff, IconGitBranch, IconGitCommit, IconGitMerge, IconTrash } from "@tabler/icons-react";
import { useNavigate, useParams } from "react-router";
import {
  isBusy,
  modelLabel,
  sendSessionPrompt,
  sessionCommit,
  sessionMerge,
  sessionRemoveWorktrees,
  stopSession,
} from "../../api/sessions";
import { notifyError, notifySuccess } from "../../hooks/notify";
import type { Session } from "../../types";
import { useProjectContext } from "../project/ProjectContext";
import { ChatItems } from "./ChatItems";
import { Composer } from "./Composer";
import { DiffModal } from "./DiffModal";
import { SessionStatusBadge } from "./SessionStatusBadge";
import { useSessionChat } from "./useSessionChat";
import classes from "./sessions.module.css";
import projectClasses from "../project/project.module.css";

/** Center island for a selected session: conversation, branch actions and composer. */
export function SessionView() {
  const { sessionId = "" } = useParams();
  const { project, sessions, settings, refreshGit } = useProjectContext();
  const navigate = useNavigate();
  const session = sessions.find((s) => s.id === sessionId);
  const { items, streaming, loading } = useSessionChat(sessionId);
  const [diffOpen, setDiffOpen] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const previousStatus = useRef(session?.status);

  useEffect(() => {
    const el = viewport.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, streaming]);

  useEffect(() => {
    if (previousStatus.current === "working" && session && session.status !== "working") refreshGit();
    previousStatus.current = session?.status;
  }, [session?.status, refreshGit, session]);

  if (!session) {
    return (
      <Center style={{ flex: 1 }}>
        {sessions.length === 0 ? <Loader size="sm" /> : <Text c="dimmed">La sesión no existe.</Text>}
      </Center>
    );
  }

  const repoNames = session.repoIds.map((id) => project.repos.find((r) => r.id === id)?.name).filter(Boolean);
  const isolated = session.mode === "isolated";

  async function send(prompt: string, model: string | null) {
    const conflicts = conflictingSessions(session!, sessions);
    if (conflicts.length > 0) {
      const ok = await confirm(
        "Otra sesión directa está trabajando en los mismos repos",
        `${conflicts.map((s) => `«${s.title}»`).join(", ")} está editando esos repos ahora mismo. Pueden pisarse cambios.`,
        "Enviar de todos modos",
      );
      if (!ok) return;
    }
    try {
      await sendSessionPrompt(session!.id, prompt, model);
    } catch (err) {
      notifyError(err, "No se pudo enviar");
    }
  }

  async function commit() {
    try {
      const done = await sessionCommit(session!.id, session!.title);
      notifySuccess(done.length ? `Commit en ${done.join(", ")}` : "No había cambios para commitear");
    } catch (err) {
      notifyError(err, "No se pudo hacer commit");
    }
  }

  function merge() {
    modals.openConfirmModal({
      title: "Merge a la rama base",
      centered: true,
      children: (
        <Text size="sm">
          Se hará <code>git merge --no-ff {session!.branch}</code> en cada repo, sobre su rama base (
          {Object.values(session!.baseBranches).join(", ")}). El repo principal debe estar en esa rama.
        </Text>
      ),
      labels: { confirm: "Hacer merge", cancel: "Cancelar" },
      onConfirm: async () => {
        try {
          const merged = await sessionMerge(session!.id);
          notifySuccess(`Merge: ${merged.join(" · ")}`);
          refreshGit();
        } catch (err) {
          notifyError(err, "No se pudo hacer merge");
        }
      },
    });
  }

  function removeWorktrees(deleteBranch: boolean) {
    modals.openConfirmModal({
      title: deleteBranch ? "Borrar worktree y rama" : "Borrar worktree",
      centered: true,
      children: (
        <Text size="sm">
          {deleteBranch
            ? `Se borran las carpetas de trabajo y la rama ${session!.branch}. Los cambios sin merge se pierden.`
            : `Se borran las carpetas de trabajo; la rama ${session!.branch} se conserva.`}{" "}
          La sesión quedará archivada.
        </Text>
      ),
      labels: { confirm: "Borrar", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: () =>
        sessionRemoveWorktrees(session!.id, deleteBranch)
          .then(() => navigate(`/project/${project.id}`))
          .catch((err) => notifyError(err)),
    });
  }

  return (
    <>
      <div className={projectClasses.pageHeader}>
        <div style={{ minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Text fw={600} truncate>
              {session.title}
            </Text>
            <SessionStatusBadge session={session} />
          </Group>
          <Group gap={6} mt={2} wrap="nowrap">
            <Badge size="xs" variant="default">
              {modelLabel(session.model, settings.catalog)}
            </Badge>
            {repoNames.map((n) => (
              <Badge key={n} size="xs" variant="light" color="gray">
                {n}
              </Badge>
            ))}
            {isolated && (
              <Group gap={4} wrap="nowrap">
                <IconGitBranch size={12} />
                <Text size="xs" ff="monospace" c="dimmed" truncate>
                  {session.branch}
                </Text>
              </Group>
            )}
          </Group>
        </div>
        <Group gap={4} wrap="nowrap">
          <Tooltip label={isolated ? "Diff contra la rama base" : "Cambios sin commitear"}>
            <ActionIcon variant="subtle" color="gray" onClick={() => setDiffOpen(true)} aria-label="Ver diff">
              <IconFileDiff size={17} />
            </ActionIcon>
          </Tooltip>
          {isolated && (
            <>
              <Tooltip label="Commit en la rama de la sesión">
                <ActionIcon variant="subtle" color="gray" onClick={commit} disabled={isBusy(session)} aria-label="Commit">
                  <IconGitCommit size={17} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Merge a la rama base">
                <ActionIcon variant="subtle" color="gray" onClick={merge} disabled={isBusy(session)} aria-label="Merge">
                  <IconGitMerge size={17} />
                </ActionIcon>
              </Tooltip>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray" aria-label="Más">
                    <IconDots size={17} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconTrash size={14} />} onClick={() => removeWorktrees(false)}>
                    Borrar worktree (conservar rama)
                  </Menu.Item>
                  <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => removeWorktrees(true)}>
                    Borrar worktree y rama
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </>
          )}
        </Group>
      </div>
      <ScrollArea style={{ flex: 1 }} viewportRef={viewport} type="auto">
        {loading ? (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        ) : (
          <ChatItems items={items} streaming={streaming} />
        )}
        {session.status === "working" && !streaming && (
          <Group justify="center" pb="md">
            <Loader size="xs" type="dots" />
          </Group>
        )}
        {session.status === "interrupted" && (
          <Text size="xs" c="yellow.4" ta="center" pb="md">
            La sesión quedó interrumpida. Escribe un mensaje (por ejemplo «continúa») para reanudarla.
          </Text>
        )}
      </ScrollArea>
      <div className={classes.composerWrap}>
        <Composer
          key={session.id}
          placeholder={session.status === "queued" ? "En cola…" : "Continúa la conversación…"}
          defaultModel={session.model}
          context={`Login por defecto · ${modelLabel(session.model, settings.catalog)} · ${session.permissionMode}`}
          busy={isBusy(session)}
          autoFocus
          onSend={send}
          onStop={() => stopSession(session.id).catch((err) => notifyError(err))}
        />
      </div>
      <DiffModal session={session} opened={diffOpen} onClose={() => setDiffOpen(false)} />
    </>
  );
}

/** Other direct sessions working right now on any of the same repos. */
function conflictingSessions(session: Session, all: Session[]): Session[] {
  if (session.mode !== "direct") return [];
  return all.filter(
    (s) => s.id !== session.id && s.mode === "direct" && s.status === "working" && s.repoIds.some((r) => session.repoIds.includes(r)),
  );
}

/** Promise-based confirm modal. */
function confirm(title: string, body: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    modals.openConfirmModal({
      title,
      centered: true,
      children: <Text size="sm">{body}</Text>,
      labels: { confirm: confirmLabel, cancel: "Cancelar" },
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
      onClose: () => resolve(false),
    });
  });
}
