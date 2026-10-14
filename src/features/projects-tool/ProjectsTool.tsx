import { useEffect, useMemo, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ActionIcon, Menu, ScrollArea, Text, TextInput, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconFolderShare,
  IconFolderX,
  IconPlus,
  IconPencil,
  IconPlayerPlay,
  IconPlayerStop,
  IconTerminal2,
  IconTrash,
  IconWand,
} from "@tabler/icons-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { isActive, processKey, stopProcess } from "../../api/processes";
import { getProject } from "../../api/projects";
import { redetectRepo, removeRepo, saveRepoLayout } from "../../api/repos";
import { FrameworkIcon } from "../../components/FrameworkIcon";
import { GitBadge } from "../../components/GitBadge";
import { Island } from "../../components/ide/Island";
import { notifyError } from "../../hooks/notify";
import type { Framework, LayoutItem, Repo, RepoCommand } from "../../types";
import { ProcessStatusDot } from "../processes/ProcessStatusDot";
import { useRunCommand } from "../processes/useRunCommand";
import { useProjectContext } from "../project/ProjectContext";
import { EditRepoModal } from "../repos/EditRepoModal";
import { useAddFolder } from "../repos/useAddRepos";
import classes from "./projects-tool.module.css";
import { applyMove, flatten, INDENT, moveRepoToGroup, patchGroup, project as projectDrop, type FlatItem, ungroup } from "./repoTree";

const NODE_FRAMEWORKS: Framework[] = ["vite", "next", "react", "expo", "node"];

/** Left tool window: repos and one-level groups, reorderable by drag and drop. */
export function ProjectsTool({ style }: { style?: React.CSSProperties }) {
  const { project } = useProjectContext();
  const addRepo = useAddFolder(project.id);
  const [editing, setEditing] = useState<Repo | null>(null);
  const [layout, setLayout] = useState<LayoutItem[]>(project.layout);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (!activeId) setLayout(project.layout);
  }, [project.layout, activeId]);

  const items = useMemo(() => flatten(layout, activeId?.startsWith("group:") ? activeId : undefined), [layout, activeId]);
  const projection = activeId && overId ? projectDrop(items, activeId, overId, offsetX) : null;
  const reposById = new Map(project.repos.map((r) => [r.id, r]));
  const groups = layout.filter((i): i is Extract<LayoutItem, { kind: "group" }> => i.kind === "group");

  function persist(next: LayoutItem[]) {
    setLayout(next);
    saveRepoLayout(project.id, next).catch((err) => notifyError(err, "No se pudo guardar el orden"));
  }

  function newGroup() {
    const id = crypto.randomUUID();
    persist([{ kind: "group", id, name: "Nuevo grupo", collapsed: false, repoIds: [] }, ...layout]);
    setRenamingGroup(id);
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setOverId(String(e.active.id));
    setOffsetX(0);
  }

  function onDragMove(e: DragMoveEvent) {
    setOffsetX(e.delta.x);
  }

  function onDragOver(e: DragOverEvent) {
    setOverId(e.over ? String(e.over.id) : null);
  }

  function onDragEnd(e: DragEndEvent) {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    const target = over ? projectDrop(items, active, over, e.delta.x) : null;
    setActiveId(null);
    setOverId(null);
    if (over && target) persist(applyMove(layout, active, over, target));
  }

  return (
    <Island
      title={project.name}
      style={style}
      actions={
        <>
          <Tooltip label="Nuevo grupo">
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={newGroup} aria-label="Nuevo grupo">
              <IconFolderPlus size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Agregar repo">
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={addRepo} aria-label="Agregar repo">
              <IconPlus size={15} />
            </ActionIcon>
          </Tooltip>
        </>
      }
    >
      <ScrollArea style={{ flex: 1 }} type="auto">
        {project.repos.length === 0 && groups.length === 0 ? (
          <Text size="sm" c="dimmed" px="md" py="xs">
            Sin repos. Usa «Agregar repo».
          </Text>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {items.map((item) => {
                const depth = item.id === activeId && projection ? projection.depth : item.depth;
                if (item.kind === "group") {
                  const group = groups.find((g) => g.id === item.groupId)!;
                  return (
                    <SortableRow key={item.id} item={item} depth={depth}>
                      <GroupRow
                        group={group}
                        renaming={renamingGroup === group.id}
                        onRenameDone={(name) => {
                          setRenamingGroup(null);
                          if (name.trim()) persist(patchGroup(layout, group.id, { name: name.trim() }));
                        }}
                        onRename={() => setRenamingGroup(group.id)}
                        onToggle={() => persist(patchGroup(layout, group.id, { collapsed: !group.collapsed }))}
                        onUngroup={() => persist(ungroup(layout, group.id))}
                      />
                    </SortableRow>
                  );
                }
                const repo = reposById.get(item.repoId!);
                if (!repo) return null;
                return (
                  <SortableRow key={item.id} item={item} depth={depth}>
                    <RepoNode
                      repo={repo}
                      onEdit={() => setEditing(repo)}
                      groups={groups}
                      currentGroupId={item.parentId?.slice("group:".length) ?? null}
                      onMove={(groupId) => persist(moveRepoToGroup(layout, repo.id, groupId))}
                    />
                  </SortableRow>
                );
              })}
            </SortableContext>
          </DndContext>
        )}
      </ScrollArea>
      <EditRepoModal projectId={project.id} repo={editing} onClose={() => setEditing(null)} />
    </Island>
  );
}

