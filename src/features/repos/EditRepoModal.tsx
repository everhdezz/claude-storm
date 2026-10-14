import { useEffect } from "react";
import { ActionIcon, Button, Checkbox, Group, Modal, NumberInput, Stack, Text, TextInput } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { updateRepo } from "../../api/repos";
import { notifyError } from "../../hooks/notify";
import type { Repo, RepoCommand } from "../../types";

interface EditRepoModalProps {
  projectId: string;
  repo: Repo | null;
  onClose: () => void;
}

interface FormValues {
  name: string;
  port: number | "";
  commands: RepoCommand[];
}

/** Form to edit a repo's name, port and command list. */
export function EditRepoModal({ projectId, repo, onClose }: EditRepoModalProps) {
  const { control, register, handleSubmit, reset, formState } = useForm<FormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "commands" });

  useEffect(() => {
    if (repo) reset({ name: repo.name, port: repo.port ?? "", commands: repo.commands });
  }, [repo, reset]);

  async function submit(values: FormValues) {
    if (!repo) return;
    try {
      await updateRepo(projectId, repo.id, {
        name: values.name,
        port: values.port === "" ? null : Number(values.port),
        commands: values.commands,
      });
      onClose();
    } catch (err) {
      notifyError(err, "No se pudo guardar");
    }
  }

  return (
    <Modal opened={repo !== null} onClose={onClose} title={`Editar ${repo?.name ?? ""}`} size="xl" centered>
      <form onSubmit={handleSubmit(submit)}>
        <Stack>
          <Group grow align="flex-start">
            <TextInput
              label="Nombre"
              error={formState.errors.name?.message}
              {...register("name", { validate: (v) => v.trim().length > 0 || "Obligatorio" })}
            />
            <Controller
              control={control}
              name="port"
              render={({ field }) => (
                <NumberInput
                  label="Puerto del server"
                  description="Se usa para avisar si está ocupado y para abrir el navegador"
                  min={1}
                  max={65535}
                  allowDecimal={false}
                  value={field.value}
                  onChange={(v) => field.onChange(v === "" ? "" : Number(v))}
                />
              )}
            />
          </Group>
          <div>
            <Text size="sm" fw={500} mb={6}>
              Comandos
            </Text>
            <Stack gap="xs">
              {fields.map((field, index) => (
                <Group key={field.id} wrap="nowrap" align="center">
                  <TextInput w={140} placeholder="Etiqueta" {...register(`commands.${index}.label`, { required: true })} />
                  <TextInput
                    style={{ flex: 1 }}
                    placeholder="pnpm dev"
                    ff="monospace"
                    {...register(`commands.${index}.command`)}
                  />
                  <Controller
                    control={control}
                    name={`commands.${index}.longRunning`}
                    render={({ field: f }) => (
                      <Checkbox label="Server" checked={f.value} onChange={(e) => f.onChange(e.currentTarget.checked)} />
                    )}
                  />
                  <ActionIcon variant="subtle" color="red" onClick={() => remove(index)} aria-label="Quitar comando">
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
              <Button
                variant="subtle"
                size="xs"
                leftSection={<IconPlus size={14} />}
                w="fit-content"
                onClick={() => append({ id: "", label: "", command: "", longRunning: false })}
              >
                Agregar comando
              </Button>
            </Stack>
          </div>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={formState.isSubmitting}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
