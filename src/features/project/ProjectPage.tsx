import { useEffect, useRef, useState } from "react";
import { Center, Loader, Text } from "@mantine/core";
import { IconFolder, IconMessageCircle, IconPlayerPlay, IconTerminal2 } from "@tabler/icons-react";
import { Outlet, useNavigate, useParams } from "react-router";
import { isActive } from "../../api/processes";
import { Island } from "../../components/ide/Island";
import { Splitter } from "../../components/ide/Splitter";
import { ToolStripe, type StripeItem } from "../../components/ide/ToolStripe";
import ide from "../../components/ide/ide.module.css";
import { ChatsTool } from "../chats/ChatsTool";
import { useProcesses } from "../processes/useProcesses";
import { useSessions } from "../sessions/useSessions";
import { SettingsModal, type SettingsSection } from "../settings/SettingsModal";
import { useSettings } from "../settings/useSettings";
import { ProjectsTool } from "../projects-tool/ProjectsTool";
import { ServicesTool } from "../services/ServicesTool";
import { StatusBar } from "../status/StatusBar";
import { TerminalTool } from "../terminal/TerminalTool";
import { ProjectContext } from "./ProjectContext";
import { ProjectTitleBar } from "./ProjectTitleBar";
import { useGitStatuses } from "./useGitStatuses";
import { type BottomTool, type LeftTool, useLayoutPrefs } from "./useLayoutPrefs";
import { useProject } from "./useProject";
import { useUiState } from "./useUiState";
import type { Project } from "../../types";

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
  const sessions = useSessions(project.id, sessionId);
  const settings = useSettings();
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const layout = useLayoutPrefs(ui.initial.layout, (prefs) => ui.save({ layout: prefs }));
  const [selectedService, setSelectedService] = useState<string | null>(ui.initial.selectedService ?? null);
  const [terminalRequest, setTerminalRequest] = useState<{ cwd: string; seq: number } | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    const wanted = ui.initial.sessionId;
    if (!wanted || sessionId) {
      restored.current = true;
      return;
    }
    if (sessions.some((s) => s.id === wanted)) {
      restored.current = true;
      navigate(`/project/${project.id}/session/${wanted}`, { replace: true });
    }
  }, [sessions, sessionId, navigate, project.id, ui.initial.sessionId]);

  useEffect(() => {
    if (restored.current) ui.save({ sessionId });
  }, [sessionId, ui]);

  useEffect(() => {
    ui.save({ selectedService });
  }, [selectedService, ui]);

  const running = Object.values(processes).filter(isActive).length;
  const account = settings.accounts.find((a) => a.id === project.accountId) ?? null;
  const { prefs } = layout;
  const sessionsWorking = sessions.some((s) => s.status === "working");
  const topItems: StripeItem<LeftTool>[] = [
    { id: "projects", label: "Proyectos", icon: IconFolder },
    { id: "chats", label: "Chats", icon: IconMessageCircle, badge: sessionsWorking },
  ];
  const bottomItems: StripeItem<BottomTool>[] = [
    { id: "terminal", label: "Terminal", icon: IconTerminal2 },
    { id: "services", label: "Servicios", icon: IconPlayerPlay, badge: running > 0 },
  ];

  function revealService(processId: string) {
    setSelectedService(processId);
    layout.showBottom("services");
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
                  <ProjectsTool style={prefs.leftTools.length > 1 ? { height: prefs.leftTopHeight, flexShrink: 0 } : { flex: 1 }} />
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
                {prefs.leftTools.includes("chats") && <ChatsTool style={{ flex: 1 }} />}
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
              <Outlet />
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
            style={{ height: prefs.bottomHeight, flexShrink: 0 }}
          />
          {prefs.bottom === "services" && (
            <Island title="Servicios" style={{ height: prefs.bottomHeight, flexShrink: 0 }}>
              <ServicesTool />
            </Island>
          )}
        </div>
        <SettingsModal section={settingsSection} onSection={setSettingsSection} onClose={() => setSettingsSection(null)} />
        <StatusBar
          projectId={project.id}
          right={
            <>
              {running > 0 && <Text size="xs">{running} servicio(s) corriendo</Text>}
              <Text size="xs">{project.name}</Text>
            </>
          }
        />
      </div>
    </ProjectContext.Provider>
  );
}
