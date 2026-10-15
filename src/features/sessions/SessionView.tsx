import { useEffect, useRef, useState } from "react";
import { ActionIcon, Badge, Center, Group, Loader, Menu, ScrollArea, Text, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconDots, IconFileDiff, IconGitBranch, IconGitCommit, IconGitMerge, IconTrash } from "@tabler/icons-react";
import { useNavigate, useParams } from "react-router";
import {
  isBusy,
  updateSession,
  sessionModelLabel,
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
import { WorktreeActions } from "./WorktreeActions";
import { CapabilitySummary } from "./CapabilitySummary";
import { ServeBanner } from "./ServeBanner";
import { PendingQueue } from "./PendingQueue";
import { ApprovalPrompts } from "./ApprovalPrompts";
import { StickyPrompt } from "./StickyPrompt";
import classes from "./sessions.module.css";
import projectClasses from "../project/project.module.css";
import { t } from "../../i18n";

/** Center island for a selected session: conversation, branch actions and composer. */
export function SessionView() {
  const { sessionId = "" } = useParams();
  const { project, sessions, settings, account, refreshGit } = useProjectContext();
  const navigate = useNavigate();
  const session = sessions.find((s) => s.id === sessionId);
  const { items, streaming, loading } = useSessionChat(sessionId);
  const [diffOpen, setDiffOpen] = useState(false);
  const [injected, setInjected] = useState<{ text: string; seq: number } | null>(null);
  useEffect(() => setInjected(null), [sessionId]);
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
        {sessions.length === 0 ? <Loader size="sm" /> : <Text c="dimmed">{t("This session does not exist.")}</Text>}
      </Center>
    );
  }

  const repoNames = session.repoIds.map((id) => project.repos.find((r) => r.id === id)?.name).filter(Boolean);
  const isolated = session.mode === "isolated";

  async function send(prompt: string, model: string | null, attachments: string[]) {
    const conflicts = isBusy(session!) ? [] : conflictingSessions(session!, sessions);
    if (conflicts.length > 0) {
      const ok = await confirm(
        t("Another direct session is working on the same repos"),
        t("{sessions} is editing those repos right now. Changes may overwrite each other.", { sessions: conflicts.map((s) => `«${s.title}»`).join(", ") }),
        t("Send anyway"),
      );
      if (!ok) return;
    }
    try {
      await sendSessionPrompt(session!.id, prompt, model, attachments);
    } catch (err) {
      notifyError(err, t("Could not send"));
    }
  }

  async function commit() {
    try {
      const done = await sessionCommit(session!.id, session!.title);
      notifySuccess(done.length ? t("Committed in {repos}", { repos: done.join(", ") }) : t("There were no changes to commit"));
    } catch (err) {
      notifyError(err, t("Could not commit"));
    }
  }

  function merge() {
    modals.openConfirmModal({
      title: t("Merge into the base branch"),
      centered: true,
      children: (
        <Text size="sm">
          {t("Runs {command} in each repo, on its base branch ({bases}). The main checkout must be on that branch.", {
            command: `git merge --no-ff ${session!.branch}`,
            bases: Object.values(session!.baseBranches).join(", "),
          })}
        </Text>
      ),
      labels: { confirm: t("Merge"), cancel: t("Cancel") },
      onConfirm: async () => {
        try {
          const merged = await sessionMerge(session!.id);
          notifySuccess(t("Merged: {repos}", { repos: merged.join(" · ") }));
          refreshGit();
        } catch (err) {
          notifyError(err, t("Could not merge"));
        }
      },
    });
  }

  function removeWorktrees(deleteBranch: boolean) {
    modals.openConfirmModal({
      title: deleteBranch ? t("Delete worktree and branch") : t("Delete worktree"),
      centered: true,
      children: (
        <Text size="sm">
          {deleteBranch
            ? t("The working folders and the branch {branch} are deleted. Unmerged changes are lost.", { branch: session!.branch ?? "" })
            : t("The working folders are deleted; the branch {branch} is kept.", { branch: session!.branch ?? "" })}{" "}
          {t("The session will be archived.")}
        </Text>
      ),
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
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
            <Tooltip label={t("Model")}>
              <Badge size="xs" variant="default">
                {sessionModelLabel(session, account, settings)}
              </Badge>
            </Tooltip>
            {repoNames.map((n) => (
              <Badge key={n} size="xs" variant="light" color="gray">
                {n}
              </Badge>
            ))}
            <CapabilitySummary items={items} />
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
          <Tooltip label={isolated ? t("Diff against the base branch") : t("Uncommitted changes")}>
            <ActionIcon variant="subtle" color="gray" onClick={() => setDiffOpen(true)} aria-label={t("View diff")}>
              <IconFileDiff size={17} />
            </ActionIcon>
          </Tooltip>
          {isolated && (
            <>
              <WorktreeActions session={session} />
              <Tooltip label={t("Commit on the session branch")}>
                <ActionIcon variant="subtle" color="gray" onClick={commit} disabled={isBusy(session)} aria-label="Commit">
                  <IconGitCommit size={17} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("Merge into the base branch")}>
                <ActionIcon variant="subtle" color="gray" onClick={merge} disabled={isBusy(session)} aria-label="Merge">
                  <IconGitMerge size={17} />
                </ActionIcon>
              </Tooltip>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray" aria-label={t("More")}>
                    <IconDots size={17} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconTrash size={14} />} onClick={() => removeWorktrees(false)}>
                    {t("Delete worktree (keep branch)")}
                  </Menu.Item>
                  <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => removeWorktrees(true)}>
                    {t("Delete worktree and branch")}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </>
          )}
        </Group>
      </div>
      <ServeBanner session={session} />
      <div className={classes.threadWrap}>
      <StickyPrompt viewport={viewport} items={items} />
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
            {t("The session was interrupted. Write a message (for example “continue”) to resume it.")}
          </Text>
        )}
      </ScrollArea>
      </div>
      <div className={classes.composerWrap}>
        <ApprovalPrompts session={session} />
        <PendingQueue session={session} onEdit={(text) => setInjected((prev) => ({ text, seq: (prev?.seq ?? 0) + 1 }))} />
        <Composer
          key={session.id}
          injected={injected}
          placeholder={
            isBusy(session) ? t("Write your next message; it is queued and sent when Claude finishes…") : t("Continue the conversation…")
          }
          defaultModel={session.model}
          permissionMode={session.permissionMode}
          onPermissionModeChange={(mode) => updateSession(session.id, { permissionMode: mode }).catch((err) => notifyError(err))}
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
