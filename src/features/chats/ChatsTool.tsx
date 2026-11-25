import { useState } from "react";
import { ActionIcon, Button, CloseButton, ScrollArea, Switch, Text, TextInput, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconArchive, IconPlus, IconSearch } from "@tabler/icons-react";
import { archiveIdleSessions, isBusy } from "../../api/sessions";
import { Island } from "../../components/ide/Island";
import { notifyError, notifySuccess } from "../../hooks/notify";
import { useProjectContext } from "../project/ProjectContext";
import { SessionCard } from "../sessions/SessionCard";
import { t, tn } from "../../i18n";

/** Left tool window with the project's parallel Claude sessions. */
export function ChatsTool({ style, onMinimize }: { style?: React.CSSProperties; onMinimize?: () => void }) {
  const { project, sessions, ui, openChat, closeChat, activeTab } = useProjectContext();
  const openSessionId = activeTab?.kind === "chat" ? activeTab.sessionId : null;
  const [showArchived, setShowArchived] = useState(ui.initial.showArchived ?? false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = sessions.filter(
    (s) =>
      s.archived === showArchived &&
      (!needle ||
        [s.title, s.description, s.summary, s.branch].some((field) => field?.toLowerCase().includes(needle))),
  );
  const working = sessions.filter((s) => s.status === "working").length;
  const queued = sessions.filter((s) => s.status === "queued").length;
  const idle = sessions.filter((s) => !s.archived && !isBusy(s) && s.approvals.length === 0);

  /** Opens the empty "Chatea con la IA" home in a tab; the first prompt there creates the session. */
  function newSession() {
    openChat(null);
  }

  /** Archives every chat that is not running; worktrees without changes go away with their branch. */
  function archiveAll() {
    modals.openConfirmModal({
      title: t("Archive all"),
      centered: true,
      children: (
        <Text size="sm">
          {tn(idle.length, "{count} chat that is not running is archived.", "{count} chats that are not running are archived.")}{" "}
          {t("Worktrees without changes are deleted with their branch; those with changes are kept.")}
        </Text>
      ),
      labels: { confirm: t("Archive"), cancel: t("Cancel") },
      onConfirm: () => {
        archiveIdleSessions(project.id)
          .then((count) => {
            for (const s of idle) closeChat(s.id);
            notifySuccess(tn(count, "{count} chat archived", "{count} chats archived"));
          })
          .catch((e) => notifyError(e));
      },
    });
  }

  function closeSearch() {
    setSearching(false);
    setQuery("");
  }

  return (
    <Island
      title={
        <>
          Chats
          {(working > 0 || queued > 0) && (
            <Text size="xs" c="dimmed" fw={400}>
              {t("{count} working", { count: working })}
              {queued ? ` · ${t("{count} queued", { count: queued })}` : ""}
            </Text>
          )}
        </>
      }
      style={style}
      onMinimize={onMinimize}
      actions={
        <>
          <Tooltip label={t("Search chats")}>
            <ActionIcon
              variant={searching ? "light" : "subtle"}
              color="gray"
              size="sm"
              onClick={() => (searching ? closeSearch() : setSearching(true))}
              aria-label={t("Search chats")}
            >
              <IconSearch size={15} />
            </ActionIcon>
          </Tooltip>
          {!showArchived && (
            <Tooltip label={t("Archive all that are not running")}>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={archiveAll} disabled={idle.length === 0} aria-label={t("Archive all")}>
                <IconArchive size={15} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={t("New session")}>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={newSession} aria-label={t("New session")}>
              <IconPlus size={15} />
            </ActionIcon>
          </Tooltip>
        </>
      }
    >
      {searching && (
        <div style={{ padding: "0 8px 8px" }}>
          <TextInput
            autoFocus
            size="xs"
            placeholder={t("Search chats")}
            leftSection={<IconSearch size={14} />}
            rightSection={query ? <CloseButton size="xs" onClick={() => setQuery("")} aria-label={t("Clear")} /> : null}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Escape" && closeSearch()}
          />
        </div>
      )}
      <div style={{ padding: "0 8px 8px" }}>
        <Button fullWidth size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={newSession}>
          {t("New session")}
        </Button>
      </div>
      <ScrollArea style={{ flex: 1 }} type="auto">
        {visible.length === 0 ? (
          <Text size="xs" c="dimmed" ta="center" p="md">
            {needle
              ? t("No chats match “{query}”.", { query: query.trim() })
              : showArchived
                ? t("No archived sessions.") : t("No sessions yet. Write in “Chat with AI” or create a new one.")}
          </Text>
        ) : (
          visible.map((s) => <SessionCard key={s.id} session={s} selected={s.id === openSessionId} />)
        )}
      </ScrollArea>
      <div style={{ padding: "6px 12px 10px" }}>
        <Switch size="xs" label={t("Show archived")} checked={showArchived} onChange={(e) => {
            const value = e.currentTarget.checked;
            setShowArchived(value);
            ui.save({ showArchived: value });
          }} />
      </div>
    </Island>
  );
}
