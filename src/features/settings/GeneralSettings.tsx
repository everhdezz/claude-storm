import { useState } from "react";
import { Button, Group, NumberInput, SegmentedControl, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { setEditor, setLanguage, setMaxParallelSessions, setNotifications } from "../../api/settings";
import type { NotificationMode } from "../../types";
import { notifyError } from "../../hooks/notify";
import { useProjectContext } from "../project/ProjectContext";
import { detectLocale, LOCALES, t, type LanguagePref } from "../../i18n";

/** App-wide limits. */
export function GeneralSettings() {
  const { settings } = useProjectContext();
  const [editor, setEditorDraft] = useState(settings.editor);
  return (
    <Stack>
      <Title order={4}>{t("General")}</Title>
      <Select
        label={t("Language")}
        description={t("“Automatic” follows your system language and falls back to English. Changing it reloads the windows.")}
        w={360}
        allowDeselect={false}
        value={settings.language}
        onChange={(v) => v && v !== settings.language && setLanguage(v as LanguagePref).catch((err) => notifyError(err))}
        data={[
          { value: "auto", label: t("Automatic ({language})", { language: LOCALES[detectLocale("auto")] }) },
          ...Object.entries(LOCALES).map(([value, label]) => ({ value, label })),
        ]}
      />
      <NumberInput
        label={t("Claude sessions working at once")}
        description={t("Those over the limit wait in line.")}
        min={1}
        max={10}
        w={260}
        value={settings.maxParallelSessions}
        onChange={(v) => typeof v === "number" && setMaxParallelSessions(v).catch((err) => notifyError(err))}
      />
      <Text size="xs" c="dimmed">
        {t("Applies to every open project.")}
      </Text>
      <TextInput
        label="Editor"
        description={t("For “Open in editor”. On macOS it is the app name (WebStorm, Visual Studio Code, Cursor…); on other systems, the command.")}
        w={360}
        value={editor}
        onChange={(e) => setEditorDraft(e.currentTarget.value)}
        onBlur={() => editor.trim() !== settings.editor && setEditor(editor).catch((err) => notifyError(err))}
      />
      <div>
        <Text size="sm" fw={500}>
          {t("Notify me when a session finishes")}
        </Text>
        <Text size="xs" c="dimmed" mb={6}>
          {t("Notification with sound and a Dock badge. “In background” does not notify if you are already looking at that session.")}
        </Text>
        <Group gap="sm">
          <SegmentedControl
            size="xs"
            value={settings.notifications}
            onChange={(v) => setNotifications(v as NotificationMode).catch((err) => notifyError(err))}
            data={[
              { value: "background", label: t("In background") },
              { value: "always", label: t("Always") },
              { value: "off", label: t("Never") },
            ]}
          />
          <Button size="xs" variant="default" onClick={testNotification}>
            {t("Test")}
          </Button>
        </Group>
      </div>
    </Stack>
  );
}

/** Asks for permission if needed and shows a sample notification. */
async function testNotification() {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) {
      notifyError(t("macOS does not allow ClaudeStorm notifications. Turn them on in System Settings → Notifications."), t("No permission"));
      return;
    }
    sendNotification({ title: t("Finished: test session"), body: t("This is how you will be notified when Claude finishes."), sound: "Glass" });
  } catch (err) {
    notifyError(err, t("Could not notify"));
  }
}
