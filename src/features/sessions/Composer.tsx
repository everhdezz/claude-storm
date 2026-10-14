import { ActionIcon, Autocomplete, Group, Text, Textarea, Tooltip } from "@mantine/core";
import { IconArrowUp, IconPlayerStopFilled } from "@tabler/icons-react";
import { useForm } from "react-hook-form";
import classes from "./sessions.module.css";
import { MODEL_OPTIONS, modelLabel } from "../../api/sessions";

interface ComposerProps {
  placeholder: string;
  defaultModel: string | null;
  context: string;
  busy?: boolean;
  autoFocus?: boolean;
  onSend: (prompt: string, model: string | null) => Promise<void>;
  onStop?: () => void;
}

interface FormValues {
  prompt: string;
  model: string;
}

/** Prompt box with per-prompt model override; Enter sends, Shift+Enter adds a line. */
export function Composer({ placeholder, defaultModel, context, busy = false, autoFocus, onSend, onStop }: ComposerProps) {
  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<FormValues>({
    defaultValues: { prompt: "", model: defaultModel ?? "" },
  });
  const model = watch("model");

  async function submit(values: FormValues) {
    const prompt = values.prompt.trim();
    if (!prompt) return;
    const override = values.model !== (defaultModel ?? "") ? values.model : null;
    await onSend(prompt, override);
    reset({ prompt: "", model: defaultModel ?? "" });
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <div className={classes.composer}>
        <Textarea
          variant="unstyled"
          autosize
          minRows={2}
          maxRows={12}
          placeholder={placeholder}
          autoFocus={autoFocus}
          {...register("prompt")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSubmit(submit)();
            }
          }}
        />
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Modelo solo para este mensaje (puedes escribir uno)" openDelay={400}>
              <Autocomplete
                size="xs"
                w={150}
                variant="filled"
                placeholder={modelLabel(defaultModel)}
                data={MODEL_OPTIONS.filter((m) => m.value).map((m) => m.value)}
                value={model}
                onChange={(v) => setValue("model", v)}
              />
            </Tooltip>
            <Text size="xs" c="dimmed" truncate>
              {context}
            </Text>
          </Group>
          {busy && onStop ? (
            <Tooltip label="Detener">
              <ActionIcon radius="xl" color="red" variant="filled" onClick={onStop} aria-label="Detener">
                <IconPlayerStopFilled size={14} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <ActionIcon type="submit" radius="xl" variant="filled" loading={formState.isSubmitting} aria-label="Enviar">
              <IconArrowUp size={16} />
            </ActionIcon>
          )}
        </Group>
      </div>
    </form>
  );
}
