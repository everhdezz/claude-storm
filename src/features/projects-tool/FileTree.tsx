import { useCallback, useEffect, useState } from "react";
import { Loader, Text } from "@mantine/core";
import { IconChevronDown, IconChevronRight, IconFolder, IconFolderOpen } from "@tabler/icons-react";
import { FileIcon } from "../../components/FileIcon";
import { type FileEntry, repoListDir } from "../../api/files";
import { t } from "../../i18n";
import type { Repo } from "../../types";
import { useProjectContext } from "../project/ProjectContext";
import classes from "./projects-tool.module.css";

const INDENT = 14;

/** Files of an expanded repo; folders load when they are opened, files open in the code editor. */
export function FileTree({ repo }: { repo: Repo }) {
  const { project, openFile, activeFile, mainView } = useProjectContext();
  const [entries, setEntries] = useState<Record<string, FileEntry[] | "error">>({});
  const [expanded, setExpanded] = useState<string[]>([]);

  const load = useCallback(
    (path: string) =>
      repoListDir(project.id, repo.id, path)
        .then((list) => setEntries((prev) => ({ ...prev, [path]: list })))
        .catch(() => setEntries((prev) => ({ ...prev, [path]: "error" }))),
    [project.id, repo.id],
  );

  useEffect(() => {
    load("");
  }, [load]);

  function toggle(entry: FileEntry) {
    if (expanded.includes(entry.path)) {
      setExpanded((prev) => prev.filter((p) => p !== entry.path));
      return;
    }
    setExpanded((prev) => [...prev, entry.path]);
    // Reloaded on every open so new files show up.
    load(entry.path);
  }

  function renderDir(path: string, depth: number): React.ReactNode {
    const list = entries[path];
    if (list === undefined) {
      return (
        <div className={classes.fileRow} style={{ paddingLeft: 30 + depth * INDENT }}>
          <Loader size={10} />
        </div>
      );
    }
    if (list === "error") {
      return (
        <Text size="xs" c="red" style={{ paddingLeft: 30 + depth * INDENT }}>
          {t("Could not read the folder")}
        </Text>
      );
    }
    if (list.length === 0 && depth > 0) {
      return (
        <Text size="xs" c="dimmed" style={{ paddingLeft: 30 + depth * INDENT }}>
          {t("Empty folder")}
        </Text>
      );
    }
    return list.map((entry) => {
      const open = expanded.includes(entry.path);
      const selected = mainView === "code" && !entry.dir && activeFile?.repoId === repo.id && activeFile.path === entry.path;
      return (
        <div key={entry.path}>
          <div
            className={classes.fileRow}
            data-selected={selected || undefined}
            data-hidden={entry.name.startsWith(".") || undefined}
            style={{ paddingLeft: 26 + depth * INDENT }}
            title={entry.path}
            onClick={() => (entry.dir ? toggle(entry) : openFile(repo.id, entry.path))}
          >
            <span className={classes.fileChevron}>{entry.dir && (open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />)}</span>
            {entry.dir ? (
              open ? (
                <IconFolderOpen size={15} stroke={1.6} color="var(--mantine-color-yellow-5)" />
              ) : (
                <IconFolder size={15} stroke={1.6} color="var(--mantine-color-yellow-5)" />
              )
            ) : (
              <FileIcon name={entry.name} />
            )}
            <Text size="xs" truncate style={{ flex: 1 }}>
              {entry.name}
            </Text>
          </div>
          {entry.dir && open && renderDir(entry.path, depth + 1)}
        </div>
      );
    });
  }

  // Rows must not start a drag of the repo they belong to.
  return <div onPointerDown={(e) => e.stopPropagation()}>{renderDir("", 0)}</div>;
}
