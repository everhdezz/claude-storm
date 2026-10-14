import { useEffect, useState } from "react";
import { Center, Loader, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import { sessionDiff } from "../../api/sessions";
import type { RepoDiff, Session } from "../../types";
import { DiffBlock } from "./DiffBlock";

/** Shows the diff of each repo touched by a session. */
export function DiffModal({ session, opened, onClose }: { session: Session; opened: boolean; onClose: () => void }) {
  const [diffs, setDiffs] = useState<RepoDiff[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setDiffs(null);
    setError(null);
    sessionDiff(session.id)
      .then(setDiffs)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [opened, session.id]);

  return (
    <Modal opened={opened} onClose={onClose} title={`Diff · ${session.title}`} size="80%" centered>
      {error && <Text c="red">{error}</Text>}
      {!diffs && !error && (
        <Center py="xl">
          <Loader size="sm" />
        </Center>
      )}
      {diffs && (
        <ScrollArea.Autosize mah="70vh">
          <Stack>
            {diffs.map((d) => (
              <div key={d.repoId}>
                <Text fw={600} size="sm" mb={4}>
                  {d.repoName}{" "}
                  <Text span size="xs" c="dimmed">
                    contra {d.base}
                  </Text>
                </Text>
                {d.diff.trim() ? <DiffBlock diff={d.diff} /> : <Text size="sm" c="dimmed">Sin cambios.</Text>}
              </div>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </Modal>
  );
}
