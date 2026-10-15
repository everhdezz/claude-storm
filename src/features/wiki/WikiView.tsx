import { useCallback, useEffect, useRef, useState } from "react";
import { ActionIcon, Center, Stack, Text, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconBook2, IconExternalLink, IconRefresh } from "@tabler/icons-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Island } from "../../components/ide/Island";
import { Splitter } from "../../components/ide/Splitter";
import { WIKI_CHANGED, type WikiChanged, type WikiKind, type WikiNode, wikiCreate, wikiDelete, wikiMove, wikiParent, wikiRename, wikiRoot, wikiTree } from "../../api/wiki";
import { notifyError } from "../../hooks/notify";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import { t } from "../../i18n";
import { useProjectContext } from "../project/ProjectContext";
import { WikiEditor } from "./WikiEditor";
import { WikiRootActions, WikiTree } from "./WikiTree";

/** What the wiki remembers per project window. */
export interface WikiUiState {
  open?: string | null;
  expanded?: string[];
  treeWidth?: number;
}

/** `path` after `from` was renamed or moved to `to` (unchanged if unrelated). */
function remap(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

function findNode(nodes: WikiNode[], path: string): WikiNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const inner = node.children ? findNode(node.children, path) : null;
    if (inner) return inner;
  }
  return null;
}

/** The project wiki: page tree on the left, the open page in a Notion-like editor on the right. */
export function WikiView({ hidden = false }: { hidden?: boolean }) {
  const { project, ui } = useProjectContext();
  const saved = ui.initial.wiki ?? {};
  const [nodes, setNodes] = useState<WikiNode[] | null>(null);
  const [open, setOpen] = useState<string | null>(saved.open ?? null);
  // Stays the same while the open page is renamed or moved, so the editor is not reloaded.
  const [openKey, setOpenKey] = useState(0);
  const [expanded, setExpanded] = useState<string[]>(saved.expanded ?? []);
  const [treeWidth, setTreeWidth] = useState(saved.treeWidth ?? 260);
  const [renaming, setRenaming] = useState<string | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  /** Reloads the tree; `apply` runs in the same render so the open page and tree never disagree. */
  const refresh = useCallback(
    (apply?: () => void) =>
      wikiTree(project.id)
        .then((tree) => {
          setNodes(tree);
          apply?.();
        })
        .catch((err) => notifyError(err, t("Could not load the wiki"))),
    [project.id],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Claude edited the wiki: follow a renamed/moved open page and reload it if its text changed.
  useTauriEvent<WikiChanged>(WIKI_CHANGED, ({ projectId, paths }) => {
    if (projectId !== project.id) return;
    refresh(() => {
      const current = openRef.current;
      const [from, to] = paths;
      if (from !== undefined && to !== undefined) relocate(from, to);
      else if (current && from === current) setOpenKey((k) => k + 1);
    });
  });

  useEffect(() => {
    ui.save({ wiki: { open, expanded, treeWidth } });
  }, [open, expanded, treeWidth, ui]);

  // A remembered page that no longer exists is closed.
  useEffect(() => {
    if (nodes && open && !findNode(nodes, open)) setOpen(null);
  }, [nodes, open]);

  function openPage(path: string) {
    if (path === openRef.current) return;
    setOpen(path);
    setOpenKey((k) => k + 1);
  }

  function expand(path: string) {
    setExpanded((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }

  async function create(parent: string, kind: WikiKind) {
    try {
      const path = await wikiCreate(project.id, parent, kind === "doc" ? t("Untitled") : t("New folder"), kind);
      await refresh(() => {
        if (parent) expand(parent);
        if (kind === "doc") openPage(path);
        else setRenaming(path);
      });
    } catch (err) {
      notifyError(err, t("Could not create it"));
    }
  }

  /** Applies a rename/move to the open page and expanded folders. */
  function relocate(from: string, to: string) {
    setOpen((prev) => (prev ? remap(prev, from, to) : prev));
    setExpanded((prev) => prev.map((p) => remap(p, from, to)));
  }

  async function rename(path: string, name: string) {
    setRenaming(null);
    try {
      const to = await wikiRename(project.id, path, name);
      await refresh(() => relocate(path, to));
    } catch (err) {
      notifyError(err, t("Could not rename it"));
    }
  }

  async function move(path: string, parent: string) {
    if (wikiParent(path) === parent) return;
    try {
      const to = await wikiMove(project.id, path, parent);
      await refresh(() => {
        relocate(path, to);
        if (parent) expand(parent);
      });
    } catch (err) {
      notifyError(err, t("Could not move it"));
    }
  }

  function confirmDelete(node: WikiNode) {
    modals.openConfirmModal({
      title: node.kind === "folder" ? t("Delete folder") : t("Delete page"),
      centered: true,
      children: (
        <Text size="sm">
          {node.kind === "folder"
            ? t("“{name}” and every page inside it are deleted. This cannot be undone.", { name: node.name })
            : t("“{name}” is deleted. This cannot be undone.", { name: node.name })}
        </Text>
      ),
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          if (open && remap(open, node.path, "") !== open) setOpen(null);
          await wikiDelete(project.id, node.path);
          await refresh();
        } catch (err) {
          notifyError(err, t("Could not delete it"));
        }
      },
    });
  }

  async function reveal() {
    try {
      await revealItemInDir(await wikiRoot(project.id));
    } catch (err) {
      notifyError(err);
    }
  }

  const openNode = nodes && open ? findNode(nodes, open) : null;

  return (
    <div style={{ display: hidden ? "none" : "flex", flex: 1, minWidth: 0, minHeight: 0 }}>
      <Island
        title="Wiki"
        style={{ width: treeWidth, flexShrink: 0 }}
        actions={
          <>
            <WikiRootActions onCreate={(kind) => create("", kind)} />
            <Tooltip label={t("Reload")}>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => refresh()} aria-label={t("Reload")}>
                <IconRefresh size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("Show in Finder")}>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={reveal} aria-label={t("Show in Finder")}>
                <IconExternalLink size={14} />
              </ActionIcon>
            </Tooltip>
          </>
        }
      >
        {nodes && (
          <WikiTree
            nodes={nodes}
            selected={open}
            expanded={expanded}
            renaming={renaming}
            onToggle={(path) => setExpanded((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]))}
            onOpen={openPage}
            onCreate={create}
            onStartRename={setRenaming}
            onRename={rename}
            onDelete={confirmDelete}
            onMove={move}
          />
        )}
      </Island>
      <Splitter direction="horizontal" value={treeWidth} min={180} max={520} onChange={setTreeWidth} />
      <Island style={{ flex: 1 }}>
        {open && openNode ? (
          <WikiEditor key={openKey} projectId={project.id} path={open} name={openNode.name} onRename={(name) => rename(open, name)} />
        ) : (
          <Center h="100%">
            <Stack align="center" gap={6}>
              <IconBook2 size={40} stroke={1.2} color="var(--mantine-color-dimmed)" />
              <Text size="sm" c="dimmed">
                {t("Pick a page in the tree or create a new one.")}
              </Text>
            </Stack>
          </Center>
        )}
      </Island>
    </div>
  );
}
