import { useEffect, useState } from "react";
import { ActionIcon, Text, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconExternalLink, IconRefresh } from "@tabler/icons-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { type WikiKind, type WikiNode, wikiRoot } from "../../api/wiki";
import { Island } from "../../components/ide/Island";
import { notifyError } from "../../hooks/notify";
import { t } from "../../i18n";
import { useProjectContext } from "../project/ProjectContext";
import { remapPath } from "../project/useMainTabs";
import { WikiRootActions, WikiTree } from "./WikiTree";

/** Left tool window with the project wiki's page tree; pages open as tabs in the main area. */
export function WikiTool({ style, onMinimize }: { style?: React.CSSProperties; onMinimize?: () => void }) {
  const { project, ui, wiki, activeTab, openWikiPage } = useProjectContext();
  const [expanded, setExpanded] = useState<string[]>(ui.initial.wiki?.expanded ?? []);
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    ui.save({ wiki: { expanded } });
  }, [expanded, ui]);

  function expand(path: string) {
    setExpanded((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }

  async function create(parent: string, kind: WikiKind) {
    const path = await wiki.create(parent, kind);
    if (!path) return;
    if (parent) expand(parent);
    if (kind === "folder") setRenaming(path);
  }

  async function rename(path: string, name: string) {
    setRenaming(null);
    const to = await wiki.rename(path, name);
    if (to) setExpanded((prev) => prev.map((p) => remapPath(p, path, to)));
  }

  async function move(path: string, parent: string) {
    const to = await wiki.move(path, parent);
    if (!to) return;
    setExpanded((prev) => prev.map((p) => remapPath(p, path, to)));
    if (parent) expand(parent);
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
      onConfirm: () => wiki.remove(node),
    });
  }

  async function reveal() {
    try {
      await revealItemInDir(await wikiRoot(project.id));
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <Island
      title="Wiki"
      style={style}
      onMinimize={onMinimize}
      actions={
        <>
          <WikiRootActions onCreate={(kind) => create("", kind)} />
          <Tooltip label={t("Reload")}>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => wiki.refresh()} aria-label={t("Reload")}>
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
      {wiki.nodes && (
        <WikiTree
          nodes={wiki.nodes}
          selected={activeTab?.kind === "wiki" ? activeTab.path : null}
          expanded={expanded}
          renaming={renaming}
          onToggle={(path) => setExpanded((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]))}
          onOpen={openWikiPage}
          onCreate={create}
          onStartRename={setRenaming}
          onRename={rename}
          onDelete={confirmDelete}
          onMove={move}
        />
      )}
    </Island>
  );
}
