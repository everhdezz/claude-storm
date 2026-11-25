import { useState } from "react";
import { Stack, Text, ThemeIcon, Title } from "@mantine/core";
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
  const { project, account } = useProjectContext();
  const navigate = useNavigate();
  const [permissionMode, setPermissionMode] = useState("acceptEdits");
  const [model, setModel] = useState<string | null>(null);

  async function start(prompt: string, model: string | null, attachments: string[]) {
    const noRepos = project.repos.length === 0;
    try {
      const title = (prompt.split("\n")[0] || attachments[0]?.split(/[\\/]/).pop() || t("Documents")).slice(0, 60);
      const session = await createSession(project.id, {
        title,
        repoIds: project.repos.map((r) => r.id),
        model,
        permissionMode,
        // Starts read-only; it gets a folder (main checkout or worktree) once it is asked to change code.
        mode: noRepos ? "direct" : "consult",
        accountId: account?.id ?? null,
      });
      await sendSessionPrompt(session.id, prompt, null, attachments);
      navigate(`/project/${project.id}/session/${session.id}`);
      return true;
    } catch (err) {
      notifyError(err, t("Could not start the session"));
      return false;
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
          {project.repos.length > 0
            ? ` ${t("It starts in consult mode: no worktree is created until you ask for code changes.")}`
            : ""}
        </Text>
      </div>
      <Stack className={classes.composerWrap} gap={4}>
        <Composer
          placeholder={t("Ask Claude something…")}
          draftKey={`${project.id}:new`}
          model={model}
          onModelChange={setModel}
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          autoFocus
          onSend={start}
        />
      </Stack>
    </>
  );
}
