import { ColorInput, Group, Stack, Text, Title, Tooltip, UnstyledButton } from "@mantine/core";
import { setProjectColor } from "../../api/settings";
import { notifyError } from "../../hooks/notify";
import { useProjectContext } from "../project/ProjectContext";
import classes from "./settings.module.css";
import { t } from "../../i18n";

export const HEADER_COLORS = ["#4b6eaf", "#4f9a6b", "#8a5cc7", "#b3863b", "#3d8fa6", "#b2505c", "#6a8f3a", "#5b62c7", "#a0527f", "#7a7f8c"];

/** Header color of the current project, like WebStorm's project color. */
export function AppearanceSettings() {
  const { project } = useProjectContext();

  function choose(color: string | null) {
    setProjectColor(project.id, color).catch((err) => notifyError(err));
  }

  return (
    <Stack>
      <div>
        <Title order={4}>{t("Appearance")}</Title>
        <Text size="sm" c="dimmed">
          {t("Header color of “{project}”. Helps tell each project's windows apart, like in WebStorm.", { project: project.name })}
        </Text>
      </div>
      <Group gap="xs">
        <Tooltip label={t("No color")}>
          <UnstyledButton
            className={classes.swatch}
            data-active={!project.color || undefined}
            style={{ background: "var(--dh-window-bg)", outline: "1px dashed var(--mantine-color-dark-3)" }}
            onClick={() => choose(null)}
          />
        </Tooltip>
        {HEADER_COLORS.map((c) => (
          <UnstyledButton key={c} className={classes.swatch} data-active={project.color === c || undefined} style={{ background: c }} onClick={() => choose(c)} />
        ))}
      </Group>
      <ColorInput label={t("Custom color")} w={220} value={project.color ?? ""} onChangeEnd={(v) => choose(v || null)} format="hex" />
    </Stack>
  );
}
