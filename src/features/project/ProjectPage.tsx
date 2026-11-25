import { Fragment, useEffect, useRef, useState } from "react";
import { Center, Loader, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconBook2, IconFolder, IconLayoutBoard, IconMessages, IconPlayerPlay, IconTerminal2 } from "@tabler/icons-react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import { isActive } from "../../api/processes";
import { refreshRepoFrameworks } from "../../api/repos";
import { hasWorktree, SESSION_DELETED } from "../../api/sessions";
import { Island } from "../../components/ide/Island";
import { Splitter } from "../../components/ide/Splitter";
import { ToolStripe, type StripeItem } from "../../components/ide/ToolStripe";
import ide from "../../components/ide/ide.module.css";
import { ChatsTool } from "../chats/ChatsTool";
import { CodeView } from "../code/CodeView";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import { useProcesses } from "../processes/useProcesses";
import { useSessions } from "../sessions/useSessions";
import { SettingsModal, type SettingsSection } from "../settings/SettingsModal";
import { useSettings } from "../settings/useSettings";
import { ProjectsTool } from "../projects-tool/ProjectsTool";
import { RunTargetPicker, ServicesTool } from "../services/ServicesTool";
import { StatusBar } from "../status/StatusBar";
import { TerminalTool } from "../terminal/TerminalTool";
import { findWikiNode, useWiki } from "../wiki/useWiki";
import { WikiPane } from "../wiki/WikiPane";
import { WikiTool } from "../wiki/WikiTool";
import { SearchEverywhere, type SearchMode } from "../search/SearchEverywhere";
import { MainTabBar } from "./MainTabBar";
import tabsCss from "./tabs.module.css";
import { type MainTab, type TabsUiState, tabKey, useMainTabs } from "./useMainTabs";
import { ProjectContext } from "./ProjectContext";
import { ProjectTitleBar } from "./ProjectTitleBar";
import { useGitStatuses } from "./useGitStatuses";
import { type BottomTool, LEFT_DEFAULT_HEIGHT, type LeftTool, useLayoutPrefs } from "./useLayoutPrefs";
import { useProject } from "./useProject";
import { useUiState } from "./useUiState";
import type { Project } from "../../types";
import type { ProjectUiState } from "./useUiState";
import { t, tn } from "../../i18n";

/** Root of a project window: loads the project, then renders its workspace. */
export function ProjectPage() {
  const { projectId = "" } = useParams();
  const { project, error } = useProject(projectId);

  if (error) {
    return (
      <Center h="100%">
        <Text c="red">{error}</Text>
      </Center>
    );
  }
  if (!project) {
    return (
      <Center h="100%">
        <Loader />
      </Center>
    );
  }
  return <ProjectWorkspace key={project.id} project={project} />;
}

