import { ActionIcon, Group, Select, Text, Textarea, Tooltip } from "@mantine/core";
import { IconArrowUp, IconPlayerStopFilled } from "@tabler/icons-react";
import { useForm } from "react-hook-form";
import { modelLabel } from "../../api/sessions";
import { modelOptions } from "../../api/settings";
import { useProjectContext } from "../project/ProjectContext";
import { AccountLink } from "../settings/AccountLink";
import classes from "./sessions.module.css";

interface ComposerProps {
  placeholder: string;
  defaultModel: string | null;
  context?: string;
  busy?: boolean;
  autoFocus?: boolean;
  onSend: (prompt: string, model: string | null) => Promise<void>;
  onStop?: () => void;
}

interface FormValues {
  prompt: string;
  model: string;
}

/** Prompt box with the project's account link and a per-prompt model override; Enter sends. */
export function Composer({ placeholder, defaultModel, context, busy = false, autoFocus, onSend, onStop }: ComposerProps) {
  const { account, settings } = useProjectContext();
  const effectiveDefault = defaultModel ?? account?.defaultModel ?? settings.defaultModel;
  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<FormValues>({
    defaultValues: { prompt: "", model: "" },
  });
  const model = watch("model");
  const blocked = !account;

  async function submit(values: FormValues) {
    const prompt = values.prompt.trim();
    if (!prompt || blocked) return;
    await onSend(prompt, values.model.trim() || null);
    reset({ prompt: "", model: "" });
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <div className={classes.composer}>
        <Textarea
          variant="unstyled"
          autosize
          minRows={2}
          maxRows={12}
          disabled={blocked}
          placeholder={blocked ? "Elige una cuenta de Claude para este proyecto antes de chatear." : placeholder}
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
          <Group gap="sm" wrap="nowrap" miw={0}>
            <Tooltip label="Modelo solo para este mensaje" openDelay={400}>
              <Select
                size="xs"
                w={150}
                variant="unstyled"
                clearable
                placeholder={modelLabel(effectiveDefault, settings.catalog)}
                data={modelOptions(settings.catalog)}
                value={model || null}
                onChange={(v) => setValue("model", v ?? "")}
                disabled={blocked}
                comboboxProps={{ withinPortal: true, width: 220, position: "top-start" }}
              />
            </Tooltip>
            {context && (
              <Text size="xs" c="dimmed" truncate>
                {context}
              </Text>
            )}
          </Group>
          {busy && onStop ? (
            <Tooltip label="Detener">
              <ActionIcon radius="xl" color="red" variant="filled" onClick={onStop} aria-label="Detener">
                <IconPlayerStopFilled size={14} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <ActionIcon type="submit" radius="xl" variant="filled" disabled={blocked} loading={formState.isSubmitting} aria-label="Enviar">
              <IconArrowUp size={16} />
            </ActionIcon>
          )}
        </Group>
      </div>
      <Group justify="flex-end" mt={6} px={4}>
        <AccountLink />
      </Group>
    </form>
  );
}
