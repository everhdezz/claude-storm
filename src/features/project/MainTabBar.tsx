import { useEffect, useRef } from "react";
import { ActionIcon, Loader } from "@mantine/core";
import { IconFileText, IconMessageChatbot, IconSparkles, IconX } from "@tabler/icons-react";
import { FileIcon, fileKind } from "../../components/FileIcon";
import { t } from "../../i18n";
import type { Project, Session } from "../../types";
import { type MainTab, tabKey, tabLabels } from "./useMainTabs";
import classes from "./tabs.module.css";

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirs = (path: string) => path.split("/").slice(0, -1);

interface MainTabBarProps {
  tabs: MainTab[];
  active: string | null;
  project: Project;
  sessions: Session[];
  /** Keys of code tabs with unsaved edits. */
  dirty: string[];
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}

/** One tab strip for chats, wiki pages and files; repeated names show where each one lives. */
export function MainTabBar({ tabs, active, project, sessions, dirty, onActivate, onClose }: MainTabBarProps) {
  const repoName = (id: string) => project.repos.find((r) => r.id === id)?.name ?? "?";
  const describe = (tab: MainTab) => {
    if (tab.kind === "code") return { name: baseName(tab.path), parents: [repoName(tab.repoId), ...dirs(tab.path)], title: `${repoName(tab.repoId)} / ${tab.path}` };
    if (tab.kind === "wiki") {
      const name = baseName(tab.path).replace(/\.md$/, "");
      return { name, parents: ["Wiki", ...dirs(tab.path)], title: `Wiki / ${tab.path.replace(/\.md$/, "")}` };
    }
    const session = sessions.find((s) => s.id === tab.sessionId);
    const name = tab.sessionId ? (session?.title ?? "Chat") : t("New chat");
    // Two chats with the same title are told apart by when they started.
    const started = session ? new Date(session.createdAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "";
    return { name, parents: started ? [started] : [], title: name };
  };
  const described = tabs.map((tab) => ({ tab, key: tabKey(tab), ...describe(tab) }));
  const labels = tabLabels(described);
  const strip = useRef<HTMLDivElement>(null);

  // The active tab is always scrolled into view, also when opened from a tool window.
  useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs.length]);

  if (tabs.length === 0) return null;
  return (
    <div ref={strip} className={classes.tabs} role="tablist">
      {described.map(({ tab, key, title }) => {
        const label = labels.get(key)!;
        const isActive = key === active;
        const session = tab.kind === "chat" ? sessions.find((s) => s.id === tab.sessionId) : undefined;
        const accent = tab.kind === "code" ? fileKind(label.name).color : tab.kind === "wiki" ? "var(--mantine-color-teal-4)" : "var(--mantine-color-orange-4)";
        return (
          <div
            key={key}
            role="tab"
            aria-selected={isActive}
            className={classes.tab}
            data-active={isActive || undefined}
            style={isActive ? { borderBottomColor: accent } : undefined}
            title={title}
            onClick={() => onActivate(key)}
            onAuxClick={(e) => e.button === 1 && onClose(key)}
          >
            {tab.kind === "code" && <FileIcon name={label.name} size={14} />}
            {tab.kind === "wiki" && <IconFileText size={14} color="var(--mantine-color-teal-4)" />}
            {tab.kind === "chat" &&
              (session?.status === "working" ? (
                <Loader size={11} color="orange" />
              ) : tab.sessionId ? (
                <IconMessageChatbot size={14} color="var(--mantine-color-orange-4)" />
              ) : (
                <IconSparkles size={14} color="var(--mantine-color-orange-4)" />
              ))}
            {label.hint && <span className={classes.hint}>{label.hint} ›</span>}
            <span className={classes.name}>{label.name}</span>
            {dirty.includes(key) && <span className={classes.dot} />}
            <ActionIcon
              variant="subtle"
              color="gray"
              size="xs"
              className={classes.close}
              onClick={(e) => {
                e.stopPropagation();
                onClose(key);
              }}
              aria-label={t("Close")}
            >
              <IconX size={11} />
            </ActionIcon>
          </div>
        );
      })}
    </div>
  );
}
