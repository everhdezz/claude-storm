import { useEffect, useRef, useState } from "react";
import { Center, Loader, Text } from "@mantine/core";
import { IconBook2, IconCode, IconFolder, IconMessageChatbot, IconMessages, IconPlayerPlay, IconTerminal2 } from "@tabler/icons-react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import { isActive } from "../../api/processes";
import { refreshRepoFrameworks } from "../../api/repos";
import { Island } from "../../components/ide/Island";
import { Splitter } from "../../components/ide/Splitter";
import { ToolStripe, type StripeItem } from "../../components/ide/ToolStripe";
import ide from "../../components/ide/ide.module.css";
import { ChatsTool } from "../chats/ChatsTool";
import { CodeView, type CodeFile } from "../code/CodeView";
import { useProcesses } from "../processes/useProcesses";
import { useSessions } from "../sessions/useSessions";
import { SettingsModal, type SettingsSection } from "../settings/SettingsModal";
import { useSettings } from "../settings/useSettings";
import { ProjectsTool } from "../projects-tool/ProjectsTool";
import { RunTargetPicker, ServicesTool } from "../services/ServicesTool";
import { StatusBar } from "../status/StatusBar";
import { TerminalTool } from "../terminal/TerminalTool";
import { WikiView } from "../wiki/WikiView";
import { ProjectContext } from "./ProjectContext";
import { ProjectTitleBar } from "./ProjectTitleBar";
import { useGitStatuses } from "./useGitStatuses";
import { type BottomTool, type LeftTool, type MainView, useLayoutPrefs } from "./useLayoutPrefs";
import { useProject } from "./useProject";
import { useUiState } from "./useUiState";
import type { Project } from "../../types";
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
  const restored = useRef(false);
  // The wiki mounts the first time it is shown and then stays mounted, keeping the open page.
  const [wikiOpened, setWikiOpened] = useState(layout.prefs.main === "wiki");
  if (layout.prefs.main === "wiki" && !wikiOpened) setWikiOpened(true);
  // Same for the code editor, so open tabs and unsaved edits survive switching views.
  const [codeOpened, setCodeOpened] = useState(layout.prefs.main === "code");
  if (layout.prefs.main === "code" && !codeOpened) setCodeOpened(true);
  const [fileRequest, setFileRequest] = useState<(CodeFile & { seq: number }) | null>(null);
  const [activeFile, setActiveFile] = useState<CodeFile | null>(null);
  // Reopening the last session on startup must not switch away from a remembered wiki view.
  const restoringPath = useRef(false);

  // Each time the project opens, the framework of every repo is detected again (ports and commands stay; a repo without commands gets the detected ones).
  useEffect(() => {
    refreshRepoFrameworks(project.id).catch((err) => console.warn("Could not refresh repo frameworks", err));
  }, [project.id]);

  useEffect(() => {
    if (restored.current) return;
    const wanted = ui.initial.sessionId;
    if (!wanted || sessionId) {
      restored.current = true;
      return;
    }
    if (sessions.some((s) => s.id === wanted)) {
      restored.current = true;
      restoringPath.current = true;
      navigate(`/project/${project.id}/session/${wanted}`, { replace: true });
    }
  }, [sessions, sessionId, navigate, project.id, ui.initial.sessionId]);

  useEffect(() => {
    if (restored.current) ui.save({ sessionId });
  }, [sessionId, ui]);

  // Opening a chat (from the Chats list or a notification) brings the chat back over the wiki.
  const { pathname } = useLocation();
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (restoringPath.current) restoringPath.current = false;
    else layout.showMain("chat");
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ui.save({ selectedService });
  }, [selectedService, ui]);

  useEffect(() => {
    ui.save({ runTarget: savedRunTarget });
  }, [savedRunTarget, ui]);

  const running = Object.values(processes).filter(isActive).length;
  // A target whose session was archived, deleted or lost its worktree falls back to the main checkout.
  const runTarget = sessions.some((s) => s.id === savedRunTarget && s.mode === "isolated" && !s.archived) ? savedRunTarget : null;
  const account = settings.accounts.find((a) => a.id === project.accountId) ?? null;
  const { prefs } = layout;
  const sessionsWorking = sessions.some((s) => s.status === "working");
  const topItems: StripeItem<LeftTool>[] = [
    { id: "projects", label: t("Projects"), icon: IconFolder },
    { id: "chats", label: "Chats", icon: IconMessages, badge: sessionsWorking },
  ];
  const bottomItems: StripeItem<BottomTool>[] = [
    { id: "terminal", label: "Terminal", icon: IconTerminal2 },
    { id: "services", label: t("Services"), icon: IconPlayerPlay, badge: running > 0 },
  ];

  const mainItems: StripeItem<MainView>[] = [
    { id: "chat", label: "Chat", icon: IconMessageChatbot, badge: sessionsWorking && prefs.main !== "chat" },
    { id: "wiki", label: "Wiki", icon: IconBook2 },
    { id: "code", label: t("Code"), icon: IconCode },
  ];

  function revealService(processId: string) {
    setSelectedService(processId);
    layout.showBottom("services");
  }

  function showChat() {
    layout.showMain("chat");
    // Wait for the chat island to be visible again; a hidden textarea cannot take focus.
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea[data-composer]")?.focus());
  }

  function openFile(repoId: string, path: string) {
    setFileRequest((prev) => ({ repoId, path, seq: (prev?.seq ?? 0) + 1 }));
    layout.showMain("code");
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
        mainView: prefs.main,
        showChat,
        openFile,
        activeFile,
        setActiveFile,
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
                {prefs.leftTools.includes("projects") && (
                  <ProjectsTool onMinimize={() => layout.toggleLeft("projects")} style={prefs.leftTools.length > 1 ? { height: prefs.leftTopHeight, flexShrink: 0 } : { flex: 1 }} />
                )}
                {prefs.leftTools.length > 1 && (
                  <Splitter
                    direction="vertical"
                    value={prefs.leftTopHeight}
                    min={120}
                    max={window.innerHeight - 260}
                    onChange={(leftTopHeight) => layout.resize({ leftTopHeight })}
                  />
                )}
                {prefs.leftTools.includes("chats") && <ChatsTool style={{ flex: 1 }} onMinimize={() => layout.toggleLeft("chats")} />}
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
            {/* Chat stays mounted while the wiki is shown, so drafts and scroll survive the switch. */}
            <Island style={{ flex: 1, display: prefs.main === "chat" ? undefined : "none" }}>
              <Outlet />
            </Island>
            {wikiOpened && <WikiView hidden={prefs.main !== "wiki"} />}
            {codeOpened && <CodeView hidden={prefs.main !== "code"} request={fileRequest} />}
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
        <ToolStripe side="right" top={mainItems} bottom={[]} activeTop={[prefs.main]} activeBottom={null} onTop={layout.showMain} onBottom={() => undefined} />
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
