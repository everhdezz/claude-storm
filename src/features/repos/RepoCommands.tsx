import { Button, Group, Text, Tooltip } from "@mantine/core";
import { IconExternalLink, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isActive, processKey, stopProcess } from "../../api/processes";
import { notifyError } from "../../hooks/notify";
import type { ProcessInfo, Repo, RepoCommand } from "../../types";
import { useRunCommand } from "../processes/useRunCommand";
import { useProjectContext } from "../project/ProjectContext";

/** Buttons for each configured command of a repo, reflecting live process state. */
export function RepoCommands({ repo }: { repo: Repo }) {
  const { processes, revealService } = useProjectContext();
  const run = useRunCommand();

  if (repo.commands.length === 0) {
    return <Text size="xs" c="dimmed">Sin comandos. Edítalo para agregar.</Text>;
  }

  const serverProc = repo.commands
    .map((c) => processes[processKey(repo.id, c.id)])
    .find((p): p is ProcessInfo => !!p && p.longRunning && p.status === "running" && p.ready && !!p.port);

  return (
    <Group gap="xs">
      {repo.commands.map((c) => (
        <CommandButton
          key={c.id}
          command={c}
          process={processes[processKey(repo.id, c.id)]}
          onRun={() => run(repo, c)}
          onReveal={() => revealService(processKey(repo.id, c.id))}
        />
      ))}
      {serverProc && (
        <Button
          size="compact-sm"
          variant="light"
          color="teal"
          leftSection={<IconExternalLink size={14} />}
          onClick={() => openUrl(`http://localhost:${serverProc.port}`)}
        >
          Abrir :{serverProc.port}
        </Button>
      )}
    </Group>
  );
}

interface CommandButtonProps {
  command: RepoCommand;
  process: ProcessInfo | undefined;
  onRun: () => void;
  onReveal: () => void;
}

/** One command button: run, or reveal/stop when it is already active. */
function CommandButton({ command, process, onRun, onReveal }: CommandButtonProps) {
  const active = isActive(process);
  const color = !process ? "gray" : active ? (process.ready || !process.port ? "teal" : "yellow") : process.status === "failed" ? "red" : "gray";

  if (active && process) {
    return (
      <Button.Group>
        <Button size="compact-sm" variant="light" color={color} onClick={onReveal}>
          {command.label}
        </Button>
        <Tooltip label="Detener">
          <Button
            size="compact-sm"
            variant="light"
            color="red"
            loading={process.status === "stopping"}
            onClick={() => stopProcess(process.id).catch((e) => notifyError(e))}
            aria-label={`Detener ${command.label}`}
          >
            <IconPlayerStop size={14} />
          </Button>
        </Tooltip>
      </Button.Group>
    );
  }
  return (
    <Tooltip label={command.command} openDelay={500} ff="monospace">
      <Button
        size="compact-sm"
        variant={process?.status === "failed" ? "light" : "default"}
        color={color}
        leftSection={command.longRunning ? <IconPlayerPlay size={12} /> : undefined}
        onClick={onRun}
      >
        {command.label}
      </Button>
    </Tooltip>
  );
}
