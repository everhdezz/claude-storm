import { useState } from "react";
import { ActionIcon, Menu, ScrollArea, Text, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconFolderOpen,
  IconFolderPlus,
  IconPencil,
  IconPlayerPlay,
  IconPlayerStop,
  IconServerBolt,
  IconTerminal2,
  IconTrash,
  IconWand,
} from "@tabler/icons-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { isActive, processKey, stopProcess } from "../../api/processes";
import { getProject } from "../../api/projects";
import { redetectRepo, removeRepo } from "../../api/repos";
import { FrameworkIcon } from "../../components/FrameworkIcon";
import { GitBadge } from "../../components/GitBadge";
import { Island } from "../../components/ide/Island";
import { notifyError } from "../../hooks/notify";
import type { Framework, Repo, RepoCommand } from "../../types";
import { ProcessStatusDot } from "../processes/ProcessStatusDot";
import { useRunCommand } from "../processes/useRunCommand";
import { useProjectContext } from "../project/ProjectContext";
import { EditRepoModal } from "../repos/EditRepoModal";
import { useAddFolder } from "../repos/useAddRepos";
import classes from "./projects-tool.module.css";

const NODE_FRAMEWORKS: Framework[] = ["vite", "next", "react", "expo", "node"];

/** Left tool window listing the project's repos with run buttons and repo settings. */
export function ProjectsTool({ style }: { style?: React.CSSProperties }) {
  const { project } = useProjectContext();
  const addRepo = useAddFolder(project.id);
  const [editing, setEditing] = useState<Repo | null>(null);

  return (
    <Island
      title={project.name}
      style={style}
      actions={
        <Tooltip label="Agregar repo">
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={addRepo} aria-label="Agregar repo">
            <IconFolderPlus size={15} />
          </ActionIcon>
        </Tooltip>
      }
    >
      <ScrollArea style={{ flex: 1 }} type="auto">
        {project.repos.length === 0 ? (
          <Text size="sm" c="dimmed" px="md" py="xs">
            Sin repos. Usa «Agregar repo».
          </Text>
        ) : (
          project.repos.map((repo) => <RepoNode key={repo.id} repo={repo} onEdit={() => setEditing(repo)} />)
        )}
      </ScrollArea>
      <EditRepoModal projectId={project.id} repo={editing} onClose={() => setEditing(null)} />
    </Island>
  );
}

