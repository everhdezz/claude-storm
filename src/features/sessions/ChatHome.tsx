import { Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconSparkles } from "@tabler/icons-react";
import { useNavigate } from "react-router";
import { createSession, sendSessionPrompt } from "../../api/sessions";
import { notifyError } from "../../hooks/notify";
import { useProjectContext } from "../project/ProjectContext";
import { Composer } from "./Composer";
import classes from "./sessions.module.css";

/** Empty center island: "Chatea con la IA" — the first prompt opens a new session. */
export function ChatHome() {
  const { project, sessions } = useProjectContext();
  const navigate = useNavigate();
  const othersActive = sessions.some((s) => !s.archived && (s.status === "working" || s.status === "queued"));

  async function start(prompt: string, model: string | null) {
    if (project.repos.length === 0) {
      notifyError("Agrega al menos un repo al proyecto para chatear con Claude sobre él.", "Sin repos");
      return;
    }
    try {
      const title = prompt.split("\n")[0]!.slice(0, 60);
      const session = await createSession(project.id, {
        title,
        repoIds: project.repos.map((r) => r.id),
        model,
        mode: othersActive ? "isolated" : "direct",
      });
      await sendSessionPrompt(session.id, prompt);
      navigate(`/project/${project.id}/session/${session.id}`);
    } catch (err) {
      notifyError(err, "No se pudo iniciar la sesión");
    }
  }

  return (
    <>
      <div className={classes.hero}>
        <ThemeIcon size={46} radius="xl" variant="light" color="orange">
          <IconSparkles size={24} />
        </ThemeIcon>
        <Title order={3} mt="sm">
          Chatea con la IA
        </Title>
        <Text size="sm" c="dimmed" ta="center" maw={460}>
          Escribe qué quieres hacer en {project.name}. Se abre una sesión nueva de Claude Code sobre{" "}
          {project.repos.length === 1 ? "su repo" : `sus ${project.repos.length} repos`}
          {othersActive ? ", en modo aislado porque ya hay otra sesión trabajando" : ""}.
        </Text>
      </div>
      <Stack className={classes.composerWrap} gap={4}>
        <Composer
          placeholder="Pídele algo a Claude… (Enter para enviar, Shift+Enter para nueva línea)"
          defaultModel={null}
          context="Sesión nueva · login de Claude por defecto"
          autoFocus
          onSend={start}
        />
      </Stack>
    </>
  );
}
