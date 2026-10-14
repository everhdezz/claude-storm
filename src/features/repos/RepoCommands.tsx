import { Button, Group, Text } from "@mantine/core";
import type { Repo } from "../../types";

/** Buttons for each configured command of a repo. */
export function RepoCommands({ repo }: { repo: Repo }) {
  if (repo.commands.length === 0) {
    return <Text size="xs" c="dimmed">Sin comandos. Edítalo para agregar.</Text>;
  }
  return (
    <Group gap="xs">
      {repo.commands.map((c) => (
        <Button key={c.id} size="compact-sm" variant="default">
          {c.label}
        </Button>
      ))}
    </Group>
  );
}
