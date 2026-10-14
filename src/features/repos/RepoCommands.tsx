import { Button, Group, Text, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconExternalLink, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkPort, isActive, processKey, startCommand, stopProcess } from "../../api/processes";
import { notifyError } from "../../hooks/notify";
import type { ProcessInfo, Repo, RepoCommand } from "../../types";
import { useProjectContext } from "../project/ProjectContext";

/** Buttons for each configured command of a repo, reflecting live process state. */
export function RepoCommands({ repo }: { repo: Repo }) {
  const { project, processes, showLogs } = useProjectContext();

  if (repo.commands.length === 0) {
    return <Text size="xs" c="dimmed">Sin comandos. Edítalo para agregar.</Text>;
  }

  async function launch(command: RepoCommand) {
    try {
      await startCommand(project.id, repo.id, command.id);
      showLogs(repo.id, processKey(repo.id, command.id));
    } catch (err) {
      notifyError(err, `No se pudo ejecutar ${command.label}`);
    }
  }

  async function run(command: RepoCommand) {
    const port = repo.port;
    if (command.longRunning && port && (await checkPort(port))) {
      modals.openConfirmModal({
        title: `El puerto ${port} ya está ocupado`,
        centered: true,
        children: (
          <Text size="sm">
            Otro proceso ya escucha en el puerto {port}. Si lo levantas igual probablemente falle o use otro puerto.
          </Text>
        ),
        labels: { confirm: "Levantar de todos modos", cancel: "Cancelar" },
        onConfirm: () => launch(command),
      });
      return;
    }
    await launch(command);
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
          onRun={() => run(c)}
          onShowLogs={() => showLogs(repo.id, processKey(repo.id, c.id))}
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
  onShowLogs: () => void;
}

/** One command button: run, or stop when it is already active. */
function CommandButton({ command, process, onRun, onShowLogs }: CommandButtonProps) {
  const active = isActive(process);
  const color = !process ? "gray" : active ? (process.ready || !process.port ? "teal" : "yellow") : process.status === "failed" ? "red" : "gray";

  if (active && process) {
    return (
      <Button.Group>
        <Button size="compact-sm" variant="light" color={color} onClick={onShowLogs}>
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
