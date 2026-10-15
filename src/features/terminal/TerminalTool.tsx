import { useEffect, useRef, useState } from "react";
import { ActionIcon, Menu, Text, Tooltip } from "@mantine/core";
import { IconChevronDown, IconPlus, IconX } from "@tabler/icons-react";
import { homeDir } from "@tauri-apps/api/path";
import { Island } from "../../components/ide/Island";
import { useProjectContext } from "../project/ProjectContext";
import { XtermView } from "./XtermView";
import classes from "./terminal.module.css";

interface TerminalTab {
  key: string;
  cwd: string;
  title: string;
}

interface SavedTerminals {
  tabs: { cwd: string; title: string }[];
  active: number;
}

interface TerminalToolProps {
  visible: boolean;
  request: { cwd: string; seq: number } | null;
  saved?: SavedTerminals;
  onTabsChange: (state: SavedTerminals) => void;
  style?: React.CSSProperties;
}

let counter = 0;

/** Tabbed terminal tool window; shells stay alive while the island is hidden. */
export function TerminalTool({ visible, request, saved, onTabsChange, style }: TerminalToolProps) {
  const { project } = useProjectContext();
  const [tabs, setTabs] = useState<TerminalTab[]>(() =>
    (saved?.tabs ?? []).map((t) => {
      counter += 1;
      return { key: `t${counter}`, cwd: t.cwd, title: t.title };
    }),
  );
  const [active, setActive] = useState<string | null>(() => tabs[saved?.active ?? 0]?.key ?? null);
  const report = useRef(onTabsChange);
  report.current = onTabsChange;

  useEffect(() => {
    report.current({ tabs: tabs.map((t) => ({ cwd: t.cwd, title: t.title })), active: Math.max(0, tabs.findIndex((t) => t.key === active)) });
  }, [tabs, active]);
  const opening = useRef(false);

  async function add(cwd?: string) {
    const folder = cwd ?? project.repos[0]?.path ?? (await homeDir());
    counter += 1;
    const tab = { key: `t${counter}`, cwd: folder, title: folder.split(/[\\/]/).pop() || folder };
    setTabs((prev) => [...prev, tab]);
    setActive(tab.key);
  }

  function close(key: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.key !== key);
      if (active === key) setActive(next.at(-1)?.key ?? null);
      return next;
    });
  }

  function rename(key: string, title: string) {
    setTabs((prev) => (prev.some((t) => t.key === key && t.title !== title) ? prev.map((t) => (t.key === key ? { ...t, title } : t)) : prev));
  }

  useEffect(() => {
    if (request) add(request.cwd);
  }, [request?.seq]);

  useEffect(() => {
    if (!visible || tabs.length > 0 || opening.current) return;
    opening.current = true;
    add().finally(() => {
      opening.current = false;
    });
  }, [visible, tabs.length]);

  const tabStrip = (
    <div className={classes.tabs}>
      {tabs.map((t) => (
        <div key={t.key} className={classes.tab} data-active={t.key === active || undefined} onClick={() => setActive(t.key)}>
          <Text size="xs" truncate maw={160}>
            {t.title}
          </Text>
          <IconX
            size={12}
            className={classes.tabClose}
            onClick={(e) => {
              e.stopPropagation();
              close(t.key);
            }}
          />
        </div>
      ))}
    </div>
  );

  const actions = (
    <>
      <Tooltip label="Nueva terminal">
        <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => add()} aria-label="Nueva terminal">
          <IconPlus size={15} />
        </ActionIcon>
      </Tooltip>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Abrir terminal en un repo">
            <IconChevronDown size={15} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Abrir en</Menu.Label>
          {project.repos.map((r) => (
            <Menu.Item key={r.id} onClick={() => add(r.path)}>
              {r.name}
            </Menu.Item>
          ))}
          <Menu.Item onClick={async () => add(await homeDir())}>Carpeta personal</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </>
  );

  return (
    <Island
      title={
        <>
          <span>Terminal</span>
          {tabStrip}
        </>
      }
      actions={actions}
      style={{ ...style, display: visible ? undefined : "none" }}
    >
      <div className={classes.body}>
        {tabs.map((t) => (
          <XtermView
            key={t.key}
            projectId={project.id}
            cwd={t.cwd}
            visible={visible && t.key === active}
            onTitle={(title) => rename(t.key, title)}
            onExit={() => close(t.key)}
          />
        ))}
      </div>
    </Island>
  );
}
