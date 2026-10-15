import { useState } from "react";
import { ActionIcon, Button, ScrollArea, Switch, Text, Tooltip } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useParams } from "react-router";
import { Island } from "../../components/ide/Island";
import { useProjectContext } from "../project/ProjectContext";
import { NewSessionModal } from "../sessions/NewSessionModal";
import { SessionCard } from "../sessions/SessionCard";

/** Left tool window with the project's parallel Claude sessions. */
export function ChatsTool({ style }: { style?: React.CSSProperties }) {
  const { sessions, ui } = useProjectContext();
  const { sessionId } = useParams();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(ui.initial.showArchived ?? false);
  const visible = sessions.filter((s) => s.archived === showArchived);
  const working = sessions.filter((s) => s.status === "working").length;
  const queued = sessions.filter((s) => s.status === "queued").length;

  return (
    <Island
      title={
        <>
          Chats
          {(working > 0 || queued > 0) && (
            <Text size="xs" c="dimmed" fw={400}>
              {working} trabajando{queued ? ` · ${queued} en cola` : ""}
            </Text>
          )}
        </>
      }
      style={style}
      actions={
        <Tooltip label="Nueva sesión">
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => setCreating(true)} aria-label="Nueva sesión">
            <IconPlus size={15} />
          </ActionIcon>
        </Tooltip>
      }
    >
      <div style={{ padding: "0 8px 8px" }}>
        <Button fullWidth size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setCreating(true)}>
          Nueva sesión
        </Button>
      </div>
      <ScrollArea style={{ flex: 1 }} type="auto">
        {visible.length === 0 ? (
          <Text size="xs" c="dimmed" ta="center" p="md">
            {showArchived ? "No hay sesiones archivadas." : "Sin sesiones. Escribe en «Chatea con la IA» o crea una nueva."}
          </Text>
        ) : (
          visible.map((s) => <SessionCard key={s.id} session={s} selected={s.id === sessionId} />)
        )}
      </ScrollArea>
      <div style={{ padding: "6px 12px 10px" }}>
        <Switch size="xs" label="Ver archivadas" checked={showArchived} onChange={(e) => {
            const value = e.currentTarget.checked;
            setShowArchived(value);
            ui.save({ showArchived: value });
          }} />
      </div>
      <NewSessionModal opened={creating} onClose={() => setCreating(false)} />
    </Island>
  );
}
