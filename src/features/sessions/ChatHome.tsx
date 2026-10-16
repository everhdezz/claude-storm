import { useState } from "react";
import { Loader, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { createSession, sendSessionPrompt } from "../../api/sessions";
import { notifyError } from "../../hooks/notify";
import { useProjectContext } from "../project/ProjectContext";
import { Composer } from "./Composer";
import classes from "./sessions.module.css";
import { t, tn } from "../../i18n";

/** Empty center island: "Chatea con la IA" — the first prompt opens a new session. */
export function ChatHome() {
  const { project, sessions } = useProjectContext();
  const navigate = useNavigate();
  const othersActive = sessions.some((s) => !s.archived && (s.status === "working" || s.status === "queued"));
  const [preparing, setPreparing] = useState(false);
  const [permissionMode, setPermissionMode] = useState("acceptEdits");

  async function start(prompt: string, model: string | null, attachments: string[]) {
    const noRepos = project.repos.length === 0;
    setPreparing(othersActive && !noRepos);
    try {
      const title = (prompt.split("\n")[0] || attachments[0]?.split(/[\\/]/).pop() || t("Documents")).slice(0, 60);
      const session = await createSession(project.id, {
        title,
        repoIds: project.repos.map((r) => r.id),
        model,
        permissionMode,
        mode: othersActive && !noRepos ? "isolated" : "direct",
      });
      await sendSessionPrompt(session.id, prompt, null, attachments);
      navigate(`/project/${project.id}/session/${session.id}`);
    } catch (err) {
      notifyError(err, t("Could not start the session"));
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <div className={classes.hero}>
        <ThemeIcon size={46} radius="xl" variant="light" color="orange">
          <IconSparkles size={24} />
        </ThemeIcon>
        <Title order={3} mt="sm">
          {t("Chat with AI")}
        </Title>
        <Text size="sm" c="dimmed" ta="center" maw={460}>
          {project.repos.length === 0
            ? t("Tell Claude what to do in {project}. It has no repos yet: Claude works in a scratch folder and can create repos and attach them to the project.", { project: project.name })
            : tn(project.repos.length, "Tell Claude what to do in {project}. A new Claude Code session opens on its repo.", "Tell Claude what to do in {project}. A new Claude Code session opens on its {count} repos.", { project: project.name })}
          {othersActive && project.repos.length > 0 ? ` ${t("It runs isolated because another session is already working.")}` : ""}
        </Text>
        {preparing && (
          <Group gap={6} mt="xs">
            <Loader size={12} />
            <Text size="xs" c="dimmed">
              {t("Creating the worktree and copying .env and dependencies…")}
            </Text>
          </Group>
        )}
      </div>
      <Stack className={classes.composerWrap} gap={4}>
        <Composer
          placeholder={t("Ask Claude something… (Enter to send, Shift+Enter for a new line)")}
          defaultModel={null}
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          autoFocus
          onSend={start}
        />
      </Stack>
    </>
  );
}
