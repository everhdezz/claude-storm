import { useState } from "react";
import { ActionIcon, Button, Group, Text } from "@mantine/core";
import { IconPlayerPlay, IconRefresh, IconX } from "@tabler/icons-react";
import { isActive, processKey, stopProcess } from "../../api/processes";
import { notifyError } from "../../hooks/notify";
import type { Session } from "../../types";
import { useRunCommand } from "../processes/useRunCommand";
import { useProjectContext } from "../project/ProjectContext";
import classes from "./sessions.module.css";
import { t } from "../../i18n";

/**
 * After Claude finishes a change, offers to start the dev server of each touched repo that has
 * none running where the session works (its worktree when isolated, the main checkout otherwise).
 */
export function ServeBanner({ session }: { session: Session }) {
  const { project, processes, setRunTarget } = useProjectContext();
  const run = useRunCommand();
  // Dismissing hides it until Claude's next turn changes lastActivityAt.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const turnKey = `${session.id}:${session.lastActivityAt}`;
  const isolated = session.mode === "isolated";
  const target = isolated ? session.id : null;

  if (session.status !== "done" || dismissed === turnKey) return null;

  const offers = project.repos
    .filter((r) => session.repoIds.includes(r.id))
    .flatMap((repo) => {
      const server = repo.commands.find((c) => c.longRunning);
      if (!server) return [];
      const proc = processes[processKey(repo.id, server.id)];
      const runningHere = isActive(proc) && (proc?.sessionId ?? null) === target;
      if (runningHere) return [];
      return [{ repo, server, elsewhere: isActive(proc) ? proc : undefined }];
    });
  if (offers.length === 0) return null;

  async function start(offer: (typeof offers)[number]) {
    if (offer.elsewhere) {
      try {
        await stopProcess(offer.elsewhere.id);
      } catch (err) {
        notifyError(err, t("Could not stop the previous server"));
        return;
      }
    }
    if (isolated) setRunTarget(session.id);
    run(offer.repo, offer.server, target);
  }

  return (
    <div className={classes.serveBanner}>
      <IconPlayerPlay size={15} color="var(--mantine-color-teal-4)" />
      <Text size="xs" style={{ flex: 1, minWidth: 0 }}>
        {isolated ? t("Claude finished changes. Start the server in its worktree so you can try them?") : t("Claude finished changes. Start the server so you can try them?")}
      </Text>
      <Group gap={6} wrap="nowrap">
        {offers.map((offer) => (
          <Button
            key={offer.repo.id}
            size="compact-xs"
            variant="light"
            color="teal"
            leftSection={offer.elsewhere ? <IconRefresh size={12} /> : <IconPlayerPlay size={12} />}
            onClick={() => start(offer)}
            title={offer.elsewhere ? t("Already running in another folder; it is stopped and started here") : offer.server.command}
          >
            {offers.length > 1 ? offer.repo.name : t("Start {command}", { command: offer.server.label })}
          </Button>
        ))}
        <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setDismissed(turnKey)} aria-label={t("Hide")}>
          <IconX size={13} />
        </ActionIcon>
      </Group>
    </div>
  );
}
