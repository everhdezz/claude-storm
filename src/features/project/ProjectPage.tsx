import { useState } from "react";
import { Center, Loader, Text } from "@mantine/core";
import { IconFolder, IconMessages, IconPlayerPlay, IconTerminal2 } from "@tabler/icons-react";
import { Outlet, useParams } from "react-router";
import { isActive } from "../../api/processes";
import { Island } from "../../components/ide/Island";
import { Splitter } from "../../components/ide/Splitter";
import { ToolStripe, type StripeItem } from "../../components/ide/ToolStripe";
import ide from "../../components/ide/ide.module.css";
import { ChatsTool } from "../chats/ChatsTool";
import { useProcesses } from "../processes/useProcesses";
import { useSessions } from "../sessions/useSessions";
import { ProjectsTool } from "../projects-tool/ProjectsTool";
import { ServicesTool } from "../services/ServicesTool";
import { StatusBar } from "../status/StatusBar";
import { TerminalTool } from "../terminal/TerminalTool";
import { ProjectContext } from "./ProjectContext";
import { ProjectTitleBar } from "./ProjectTitleBar";
import { useGitStatuses } from "./useGitStatuses";
import { type BottomTool, type LeftTool, useLayoutPrefs } from "./useLayoutPrefs";
import { useProject } from "./useProject";

/** Root of a project window: JetBrains-style tool stripe, islands and status bar. */
export function ProjectPage() {
  const { projectId = "", sessionId = null } = useParams();
  const { project, error } = useProject(projectId);
  const git = useGitStatuses(project?.repos ?? []);
  const { processes } = useProcesses(projectId);
  const sessions = useSessions(projectId, sessionId);
  const layout = useLayoutPrefs();
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [terminalRequest, setTerminalRequest] = useState<{ cwd: string; seq: number } | null>(null);

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

  const running = Object.values(processes).filter(isActive).length;
  const { prefs } = layout;
  const sessionsWorking = sessions.some((s) => s.status === "working");
  const topItems: StripeItem<LeftTool>[] = [
    { id: "projects", label: "Proyectos", icon: IconFolder },
    { id: "chats", label: "Chats", icon: IconMessages, badge: sessionsWorking },
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
        selectedService,
        selectService: setSelectedService,
        revealService,
        openTerminalAt,
      }}
    >
      <div className={ide.window}>
        <ProjectTitleBar projectId={project.id} projectName={project.name} />
        <ToolStripe
          top={topItems}
          bottom={bottomItems}
          activeTop={prefs.left}
          activeBottom={prefs.bottom}
          onTop={layout.toggleLeft}
          onBottom={layout.toggleBottom}
        />
        <div className={ide.workspace}>
          <div className={ide.topRow}>
            {prefs.left === "projects" && <ProjectsTool style={{ width: prefs.leftWidth, flexShrink: 0 }} />}
            {prefs.left === "chats" && <ChatsTool style={{ width: prefs.leftWidth, flexShrink: 0 }} />}
            {prefs.left && (
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
            style={{ height: prefs.bottomHeight, flexShrink: 0 }}
          />
          {prefs.bottom === "services" && (
            <Island title="Servicios" style={{ height: prefs.bottomHeight, flexShrink: 0 }}>
              <ServicesTool />
            </Island>
          )}
        </div>
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