/** Expandable repo card; children are its runnable commands, settings live in the "…" menu. */
function RepoNode({ repo, onEdit }: { repo: Repo; onEdit: () => void }) {
  const { project, gitStatuses, gitErrors, processes, openTerminalAt } = useProjectContext();
  const run = useRunCommand();
  const [open, setOpen] = useState(true);
  const procs = repo.commands.map((c) => processes[processKey(repo.id, c.id)]).filter((p) => !!p);
  const isNode = NODE_FRAMEWORKS.includes(repo.framework);
  const devCommand = repo.commands.find((c) => c.longRunning);

  async function startDevServer() {
    if (devCommand) return run(repo, devCommand);
    try {
      await redetectRepo(project.id, repo.id);
      const fresh = (await getProject(project.id)).repos.find((r) => r.id === repo.id);
      const detected = fresh?.commands.find((c) => c.longRunning);
      if (fresh && detected) await run(fresh, detected);
      else notifyError("No se encontró un script dev/start en package.json", "Sin servidor de pruebas");
    } catch (err) {
      notifyError(err);
    }
  }

  function confirmRemove() {
    modals.openConfirmModal({
      title: `Quitar ${repo.name} del proyecto`,
      centered: true,
      children: <Text size="sm">La carpeta en disco no se toca.</Text>,
      labels: { confirm: "Quitar", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: () => removeRepo(project.id, repo.id).catch((err) => notifyError(err)),
    });
  }

  function confirmRedetect() {
    modals.openConfirmModal({
      title: "Volver a detectar framework",
      centered: true,
      children: <Text size="sm">Se reemplazarán los comandos actuales por los detectados.</Text>,
      labels: { confirm: "Detectar", cancel: "Cancelar" },
      onConfirm: () => redetectRepo(project.id, repo.id).catch((err) => notifyError(err)),
    });
  }

  return (
    <div>
      <div className={classes.row} onClick={() => setOpen((v) => !v)}>
        {open ? <IconChevronDown size={14} className={classes.chevron} /> : <IconChevronRight size={14} className={classes.chevron} />}
        <FrameworkIcon framework={repo.framework} size={20} />
        <div className={classes.label}>
          <Text size="sm" fw={500} truncate>
            {repo.name}
          </Text>
          {gitErrors[repo.id] ? (
            <Text size="xs" c="red" truncate>
              {gitErrors[repo.id]}
            </Text>
          ) : (
            <GitBadge status={gitStatuses[repo.id]} compact />
          )}
        </div>
        <ProcessStatusDot processes={procs} />
        <div className={classes.rowActions} onClick={(e) => e.stopPropagation()}>
          {isNode && (!devCommand || !isActive(processes[processKey(repo.id, devCommand.id)])) && (
            <Tooltip label="Levantar servidor de pruebas" openDelay={300}>
              <ActionIcon variant="subtle" color="teal" size="sm" onClick={startDevServer} aria-label="Levantar servidor de pruebas">
                <IconServerBolt size={15} />
              </ActionIcon>
            </Tooltip>
          )}
          {isNode && devCommand && isActive(processes[processKey(repo.id, devCommand.id)]) && (
            <CommandToggle repo={repo} command={devCommand} onRun={run} />
          )}
          {!isNode && devCommand && <CommandToggle repo={repo} command={devCommand} onRun={run} />}
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Ajustes del repo">
                <IconDots size={14} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {repo.commands.length > 0 && <Menu.Label>Ejecutar</Menu.Label>}
              {repo.commands.map((c) => (
                <Menu.Item key={c.id} leftSection={<IconPlayerPlay size={13} />} onClick={() => run(repo, c)}>
                  {c.label}
                </Menu.Item>
              ))}
              {repo.commands.length > 0 && <Menu.Divider />}
              <Menu.Item leftSection={<IconPencil size={13} />} onClick={onEdit}>
                Editar comandos
              </Menu.Item>
              <Menu.Item leftSection={<IconWand size={13} />} onClick={confirmRedetect}>
                Volver a detectar
              </Menu.Item>
              <Menu.Item leftSection={<IconTerminal2 size={13} />} onClick={() => openTerminalAt(repo.path)}>
                Abrir terminal aquí
              </Menu.Item>
              <Menu.Item leftSection={<IconFolderOpen size={13} />} onClick={() => revealItemInDir(repo.path)}>
                Mostrar en carpeta
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<IconTrash size={13} />} onClick={confirmRemove}>
                Quitar del proyecto
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>
      {open &&
        repo.commands.map((command) => (
          <div key={command.id} className={classes.child}>
            <ProcessStatusDot processes={[processes[processKey(repo.id, command.id)]].filter((p) => !!p)} keepSpace />
            <Text size="xs" truncate style={{ flex: 1 }} c="gray.4">
              {command.label}
            </Text>
            <CommandToggle repo={repo} command={command} onRun={run} />
          </div>
        ))}
    </div>
  );
}

interface CommandToggleProps {
  repo: Repo;
  command: RepoCommand;
  onRun: (repo: Repo, command: RepoCommand) => void;
}

/** Play/stop button for one command; output goes to the Services tool window. */
function CommandToggle({ repo, command, onRun }: CommandToggleProps) {
  const { processes, revealService } = useProjectContext();
  const proc = processes[processKey(repo.id, command.id)];
  const active = isActive(proc);
  return (
    <Tooltip label={`${active ? "Detener" : "Ejecutar"} ${command.label}`} openDelay={300}>
      <ActionIcon
        variant="subtle"
        color={active ? "red" : "teal"}
        size="sm"
        loading={proc?.status === "stopping"}
        onClick={(e) => {
          e.stopPropagation();
          if (active && proc) {
            stopProcess(proc.id).catch((err) => notifyError(err));
            revealService(proc.id);
          } else onRun(repo, command);
        }}
        aria-label={`${active ? "Detener" : "Ejecutar"} ${command.label}`}
      >
        {active ? <IconPlayerStop size={14} /> : <IconPlayerPlay size={14} />}
      </ActionIcon>
    </Tooltip>
  );
}
