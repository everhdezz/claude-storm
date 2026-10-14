import { NumberInput, Stack, Text, Title } from "@mantine/core";
import { setMaxParallelSessions } from "../../api/settings";
import { notifyError } from "../../hooks/notify";
import { useProjectContext } from "../project/ProjectContext";

/** App-wide limits. */
export function GeneralSettings() {
  const { settings } = useProjectContext();
  return (
    <Stack>
      <Title order={4}>General</Title>
      <NumberInput
        label="Sesiones de Claude trabajando a la vez"
        description="Las que excedan el límite quedan en cola."
        min={1}
        max={10}
        w={260}
        value={settings.maxParallelSessions}
        onChange={(v) => typeof v === "number" && setMaxParallelSessions(v).catch((err) => notifyError(err))}
      />
      <Text size="xs" c="dimmed">
        Aplica a todos los proyectos abiertos.
      </Text>
    </Stack>
  );
}
