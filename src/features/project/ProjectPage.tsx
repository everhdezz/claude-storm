import { Center, Loader, Text } from "@mantine/core";
import { Outlet, useParams } from "react-router";
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
      value={{ project, gitStatuses: git.statuses, gitErrors: git.errors, refreshGit: git.refresh }}
    >
      <div className={classes.shell}>
        <ProjectSidebar />
        <div className={classes.center}>
          <Outlet />
        </div>
      </div>
    </ProjectContext.Provider>
  );
}
