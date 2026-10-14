import { useState } from "react";
import { Button, Center, Group, ScrollArea, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconFolderPlus, IconFolderSearch } from "@tabler/icons-react";
import { useProjectContext } from "../project/ProjectContext";
import { EditRepoModal } from "../repos/EditRepoModal";
import { RepoCard } from "../repos/RepoCard";
import { RepoCommands } from "../repos/RepoCommands";
import { ScanReposModal } from "../repos/ScanReposModal";
import { useAddFolder } from "../repos/useAddRepos";
import type { Repo } from "../../types";
import classes from "../project/project.module.css";

/** Project overview: repo cards and widgets. */
export function DashboardPage() {
  const { project, gitStatuses, gitErrors, refreshGit } = useProjectContext();
  const [editing, setEditing] = useState<Repo | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const addFolder = useAddFolder(project.id);

  return (
    <>
      <div className={classes.pageHeader}>
        <Title order={4}>{project.name}</Title>
        <Group gap="xs">
          <Button size="xs" variant="default" leftSection={<IconFolderPlus size={14} />} onClick={addFolder}>
            Agregar carpeta
          </Button>
          <Button size="xs" variant="default" leftSection={<IconFolderSearch size={14} />} onClick={() => setScanOpen(true)}>
            Escanear
          </Button>
        </Group>
      </div>
      <ScrollArea className={classes.content} type="auto">
        <Stack p="lg" gap="lg">
          {project.repos.length === 0 ? (
            <Center py={80}>
              <Stack align="center" gap={6}>
                <Text fw={600}>Este proyecto no tiene repos</Text>
                <Text size="sm" c="dimmed">
                  Agrega una carpeta o escanea una carpeta padre para encontrar todos sus repos git.
                </Text>
              </Stack>
            </Center>
          ) : (
            <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
              {project.repos.map((repo) => (
                <RepoCard
                  key={repo.id}
                  projectId={project.id}
                  repo={repo}
                  status={gitStatuses[repo.id]}
                  gitError={gitErrors[repo.id]}
                  onRefresh={() => refreshGit(repo.id)}
                  onEdit={() => setEditing(repo)}
                >
                  <RepoCommands repo={repo} />
                </RepoCard>
              ))}
            </SimpleGrid>
          )}
        </Stack>
      </ScrollArea>
      <EditRepoModal projectId={project.id} repo={editing} onClose={() => setEditing(null)} />
      <ScanReposModal projectId={project.id} opened={scanOpen} onClose={() => setScanOpen(false)} />
    </>
  );
}
