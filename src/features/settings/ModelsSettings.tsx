import { useState } from "react";
import { Badge, Button, Group, Radio, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { refreshModelCatalog, setDefaultModel, setModelEnabled } from "../../api/settings";
import { notifyError, notifySuccess } from "../../hooks/notify";
import { relativeTime } from "../../utils/time";
import { useProjectContext } from "../project/ProjectContext";
import { t } from "../../i18n";

/** Models exposed by the installed Claude Code: enable/disable and pick the global default. */
export function ModelsSettings() {
  const { project, settings } = useProjectContext();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshModelCatalog(project.id);
      notifySuccess(t("Model list updated from Claude Code"));
    } catch (err) {
      notifyError(err, t("Could not read /model"));
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
          <Title order={4}>{t("Models")}</Title>
          <Text size="sm" c="dimmed">
            {t("The ones your Claude Code offers in /model. Disable the ones you do not want to see in pickers.")}
          </Text>
        </div>
        <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={refreshing} onClick={refresh}>
          {t("Refresh")}
        </Button>
      </Group>
      <Radio.Group value={settings.defaultModel ?? ""} onChange={(v) => setDefaultModel(v || null).catch((err) => notifyError(err))}>
        <Table verticalSpacing={6} highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={70}>{t("Enabled")}</Table.Th>
              <Table.Th>{t("Model")}</Table.Th>
              <Table.Th w={110}>{t("Default")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td />
              <Table.Td>
                <Text size="sm">{t("Claude Code decides")}</Text>
                <Text size="xs" c="dimmed">
                  {t("No --model flag is passed")}
                </Text>
              </Table.Td>
              <Table.Td>
                <Radio value="" aria-label={t("No default model")} />
              </Table.Td>
            </Table.Tr>
            {settings.catalog.map((m) => (
              <Table.Tr key={m.id} style={{ opacity: m.enabled ? 1 : 0.5 }}>
                <Table.Td>
                  <Switch size="xs" checked={m.enabled} onChange={(e) => toggle(m.id, e.currentTarget.checked)} aria-label={t("Enable {model}", { model: m.label })} />
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
                        {t("default")}
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">
                    {m.description}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Radio value={m.id} disabled={!m.enabled} aria-label={t("{model} as default", { model: m.label })} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Radio.Group>
      <Text size="xs" c="dimmed">
        {settings.catalogUpdatedAt
          ? t("Read from Claude Code {when}", { when: relativeTime(settings.catalogUpdatedAt) })
          : t("Initial list; it is read from Claude Code on startup")}{" "}
        · {t("refreshes itself once a day. Priority when sending: message model → session → account → default.")}
      </Text>
    </Stack>
  );
}
