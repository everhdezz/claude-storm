import { ActionIcon, Button, Group, Radio, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useFieldArray, useForm } from "react-hook-form";
import { useEffect } from "react";
import { saveModels } from "../../api/settings";
import { notifyError, notifySuccess } from "../../hooks/notify";
import type { ModelOption } from "../../types";
import { useProjectContext } from "../project/ProjectContext";

interface FormValues {
  models: ModelOption[];
  defaultModel: string;
}

/** Editable list of models offered in every model picker, plus the global default. */
export function ModelsSettings() {
  const { settings } = useProjectContext();
  const { control, register, handleSubmit, reset, watch, setValue, formState } = useForm<FormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "models" });
  const defaultModel = watch("defaultModel");
  const models = watch("models") ?? [];

  useEffect(() => {
    reset({ models: settings.models, defaultModel: settings.defaultModel ?? "" });
  }, [settings.models, settings.defaultModel, reset]);

  async function submit(values: FormValues) {
    try {
      await saveModels(values.models, values.defaultModel || null);
      notifySuccess("Modelos guardados");
    } catch (err) {
      notifyError(err);
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <Stack>
        <div>
          <Title order={4}>Modelos</Title>
          <Text size="sm" c="dimmed">
            Se pasan tal cual a <code>claude --model</code>: puedes usar alias (fable, opus, sonnet, haiku) o nombres completos.
          </Text>
        </div>
        <Radio.Group value={defaultModel} onChange={(v) => setValue("defaultModel", v)}>
          <Stack gap="xs">
            <Radio value="" label="Sin modelo por defecto (lo decide Claude Code)" />
            {fields.map((field, index) => (
              <Group key={field.id} wrap="nowrap" gap="xs">
                <Radio value={models[index]?.value ?? ""} aria-label="Por defecto" />
                <TextInput
                  w={170}
                  placeholder="Etiqueta"
                  {...register(`models.${index}.label`)}
                />
                <TextInput style={{ flex: 1 }} ff="monospace" placeholder="alias o nombre completo" {...register(`models.${index}.value`)} />
                <ActionIcon variant="subtle" color="red" onClick={() => remove(index)} aria-label="Quitar modelo">
                  <IconTrash size={15} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        </Radio.Group>
        <Group justify="space-between">
          <Button variant="subtle" size="xs" leftSection={<IconPlus size={14} />} onClick={() => append({ value: "", label: "" })}>
            Agregar modelo
          </Button>
          <Button type="submit" loading={formState.isSubmitting}>
            Guardar
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          Orden de prioridad al enviar: modelo elegido en el mensaje → modelo de la sesión → modelo de la cuenta → modelo por defecto.
        </Text>
      </Stack>
    </form>
  );
}
