import { useState } from "react";
import { ActionIcon, CloseButton, Group, Select, Text, Textarea, Tooltip } from "@mantine/core";
import { IconArrowUp, IconFile, IconFileUpload, IconPaperclip, IconPlayerStopFilled } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useForm } from "react-hook-form";
import { modelLabel } from "../../api/sessions";
import { modelOptions } from "../../api/settings";
import { useProjectContext } from "../project/ProjectContext";
import { AccountLink } from "../settings/AccountLink";
import classes from "./sessions.module.css";
import { useFileDrop } from "./useFileDrop";

interface ComposerProps {
  placeholder: string;
  defaultModel: string | null;
  context?: string;
  busy?: boolean;
  autoFocus?: boolean;
  onSend: (prompt: string, model: string | null, attachments: string[]) => Promise<void>;
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
  const [attachments, setAttachments] = useState<string[]>([]);
  const dragging = useFileDrop(!blocked, addFiles);

  function addFiles(paths: string[]) {
    setAttachments((prev) => [...prev, ...paths.filter((p) => !prev.includes(p))]);
  }

  async function pickFiles() {
    const picked = await open({ multiple: true, directory: false, title: "Adjuntar documentos" });
    if (Array.isArray(picked)) addFiles(picked);
    else if (typeof picked === "string") addFiles([picked]);
  }

  async function submit(values: FormValues) {
    const prompt = values.prompt.trim();
    if ((!prompt && attachments.length === 0) || blocked) return;
    await onSend(prompt, values.model.trim() || null, attachments);
    reset({ prompt: "", model: "" });
    setAttachments([]);
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <div className={classes.composer} data-dragging={dragging || undefined}>
        {dragging && (
          <div className={classes.dropOverlay}>
            <IconFileUpload size={22} />
            <Text size="sm">Suelta los documentos para adjuntarlos</Text>
          </div>
        )}
        {attachments.length > 0 && (
          <Group gap={6} mb={6}>
            {attachments.map((path) => (
              <div key={path} className={classes.attachment} title={path}>
                <IconFile size={13} />
                <Text size="xs" truncate maw={180}>
                  {path.split(/[\\/]/).pop()}
                </Text>
                <CloseButton size="xs" onClick={() => setAttachments((prev) => prev.filter((p) => p !== path))} aria-label="Quitar adjunto" />
              </div>
            ))}
          </Group>
        )}
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
            <Tooltip label="Adjuntar documentos (o arrástralos aquí)" openDelay={300}>
              <ActionIcon variant="subtle" color="gray" onClick={pickFiles} disabled={blocked} aria-label="Adjuntar documentos">
                <IconPaperclip size={16} />
              </ActionIcon>
            </Tooltip>
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
