import { useState } from "react";
import { ActionIcon, Menu, ScrollArea, Text, TextInput, UnstyledButton } from "@mantine/core";
import {
  IconChevronRight,
  IconCopy,
  IconDots,
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { type WikiKind, type WikiNode, wikiReference } from "../../api/wiki";
import { notifyError, notifySuccess } from "../../hooks/notify";
import { t } from "../../i18n";
import classes from "./wiki.module.css";

/** Drag payload type, so drops from outside the tree are ignored. */
const DRAG_TYPE = "application/x-claude-storm-wiki";

interface WikiTreeProps {
  nodes: WikiNode[];
  selected: string | null;
  expanded: string[];
  /** Path being renamed inline, if any. */
  renaming: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onCreate: (parent: string, kind: WikiKind) => void;
  onStartRename: (path: string | null) => void;
  onRename: (path: string, name: string) => void;
  onDelete: (node: WikiNode) => void;
  onMove: (path: string, parent: string) => void;
}

/** Notion-like page tree: folders and documents, inline rename, hover actions and drag-to-move. */
export function WikiTree(props: WikiTreeProps) {
  const [rootOver, setRootOver] = useState(false);
  return (
    <ScrollArea style={{ flex: 1 }} type="auto">
      <div
        className={classes.treeRoot}
        data-over={rootOver || undefined}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          setRootOver(true);
        }}
        onDragLeave={() => setRootOver(false)}
        onDrop={(e) => {
          setRootOver(false);
          const path = e.dataTransfer.getData(DRAG_TYPE);
          if (path) props.onMove(path, "");
        }}
      >
        {props.nodes.length === 0 ? (
          <Text size="xs" c="dimmed" ta="center" p="md">
            {t("The wiki is empty. Create a page or a folder to start.")}
          </Text>
        ) : (
          props.nodes.map((node) => <TreeRow key={node.path} node={node} depth={0} {...props} />)
        )}
      </div>
    </ScrollArea>
  );
}

/** Copies a page's `wiki://` reference, to paste in a chat as context. */
function copyReference(node: WikiNode) {
  navigator.clipboard
    .writeText(wikiReference(node))
    .then(() => notifySuccess(t("Reference copied. Paste it in a chat so Claude reads this page.")))
    .catch((err) => notifyError(err));
}

function TreeRow({ node, depth, ...props }: WikiTreeProps & { node: WikiNode; depth: number }) {
  const [over, setOver] = useState(false);
  const isFolder = node.kind === "folder";
  const open = isFolder && props.expanded.includes(node.path);
  const FolderIcon = open ? IconFolderOpen : IconFolder;

  return (
    <>
      <div
        className={classes.treeRow}
        data-selected={props.selected === node.path || undefined}
        data-over={over || undefined}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={props.renaming !== node.path}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, node.path);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!isFolder || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!isFolder) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const path = e.dataTransfer.getData(DRAG_TYPE);
          if (path && path !== node.path) props.onMove(path, node.path);
        }}
        onClick={() => (isFolder ? props.onToggle(node.path) : props.onOpen(node.path))}
        onDoubleClick={() => props.onStartRename(node.path)}
      >
        <span className={classes.chevron} data-open={open || undefined}>
          {isFolder && <IconChevronRight size={12} />}
        </span>
        {isFolder ? <FolderIcon size={15} className={classes.folderIcon} /> : <IconFileText size={15} className={classes.docIcon} />}
        {props.renaming === node.path ? (
          <RenameInput initial={node.name} onDone={(name) => (name ? props.onRename(node.path, name) : props.onStartRename(null))} />
        ) : (
          <Text size="sm" truncate style={{ flex: 1 }}>
            {node.name}
          </Text>
        )}
        <div className={classes.rowActions} onClick={(e) => e.stopPropagation()}>
          {isFolder && (
            <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => props.onCreate(node.path, "doc")} aria-label={t("New page")}>
              <IconPlus size={13} />
            </ActionIcon>
          )}
          <Menu position="bottom-start" withinPortal shadow="md">
            <Menu.Target>
              <ActionIcon size="xs" variant="subtle" color="gray" aria-label={t("More")}>
                <IconDots size={13} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {isFolder && (
                <>
                  <Menu.Item leftSection={<IconFileText size={14} />} onClick={() => props.onCreate(node.path, "doc")}>
                    {t("New page")}
                  </Menu.Item>
                  <Menu.Item leftSection={<IconFolderPlus size={14} />} onClick={() => props.onCreate(node.path, "folder")}>
                    {t("New folder")}
                  </Menu.Item>
                  <Menu.Divider />
                </>
              )}
              {node.id && (
                <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => copyReference(node)}>
                  {t("Copy reference")}
                </Menu.Item>
              )}
              <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => props.onStartRename(node.path)}>
                {t("Rename")}
              </Menu.Item>
              <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => props.onDelete(node)}>
                {t("Delete")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>
      {open && node.children?.map((child) => <TreeRow key={child.path} node={child} depth={depth + 1} {...props} />)}
      {open && !node.children?.length && (
        <Text size="xs" c="dimmed" style={{ paddingLeft: 34 + (depth + 1) * 14 }} py={3}>
          {t("Empty folder")}
        </Text>
      )}
    </>
  );
}

/** Inline name editor: Enter or blur saves, Escape cancels (reports ""). */
function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  const [done, setDone] = useState(false);
  function finish(name: string) {
    if (done) return;
    setDone(true);
    onDone(name.trim() === initial ? "" : name.trim());
  }
  return (
    <TextInput
      size="xs"
      style={{ flex: 1 }}
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.currentTarget.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") finish("");
      }}
    />
  );
}

/** Header button pair for the wiki root. */
export function WikiRootActions({ onCreate }: { onCreate: (kind: WikiKind) => void }) {
  return (
    <>
      <UnstyledButton className={classes.headerButton} onClick={() => onCreate("doc")} aria-label={t("New page")} title={t("New page")}>
        <IconPlus size={15} />
      </UnstyledButton>
      <UnstyledButton className={classes.headerButton} onClick={() => onCreate("folder")} aria-label={t("New folder")} title={t("New folder")}>
        <IconFolderPlus size={15} />
      </UnstyledButton>
    </>
  );
}
