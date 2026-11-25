import { useCallback, useEffect, useState } from "react";
import { WIKI_CHANGED, type WikiChanged, type WikiKind, type WikiNode, wikiCreate, wikiDelete, wikiMove, wikiParent, wikiRename, wikiTree } from "../../api/wiki";
import { notifyError } from "../../hooks/notify";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import { t } from "../../i18n";

/** What the wiki tree remembers per project window. */
export interface WikiUiState {
  /** Page open before the wiki moved into tabs (read once to migrate). */
  open?: string | null;
  expanded?: string[];
}

export function findWikiNode(nodes: WikiNode[], path: string): WikiNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const inner = node.children ? findWikiNode(node.children, path) : null;
    if (inner) return inner;
  }
  return null;
}

/** How the wiki reaches the page tabs of the main area. */
interface WikiTabs {
  openPage: (path: string) => void;
  relocate: (from: string, to: string) => void;
}

/** The project's wiki tree and its operations; open pages live in the main area's tabs. */
export function useWiki(projectId: string, tabs: WikiTabs) {
  const [nodes, setNodes] = useState<WikiNode[] | null>(null);

  /** Reloads the tree; `apply` runs in the same render so tabs and tree never disagree. */
  const refresh = useCallback(
    (apply?: () => void) =>
      wikiTree(projectId)
        .then((tree) => {
          setNodes(tree);
          apply?.();
        })
        .catch((err) => notifyError(err, t("Could not load the wiki"))),
    [projectId],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Claude edited the wiki: renamed or moved pages keep their tabs (the pane reloads changed text).
  useTauriEvent<WikiChanged>(WIKI_CHANGED, ({ projectId: changed, paths }) => {
    if (changed !== projectId) return;
    const [from, to] = paths;
    refresh(() => {
      if (from !== undefined && to !== undefined) tabs.relocate(from, to);
    });
  });

  /** Creates a page (opened in a tab) or folder; returns its path. */
  async function create(parent: string, kind: WikiKind): Promise<string | null> {
    try {
      const path = await wikiCreate(projectId, parent, kind === "doc" ? t("Untitled") : t("New folder"), kind);
      await refresh(() => kind === "doc" && tabs.openPage(path));
      return path;
    } catch (err) {
      notifyError(err, t("Could not create it"));
      return null;
    }
  }

  async function rename(path: string, name: string): Promise<string | null> {
    try {
      const to = await wikiRename(projectId, path, name);
      await refresh(() => tabs.relocate(path, to));
      return to;
    } catch (err) {
      notifyError(err, t("Could not rename it"));
      return null;
    }
  }

  async function move(path: string, parent: string): Promise<string | null> {
    if (wikiParent(path) === parent) return null;
    try {
      const to = await wikiMove(projectId, path, parent);
      await refresh(() => tabs.relocate(path, to));
      return to;
    } catch (err) {
      notifyError(err, t("Could not move it"));
      return null;
    }
  }

  async function remove(node: WikiNode) {
    try {
      await wikiDelete(projectId, node.path);
      await refresh();
    } catch (err) {
      notifyError(err, t("Could not delete it"));
    }
  }

  return { nodes, refresh, create, rename, move, remove };
}

export type Wiki = ReturnType<typeof useWiki>;