/** JetBrains-style tool stripe, islands and status bar; restores and saves the window state. */
function ProjectWorkspace({ project }: { project: Project }) {
  const { sessionId = null } = useParams();
  const navigate = useNavigate();
  const ui = useUiState(project.id, project.uiState);
  const git = useGitStatuses(project.repos);
  const { processes } = useProcesses(project.id);
  const settings = useSettings();
  const sessions = useSessions(project.id, sessionId, settings.notifications);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const layout = useLayoutPrefs(ui.initial.layout, (prefs) => ui.save({ layout: prefs }));
  const [selectedService, setSelectedService] = useState<string | null>(ui.initial.selectedService ?? null);
  const [savedRunTarget, setSavedRunTarget] = useState<string | null>(ui.initial.runTarget ?? null);
  const [terminalRequest, setTerminalRequest] = useState<{ cwd: string; seq: number } | null>(null);
  const tabs = useMainTabs(initialTabs(ui.initial), (state) => ui.save({ tabs: state }));
  const wiki = useWiki(project.id, { openPage: openWikiPage, relocate: tabs.relocateWiki });
  const [dirtyCode, setDirtyCode] = useState<string[]>([]);
  const [codeReveal, setCodeReveal] = useState<{ key: string; line: number; seq: number } | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode | null>(null);
  const activeTab = tabs.activeTab;
  const codeTabs = tabs.tabs.flatMap((tab) => (tab.kind === "code" ? [{ repoId: tab.repoId, path: tab.path }] : []));

  // Each time the project opens, the framework of every repo is detected again (ports and commands stay; a repo without commands gets the detected ones).
  useEffect(() => {
    refreshRepoFrameworks(project.id).catch((err) => console.warn("Could not refresh repo frameworks", err));
  }, [project.id]);

  // The route shows one chat at a time: an active chat tab is reflected in the URL…
  const { pathname } = useLocation();
  useEffect(() => {
    if (activeTab?.kind !== "chat") return;
    const target = activeTab.sessionId ? `/project/${project.id}/session/${activeTab.sessionId}` : `/project/${project.id}`;
    if (pathname !== target) navigate(target, { replace: true });
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // …and a chat opened through the URL (Chats list, notifications, a chat just created) gets its tab.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    const tab: MainTab = { kind: "chat", sessionId };
    if (tabs.tabs.some((t) => tabKey(t) === tabKey(tab))) return tabs.activate(tabKey(tab));
    // The "new chat" tab turns into the chat it created.
    if (sessionId && tabs.active === tabKey({ kind: "chat", sessionId: null })) return tabs.replace(tabs.active, tab);
    tabs.open(tab);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useTauriEvent<string>(SESSION_DELETED, (id) => tabs.closeWhere((t) => t.kind === "chat" && t.sessionId === id));

  // Pages deleted from the wiki (here or by Claude) close their tabs.
  useEffect(() => {
    const nodes = wiki.nodes;
    if (nodes) tabs.closeWhere((t) => t.kind === "wiki" && !findWikiNode(nodes, t.path));
  }, [wiki.nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ui.save({ selectedService });
  }, [selectedService, ui]);

  useEffect(() => {
    ui.save({ runTarget: savedRunTarget });
  }, [savedRunTarget, ui]);

  const running = Object.values(processes).filter(isActive).length;
  // A target whose session was archived, deleted or lost its worktree falls back to the main checkout.
  const runTarget = sessions.some((s) => s.id === savedRunTarget && hasWorktree(s) && !s.archived) ? savedRunTarget : null;
  const account = settings.accounts.find((a) => a.id === project.accountId) ?? null;
  const { prefs } = layout;
  const sessionsWorking = sessions.some((s) => s.status === "working");
  const topItems: StripeItem<LeftTool>[] = [
    { id: "projects", label: t("Projects"), icon: IconFolder },
    { id: "wiki", label: "Wiki", icon: IconBook2 },
    { id: "chats", label: "Chats", icon: IconMessages, badge: sessionsWorking },
  ];
  const bottomItems: StripeItem<BottomTool>[] = [
    { id: "terminal", label: "Terminal", icon: IconTerminal2 },
    { id: "services", label: t("Services"), icon: IconPlayerPlay, badge: running > 0 },
  ];

  function revealService(processId: string) {
    setSelectedService(processId);
    layout.showBottom("services");
  }

  function openChat(id: string | null) {
    tabs.open({ kind: "chat", sessionId: id });
    // Wait for the chat to be visible again; a hidden textarea cannot take focus.
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-composer] .cm-content")?.focus());
  }

  function openFile(repoId: string, path: string, line?: number) {
    const tab: MainTab = { kind: "code", repoId, path };
    tabs.open(tab);
    if (line) setCodeReveal((prev) => ({ key: tabKey(tab), line, seq: (prev?.seq ?? 0) + 1 }));
  }

  // Search Everywhere: double Shift or ⌘⇧O for file names, ⌘⇧F for text in files.
  useEffect(() => {
    let lastShift = 0;
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        setSearchMode("files");
      } else if (mod && e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchMode("text");
      } else if (e.key === "Shift" && !e.repeat && !mod && !e.altKey) {
        const now = Date.now();
        if (now - lastShift < 350) {
          setSearchMode("files");
          lastShift = 0;
        } else lastShift = now;
      } else lastShift = 0;
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function openWikiPage(path: string) {
    tabs.open({ kind: "wiki", path });
  }

  /** Closes a tab; a file with unsaved edits asks first. */
  function closeTab(key: string) {
    if (!dirtyCode.includes(key)) return tabs.close(key);
    const tab = tabs.tabs.find((t) => tabKey(t) === key);
    const name = tab && tab.kind === "code" ? tab.path.slice(tab.path.lastIndexOf("/") + 1) : "";
    modals.openConfirmModal({
      title: t("Discard changes?"),
      centered: true,
      children: <Text size="sm">{t("“{name}” has unsaved changes.", { name })}</Text>,
      labels: { confirm: t("Discard"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => tabs.close(key),
    });
  }

  function openTerminalAt(cwd: string) {
    setTerminalRequest((prev) => ({ cwd, seq: (prev?.seq ?? 0) + 1 }));
    layout.showBottom("terminal");
  }

  return (
    <ProjectContext.Provider
      value={{
        project,
        gitStatuses: git.statuses,
        gitErrors: git.errors,
        refreshGit: git.refresh,
        processes,
        sessions,
        settings,
        account,
        openSettings: (section) => setSettingsSection(section ?? "accounts"),
        ui,
        selectedService,
        selectService: setSelectedService,
        revealService,
        openTerminalAt,
        activeTab,
        openChat,
        closeChat: (id) => tabs.closeWhere((tab) => tab.kind === "chat" && tab.sessionId === id),
        openFile,
        openWikiPage,
        wiki,
        runTarget,
        setRunTarget: (id) => {
          setSavedRunTarget(id);
          if (id) layout.showBottom("services");
        },
      }}
    >
      <div className={ide.window}>
        <ProjectTitleBar
          projectId={project.id}
          projectName={project.name}
          color={project.color}
          onSettings={() => setSettingsSection("accounts")}
          onSearch={() => setSearchMode("files")}
        />
        <ToolStripe
          top={topItems}
          bottom={bottomItems}
          activeTop={prefs.leftTools}
          activeBottom={prefs.bottom}
          onTop={layout.toggleLeft}
          onBottom={layout.toggleBottom}
        />
        <div className={ide.workspace}>
          <div className={ide.topRow}>
            {prefs.leftTools.length > 0 && (
              <div className={ide.leftColumn} style={{ width: prefs.leftWidth }}>
                {prefs.leftTools.map((tool, i) => {
                  const minimize = () => layout.toggleLeft(tool);
                  const isLast = i === prefs.leftTools.length - 1;
                  const height = prefs.leftHeights[tool] ?? LEFT_DEFAULT_HEIGHT[tool];
                  // Every tool keeps its own height except the bottom-most, which takes the rest.
                  const style = isLast ? { flex: 1, minHeight: 120 } : { height, flexShrink: 0, minHeight: 100 };
                  const island =
                    tool === "projects" ? <ProjectsTool onMinimize={minimize} style={style} /> : tool === "chats" ? <ChatsTool onMinimize={minimize} style={style} /> : <WikiTool onMinimize={minimize} style={style} />;
                  return (
                    <Fragment key={tool}>
                      {island}
                      {!isLast && (
                        <Splitter direction="vertical" value={height} min={100} max={window.innerHeight - 260} onChange={(h) => layout.resizeLeftTool(tool, h)} />
                      )}
                    </Fragment>
                  );
                })}
              </div>
            )}
            {prefs.leftTools.length > 0 && (
              <Splitter
                direction="horizontal"
                value={prefs.leftWidth}
                min={200}
                max={640}
                onChange={(leftWidth) => layout.resize({ leftWidth })}
              />
            )}
            <Island style={{ flex: 1 }}>
              <MainTabBar tabs={tabs.tabs} active={tabs.active} project={project} sessions={sessions} dirty={dirtyCode} onActivate={tabs.activate} onClose={closeTab} />
              {/* The chat stays mounted behind other tabs, so drafts and scroll survive switching. */}
              <div className={tabsCss.pane} style={{ display: activeTab?.kind === "chat" ? undefined : "none" }}>
                <Outlet />
              </div>
              {activeTab?.kind === "wiki" && (
                <div className={tabsCss.pane}>
                  <WikiPane path={activeTab.path} />
                </div>
              )}
              <CodeView hidden={activeTab?.kind !== "code"} file={activeTab?.kind === "code" ? activeTab : null} open={codeTabs} reveal={codeReveal} onDirtyChange={setDirtyCode} />
              {!activeTab && (
                <Center style={{ flex: 1 }}>
                  <Stack align="center" gap={6}>
                    <IconLayoutBoard size={40} stroke={1.2} color="var(--mantine-color-dimmed)" />
                    <Text size="sm" c="dimmed" ta="center" maw={360}>
                      {t("Open a chat, a wiki page or a file from the tools on the left.")}
                    </Text>
                  </Stack>
                </Center>
              )}
            </Island>
          </div>
          {prefs.bottom && (
            <Splitter
              direction="vertical"
              value={prefs.bottomHeight}
              min={120}
              max={window.innerHeight - 200}
              invert
              onChange={(bottomHeight) => layout.resize({ bottomHeight })}
            />
          )}
          <TerminalTool
            visible={prefs.bottom === "terminal"}
            request={terminalRequest}
            saved={ui.initial.terminals}
            onTabsChange={(terminals) => ui.save({ terminals })}
            onMinimize={() => layout.toggleBottom("terminal")}
            style={{ height: prefs.bottomHeight, flexShrink: 0 }}
          />
          {prefs.bottom === "services" && (
            <Island title={t("Services")} actions={<RunTargetPicker />} onMinimize={() => layout.toggleBottom("services")} style={{ height: prefs.bottomHeight, flexShrink: 0 }}>
              <ServicesTool />
            </Island>
          )}
        </div>
        <SearchEverywhere opened={searchMode} onClose={() => setSearchMode(null)} />
        <SettingsModal section={settingsSection} onSection={setSettingsSection} onClose={() => setSettingsSection(null)} />
        <StatusBar
          projectId={project.id}
          right={
            <>
              {running > 0 && <Text size="xs">{tn(running, "{count} service running", "{count} services running")}</Text>}
              <Text size="xs">{project.name}</Text>
            </>
          }
        />
      </div>
    </ProjectContext.Provider>
  );
}

/** Tabs to restore; windows saved before tabs existed reopen their files, wiki page and chat. */
function initialTabs(ui: ProjectUiState): TabsUiState {
  if (ui.tabs) return ui.tabs;
  const tabs: MainTab[] = [];
  if (ui.sessionId !== undefined) tabs.push({ kind: "chat", sessionId: ui.sessionId ?? null });
  if (ui.wiki?.open) tabs.push({ kind: "wiki", path: ui.wiki.open });
  for (const file of ui.code?.tabs ?? []) tabs.push({ kind: "code", repoId: file.repoId, path: file.path });
  return { tabs, active: tabs[0] ? tabKey(tabs[0]) : null };
}