/** Sortable wrapper that indents rows by depth and follows the pointer while dragging. */
function SortableRow({ item, depth, children }: { item: FlatItem; depth: number; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        paddingLeft: depth * INDENT,
        opacity: isDragging ? 0.6 : 1,
        position: "relative",
        zIndex: isDragging ? 2 : undefined,
        background: isDragging ? "var(--dh-hover)" : undefined,
        borderRadius: 6,
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

interface GroupRowProps {
  group: Extract<LayoutItem, { kind: "group" }>;
  renaming: boolean;
  onRename: () => void;
  onRenameDone: (name: string) => void;
  onToggle: () => void;
  onUngroup: () => void;
}

/** Group header: collapse, inline rename and ungroup. */
function GroupRow({ group, renaming, onRename, onRenameDone, onToggle, onUngroup }: GroupRowProps) {
  return (
    <div className={classes.row} onClick={onToggle}>
      {group.collapsed ? <IconChevronRight size={14} className={classes.chevron} /> : <IconChevronDown size={14} className={classes.chevron} />}
      <IconFolder size={18} stroke={1.6} color="var(--mantine-color-yellow-5)" />
      {renaming ? (
        <TextInput
          size="xs"
          defaultValue={group.name}
          autoFocus
          style={{ flex: 1 }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") onRenameDone(e.currentTarget.value);
            if (e.key === "Escape") onRenameDone("");
          }}
          onBlur={(e) => onRenameDone(e.currentTarget.value)}
        />
      ) : (
        <Text size="sm" fw={600} truncate style={{ flex: 1 }} onDoubleClick={(e) => (e.stopPropagation(), onRename())}>
          {group.name}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        {group.repoIds.length}
      </Text>
      <div className={classes.rowActions} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Acciones del grupo">
              <IconDots size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconPencil size={13} />} onClick={onRename}>
              Renombrar
            </Menu.Item>
            <Menu.Item leftSection={<IconFolderX size={13} />} onClick={onUngroup}>
              Desagrupar
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
    </div>
  );
}

/** Expandable repo card; children are its runnable commands, settings live in the "…" menu. */
interface RepoNodeProps {
  repo: Repo;
  onEdit: () => void;
  groups: Extract<LayoutItem, { kind: "group" }>[];
  currentGroupId: string | null;
  onMove: (groupId: string | null) => void;
}

function RepoNode({ repo, onEdit, groups, currentGroupId, onMove }: RepoNodeProps) {
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
        <div className={classes.rowActions} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {devCommand && <CommandToggle repo={repo} command={devCommand} onRun={run} label={serverLabel(devCommand)} />}
          {!devCommand && isNode && (
            <Tooltip label="run dev" openDelay={300}>
              <ActionIcon variant="subtle" color="teal" size="sm" onClick={startDevServer} aria-label="run dev">
                <IconPlayerPlay size={14} />
              </ActionIcon>
            </Tooltip>
          )}
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
              {(groups.length > 0 || currentGroupId) && <Menu.Label>Mover a</Menu.Label>}
              {groups
                .filter((g) => g.id !== currentGroupId)
                .map((g) => (
                  <Menu.Item key={g.id} leftSection={<IconFolderShare size={13} />} onClick={() => onMove(g.id)}>
                    {g.name}
                  </Menu.Item>
                ))}
              {currentGroupId && (
                <Menu.Item leftSection={<IconFolderX size={13} />} onClick={() => onMove(null)}>
                  Sacar del grupo
                </Menu.Item>
              )}
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
          <div key={command.id} className={classes.child} onPointerDown={(e) => e.stopPropagation()}>
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
  label?: string;
}

/** Short name of a server command: "artisan serve", "run dev", "run start", "expo start"… */
function serverLabel(command: RepoCommand): string {
  const line = command.command;
  if (/artisan\s+serve/.test(line)) return "artisan serve";
  const script = line.match(/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)/);
  if (script) return `run ${script[1]}`;
  const npx = line.match(/^npx\s+(\S+\s+\S+)/);
  return npx ? npx[1]! : command.label;
}

/** Play/stop button for one command; output goes to the Services tool window. */
function CommandToggle({ repo, command, onRun, label }: CommandToggleProps) {
  const { processes, revealService } = useProjectContext();
  const proc = processes[processKey(repo.id, command.id)];
  const active = isActive(proc);
  return (
    <Tooltip label={label ? (active ? `Detener ${label}` : label) : `${active ? "Detener" : "Ejecutar"} ${command.label}`} openDelay={300}>
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
