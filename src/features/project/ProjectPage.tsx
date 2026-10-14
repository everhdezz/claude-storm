import { Center, Loader, Text, Title } from "@mantine/core";
import { useParams } from "react-router";
import { useProject } from "./useProject";

/** Root screen of a project window. */
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
  return (
    <Center h="100%">
      <Title order={2}>{project.name}</Title>
    </Center>
  );
}
