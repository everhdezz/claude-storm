import { useState } from "react";
import { Badge, Button, Group, Radio, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { refreshModelCatalog, setDefaultModel, setModelEnabled } from "../../api/settings";
import { notifyError, notifySuccess } from "../../hooks/notify";
import { relativeTime } from "../../utils/time";
import { useProjectContext } from "../project/ProjectContext";

/** Models exposed by the installed Claude Code: enable/disable and pick the global default. */
export function ModelsSettings() {
  const { project, settings } = useProjectContext();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshModelCatalog(project.id);
      notifySuccess("Lista de modelos actualizada desde Claude Code");
    } catch (err) {
      notifyError(err, "No se pudo leer /model");
    } finally {
      setRefreshing(false);
    }
  }

  function toggle(id: string, enabled: boolean) {
    setModelEnabled(id, enabled).catch((err) => notifyError(err));
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={4}>Modelos</Title>
          <Text size="sm" c="dimmed">
            Los que expone tu Claude Code en <code>/model</code>. Deshabilita los que no quieras ver en los selectores.
          </Text>
        </div>
        <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={refreshing} onClick={refresh}>
          Actualizar
        </Button>
      </Group>
      <Radio.Group value={settings.defaultModel ?? ""} onChange={(v) => setDefaultModel(v || null).catch((err) => notifyError(err))}>
        <Table verticalSpacing={6} highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={70}>Activo</Table.Th>
              <Table.Th>Modelo</Table.Th>
              <Table.Th w={110}>Por defecto</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td />
              <Table.Td>
                <Text size="sm">Lo decide Claude Code</Text>
                <Text size="xs" c="dimmed">
                  No se pasa <code>--model</code>
                </Text>
              </Table.Td>
              <Table.Td>
                <Radio value="" aria-label="Sin modelo por defecto" />
              </Table.Td>
            </Table.Tr>
            {settings.catalog.map((m) => (
              <Table.Tr key={m.id} style={{ opacity: m.enabled ? 1 : 0.5 }}>
                <Table.Td>
                  <Switch size="xs" checked={m.enabled} onChange={(e) => toggle(m.id, e.currentTarget.checked)} aria-label={`Activar ${m.label}`} />
                </Table.Td>
                <Table.Td>
                  <Group gap={8}>
                    <Text size="sm" fw={500}>
                      {m.label}
                    </Text>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {m.id}
                    </Text>
                    {settings.defaultModel === m.id && (
                      <Badge size="xs" variant="light">
                        por defecto
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">
                    {m.description}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Radio value={m.id} disabled={!m.enabled} aria-label={`${m.label} por defecto`} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Radio.Group>
      <Text size="xs" c="dimmed">
        {settings.catalogUpdatedAt ? `Leído de Claude Code ${relativeTime(settings.catalogUpdatedAt)}` : "Lista inicial; se lee de Claude Code al arrancar"} · se
        actualiza sola una vez al día. Prioridad al enviar: modelo del mensaje → de la sesión → de la cuenta → por defecto.
      </Text>
    </Stack>
  );
}
