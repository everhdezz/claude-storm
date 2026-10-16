import { useState } from "react";
import { ActionIcon, Button, CloseButton, ScrollArea, Switch, Text, TextInput, Tooltip } from "@mantine/core";
import { IconPlus, IconSearch } from "@tabler/icons-react";
import { useNavigate, useParams } from "react-router";
import { Island } from "../../components/ide/Island";
import { useProjectContext } from "../project/ProjectContext";
import { SessionCard } from "../sessions/SessionCard";
import { t } from "../../i18n";

/** Left tool window with the project's parallel Claude sessions. */
export function ChatsTool({ style, onMinimize }: { style?: React.CSSProperties; onMinimize?: () => void }) {
  const { project, sessions, ui, showChat, mainView } = useProjectContext();
  const { sessionId } = useParams();
  const navigate = useNavigate();
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

  /** Opens the empty "Chatea con la IA" home; the first prompt there creates the session. */
  function newSession() {
    navigate(`/project/${project.id}`);
    // Already on the home (no route change) the wiki would stay in front, so switch explicitly.
    showChat();
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
          visible.map((s) => <SessionCard key={s.id} session={s} selected={mainView === "chat" && s.id === sessionId} />)
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
