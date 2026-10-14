import { useEffect } from "react";
import { Alert, Autocomplete, Button, Checkbox, Group, Modal, SegmentedControl, Select, Stack, Text, TextInput } from "@mantine/core";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { createSession, MODEL_OPTIONS, PERMISSION_OPTIONS } from "../../api/sessions";
import { notifyError } from "../../hooks/notify";
import type { SessionMode } from "../../types";
import { useProjectContext } from "../project/ProjectContext";

interface FormValues {
  title: string;
  repoIds: string[];
  model: string;
  permissionMode: string;
  mode: SessionMode;
}

/** Quick form to open a new parallel session. */
export function NewSessionModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { project, sessions } = useProjectContext();
  const navigate = useNavigate();
  const othersActive = sessions.some((s) => !s.archived && ["working", "queued", "waiting", "done"].includes(s.status));
  const { control, register, handleSubmit, reset, watch, formState } = useForm<FormValues>();
  const mode = watch("mode");

  useEffect(() => {
    if (opened) {
      reset({
        title: "",
        repoIds: project.repos.map((r) => r.id),
        model: "",
        permissionMode: "acceptEdits",
        mode: othersActive ? "isolated" : "direct",
      });
    }
  }, [opened, project.repos, othersActive, reset]);

  async function submit(values: FormValues) {
    try {
      const session = await createSession(project.id, {
        title: values.title,
        repoIds: values.repoIds,
        model: values.model || null,
        permissionMode: values.permissionMode,
        mode: values.mode,
      });
      onClose();
      navigate(`/project/${project.id}/session/${session.id}`);
    } catch (err) {
      notifyError(err, "No se pudo crear la sesión");
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Nueva sesión" centered size="md">
      <form onSubmit={handleSubmit(submit)}>
        <Stack>
          <TextInput
            label="Título"
            placeholder="p. ej. Arreglar el checkout"
            data-autofocus
            error={formState.errors.title?.message}
            {...register("title", { validate: (v) => v.trim().length > 0 || "Obligatorio" })}
          />
          <Controller
            control={control}
            name="repoIds"
            rules={{ validate: (v) => v.length > 0 || "Elige al menos un repo" }}
            render={({ field, fieldState }) => (
              <Checkbox.Group label="Repos incluidos" value={field.value} onChange={field.onChange} error={fieldState.error?.message}>
                <Stack gap={6} mt={6}>
                  {project.repos.map((r) => (
                    <Checkbox key={r.id} value={r.id} label={r.name} />
                  ))}
                </Stack>
              </Checkbox.Group>
            )}
          />
          <Group grow align="flex-start">
            <Controller
              control={control}
              name="model"
              render={({ field }) => (
                <Autocomplete
                  label="Modelo"
                  description="Alias o nombre completo"
                  placeholder="Por defecto"
                  data={MODEL_OPTIONS.filter((m) => m.value).map((m) => m.value)}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              control={control}
              name="permissionMode"
              render={({ field }) => (
                <Select
                  label="Permisos"
                  description="--permission-mode"
                  data={PERMISSION_OPTIONS}
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? "acceptEdits")}
                  allowDeselect={false}
                />
              )}
            />
          </Group>
          <div>
            <Text size="sm" fw={500} mb={6}>
              Modo de trabajo
            </Text>
            <Controller
              control={control}
              name="mode"
              render={({ field }) => (
                <SegmentedControl
                  fullWidth
                  value={field.value}
                  onChange={(v) => field.onChange(v as SessionMode)}
                  data={[
                    { value: "direct", label: "Directo" },
                    { value: "isolated", label: "Aislado (git worktree)" },
                  ]}
                />
              )}
            />
            <Text size="xs" c="dimmed" mt={6}>
              {mode === "isolated"
                ? "Claude trabaja en una copia (worktree) con rama devhub/…; luego revisas el diff, haces commit y merge."
                : "Claude edita los repos tal cual están."}
            </Text>
          </div>
          {othersActive && mode === "direct" && (
            <Alert color="yellow" variant="light" p="xs">
              Ya hay otra sesión activa en este proyecto: se recomienda el modo aislado para no pisar cambios.
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={formState.isSubmitting}>
              Crear sesión
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
