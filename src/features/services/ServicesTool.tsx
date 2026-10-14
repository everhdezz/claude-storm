import { ActionIcon, Group, ScrollArea, Text, Tooltip } from "@mantine/core";
import {
  IconClearAll,
  IconExternalLink,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
} from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isActive, processKey, stopProcess } from "../../api/processes";
import { FrameworkIcon } from "../../components/FrameworkIcon";
import { notifyError } from "../../hooks/notify";
import type { ProcessInfo, Repo, RepoCommand } from "../../types";
import { LogView } from "../processes/LogView";
import { ProcessStatusDot } from "../processes/ProcessStatusDot";
import { useProcessLogs } from "../processes/useProcessLogs";
import { useRunCommand } from "../processes/useRunCommand";
import { useProjectContext } from "../project/ProjectContext";
import classes from "./services.module.css";

interface Selection {
  repo: Repo;
  command: RepoCommand;
  process: ProcessInfo | undefined;
}

/** WebStorm-like Services tool window: repo/command tree on the left, output on the right. */
export function ServicesTool() {
  const { project, processes, selectedService, selectService } = useProjectContext();
  const run = useRunCommand();

  const entries: Selection[] = project.repos.flatMap((repo) =>
    repo.commands.map((command) => ({ repo, command, process: processes[processKey(repo.id, command.id)] })),
  );
  const current = entries.find((e) => processKey(e.repo.id, e.command.id) === selectedService) ?? entries.find((e) => e.process);

  if (entries.length === 0) {
    return (
      <Text size="sm" c="dimmed" p="md">
        Ningún repo tiene comandos configurados.
      </Text>
    );
  }

  return (
    <div className={classes.split}>
      <ScrollArea className={classes.tree} type="auto">
        {project.repos
          .filter((r) => r.commands.length > 0)
          .map((repo) => {
            const repoProcs = repo.commands.map((c) => processes[processKey(repo.id, c.id)]).filter((p): p is ProcessInfo => !!p);
            return (
              <div key={repo.id}>
                <div className={classes.group}>
                  <FrameworkIcon framework={repo.framework} size={18} />
                  <Text size="xs" fw={600} truncate>
                    {repo.name}
                  </Text>
                  <ProcessStatusDot processes={repoProcs} />
                </div>
                {repo.commands.map((command) => {
                  const key = processKey(repo.id, command.id);
                  const proc = processes[key];
                  return (
                    <div
                      key={command.id}
                      className={classes.item}
                      data-selected={current && processKey(current.repo.id, current.command.id) === key ? true : undefined}
                      onClick={() => selectService(key)}
                      onDoubleClick={() => !isActive(proc) && run(repo, command)}
                    >
                      <ProcessStatusDot processes={proc ? [proc] : []} keepSpace />
                      <Text size="xs" truncate style={{ flex: 1 }}>
                        {command.label}
                      </Text>
                      {proc?.port && proc.status === "running" && (
                        <Text size="xs" c={proc.ready ? "teal" : "yellow"}>
                          :{proc.port}
                        </Text>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
      </ScrollArea>
      {current && <ServiceOutput key={processKey(current.repo.id, current.command.id)} selection={current} onRun={run} />}
    </div>
  );
}

/** Toolbar and log output of the selected service. */
function ServiceOutput({ selection, onRun }: { selection: Selection; onRun: (repo: Repo, command: RepoCommand) => void }) {
  const { repo, command, process } = selection;
  const { lines, clear } = useProcessLogs(process?.id ?? null, process?.startedAt);
  const active = isActive(process);

  function stop() {
    if (process) stopProcess(process.id).catch((e) => notifyError(e));
  }

  async function restart() {
    if (process && active) await stopProcess(process.id).catch((e) => notifyError(e));
    onRun(repo, command);
  }

  return (
    <div className={classes.output}>
      <Group gap={2} px={6} py={4} wrap="nowrap" className={classes.toolbar}>
        <Tooltip label={active ? "Reiniciar" : "Ejecutar"}>
          <ActionIcon variant="subtle" color="teal" size="sm" onClick={restart} aria-label="Ejecutar">
            {active ? <IconRefresh size={15} /> : <IconPlayerPlay size={15} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Detener">
          <ActionIcon variant="subtle" color="red" size="sm" disabled={!active} onClick={stop} aria-label="Detener">
            <IconPlayerStop size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Limpiar salida">
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={clear} aria-label="Limpiar salida">
            <IconClearAll size={15} />
          </ActionIcon>
        </Tooltip>
        {process?.ready && process.port && (
          <Tooltip label={`Abrir http://localhost:${process.port}`}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => openUrl(`http://localhost:${process.port}`)}
              aria-label="Abrir en navegador"
            >
              <IconExternalLink size={15} />
            </ActionIcon>
          </Tooltip>
        )}
        <Text size="xs" c="dimmed" ff="monospace" truncate ml={6} style={{ flex: 1 }}>
          {command.command}
        </Text>
        <Text size="xs" c="dimmed">
          {process ? statusText(process) : "sin ejecutar"}
        </Text>
      </Group>
      {process ? (
        <LogView lines={lines} />
      ) : (
        <Text size="sm" c="dimmed" p="md">
          Doble clic o ▶ para ejecutar.
        </Text>
      )}
    </div>
  );
}

/** Human readable status of a process. */
function statusText(p: ProcessInfo): string {
  switch (p.status) {
    case "running":
      return p.port ? (p.ready ? `corriendo en :${p.port}` : `arrancando (:${p.port})`) : `corriendo · pid ${p.pid}`;
    case "stopping":
      return "deteniendo…";
    case "stopped":
      return "detenido";
    case "exited":
      return "terminó (0)";
    case "failed":
      return `error (código ${p.exitCode ?? "?"})`;
  }
}
