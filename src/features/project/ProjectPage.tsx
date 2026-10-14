import { useState } from "react";
import { Center, Loader, Text } from "@mantine/core";
import { Outlet, useParams } from "react-router";
import { LogsPanel } from "../processes/LogsPanel";
import { useProcesses } from "../processes/useProcesses";
import { ProjectContext } from "./ProjectContext";
import { ProjectSidebar } from "./ProjectSidebar";
import { useGitStatuses } from "./useGitStatuses";
import { useProject } from "./useProject";
import classes from "./project.module.css";

/** Root screen of a project window: sidebar, routed center area and bottom panels. */
export function ProjectPage() {
  const { projectId = "" } = useParams();
  const { project, error } = useProject(projectId);
  const git = useGitStatuses(project?.repos ?? []);
  const { processes, forget } = useProcesses(projectId);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [logsRepoId, setLogsRepoId] = useState<string | null>(null);
  const [focusProcessId, setFocusProcessId] = useState<string | null>(null);

  function showLogs(repoId: string, processId?: string) {
    setLogsRepoId(repoId);
    setFocusProcessId(processId ?? null);
    setLogsExpanded(true);
  }

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
  return (
    <ProjectContext.Provider
      value={{
        project,
        gitStatuses: git.statuses,
        gitErrors: git.errors,
        refreshGit: git.refresh,
        processes,
        showLogs,
      }}
    >
      <div className={classes.shell}>
        <ProjectSidebar />
        <div className={classes.center}>
          <div className={classes.routed}>
            <Outlet />
          </div>
          <LogsPanel
            repos={project.repos}
            processes={processes}
            activeRepoId={logsRepoId}
            focusProcessId={focusProcessId}
            expanded={logsExpanded}
            onToggle={() => setLogsExpanded((v) => !v)}
            onSelectRepo={setLogsRepoId}
            onForget={forget}
          />
        </div>
      </div>
    </ProjectContext.Provider>
  );
}
