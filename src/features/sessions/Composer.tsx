import { useEffect, useState } from "react";
import { ActionIcon, CloseButton, Group, Loader, Menu, Text, Textarea, Tooltip, UnstyledButton } from "@mantine/core";
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconCpu,
  IconFile,
  IconFileUpload,
  IconPaperclip,
  IconPhoto,
  IconPlayerStopFilled,
  IconPlayerTrackNextFilled,
} from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useForm } from "react-hook-form";
import { modelLabel, PERMISSION_OPTIONS, savePastedFile } from "../../api/sessions";
import { notifyError } from "../../hooks/notify";
import { modelOptions } from "../../api/settings";
import { useProjectContext } from "../project/ProjectContext";
import { AccountLink } from "../settings/AccountLink";
import classes from "./sessions.module.css";
import { useFileDrop } from "./useFileDrop";
import { t } from "../../i18n";

interface ComposerProps {
  placeholder: string;
  defaultModel: string | null;
  /** Claude Code permission mode; shown next to the model and cycled with Shift+Tab. */
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  busy?: boolean;
  autoFocus?: boolean;
  onSend: (prompt: string, model: string | null, attachments: string[]) => Promise<void>;
  onStop?: () => void;
  /** Puts text back in the box (e.g. a queued message being edited); `seq` changes on every request. */
  injected?: { text: string; seq: number } | null;
}

interface FormValues {
  prompt: string;
  model: string;
}

/** Prompt box with the project's account link and a per-prompt model override; Enter sends. */
export function Composer({ placeholder, defaultModel, permissionMode, onPermissionModeChange, busy = false, autoFocus, onSend, onStop, injected }: ComposerProps) {
  const { account, settings } = useProjectContext();
  const effectiveDefault = defaultModel ?? account?.defaultModel ?? settings.defaultModel;
  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<FormValues>({
    defaultValues: { prompt: "", model: "" },
  });
  const model = watch("model");
  const blocked = !account;
  const [attachments, setAttachments] = useState<string[]>([]);
  const dragging = useFileDrop(!blocked, addFiles);
  const [pasting, setPasting] = useState(0);

  useEffect(() => {
    if (injected) setValue("prompt", injected.text);
  }, [injected, setValue]);

  function addFiles(paths: string[]) {
    setAttachments((prev) => [...prev, ...paths.filter((p) => !prev.includes(p))]);
  }

  /** Attaches files from the clipboard (Finder copies, screenshots); plain text pastes normally. */
  async function onPaste(e: React.ClipboardEvent) {
    if (blocked) return;
    const data = e.clipboardData;
    const fileUrls = data
      .getData("text/uri-list")
      .split(/\r?\n/)
      .filter((l) => l.startsWith("file://"));
    const files = Array.from(data.files);
    // Office apps put a rendered "image.png" next to copied text; then the text is what was meant.
    const onlyRendering = files.length > 0 && files.every((f) => /^image\.\w+$/.test(f.name)) && data.getData("text/plain").trim() !== "";
    if (fileUrls.length === 0 && (files.length === 0 || onlyRendering)) return;
    e.preventDefault();
    if (fileUrls.length > 0) {
      addFiles(fileUrls.map((u) => decodeURIComponent(new URL(u).pathname)));
      return;
    }
    setPasting((n) => n + files.length);
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
    for (const [i, file] of files.entries()) {
      // Screenshots arrive as "image.png"; give them a readable, unique name.
      const name = /^image\.\w+$/.test(file.name) ? `${t("screenshot")}-${stamp}${files.length > 1 ? `-${i + 1}` : ""}.${file.name.split(".").pop()}` : file.name;
      try {
        addFiles([await savePastedFile(file, name)]);
      } catch (err) {
        notifyError(err, t("Could not paste {name}", { name }));
      } finally {
        setPasting((n) => n - 1);
      }
    }
  }

  async function pickFiles() {
    const picked = await open({ multiple: true, directory: false, title: t("Attach documents") });
    if (Array.isArray(picked)) addFiles(picked);
    else if (typeof picked === "string") addFiles([picked]);
  }

  async function submit(values: FormValues) {
    const prompt = values.prompt.trim();
    if ((!prompt && attachments.length === 0) || blocked || pasting > 0) return;
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
            <Text size="sm">{t("Drop the documents to attach them")}</Text>
          </div>
        )}
        {(attachments.length > 0 || pasting > 0) && (
          <Group gap={6} mb={6}>
            {attachments.map((path) => (
              <div key={path} className={classes.attachment} title={path}>
                {/\.(png|jpe?g|gif|webp|heic|tiff?)$/i.test(path) ? <IconPhoto size={13} /> : <IconFile size={13} />}
                <Text size="xs" truncate maw={180}>
                  {path.split(/[\\/]/).pop()}
                </Text>
                <CloseButton size="xs" onClick={() => setAttachments((prev) => prev.filter((p) => p !== path))} aria-label={t("Remove attachment")} />
              </div>
            ))}
            {pasting > 0 && (
              <div className={classes.attachment}>
                <Loader size={10} />
                <Text size="xs">{t("Pasting…")}</Text>
              </div>
            )}
          </Group>
        )}
        <Textarea
          variant="unstyled"
          autosize
          minRows={2}
          maxRows={12}
          disabled={blocked}
          placeholder={blocked ? t("Pick a Claude account for this project before chatting.") : placeholder}
          autoFocus={autoFocus}
          {...register("prompt")}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Tab" && e.shiftKey) {
              e.preventDefault();
              onPermissionModeChange(nextPermissionMode(permissionMode));
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSubmit(submit)();
            }
          }}
        />
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" miw={0}>
            <Tooltip label={t("Attach documents (or drag or paste them here)")} openDelay={300}>
              <ActionIcon variant="subtle" color="gray" onClick={pickFiles} disabled={blocked} aria-label={t("Attach documents")}>
                <IconPaperclip size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Group gap={6} wrap="nowrap">
            {busy && onStop && (
              <Tooltip label={t("Stop")}>
                <ActionIcon radius="xl" color="red" variant="filled" onClick={onStop} aria-label={t("Stop")}>
                  <IconPlayerStopFilled size={14} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label={busy ? t("Queue: sent when Claude finishes") : t("Send")} disabled={!busy}>
              <ActionIcon
                type="submit"
                radius="xl"
                variant={busy ? "light" : "filled"}
                disabled={blocked || pasting > 0}
                loading={formState.isSubmitting}
                aria-label={busy ? t("Queue") : t("Send")}
              >
                <IconArrowUp size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </div>
      <Group gap={4} mt={6} px={4} wrap="nowrap">
        <ModelPicker
          value={model || null}
          defaultLabel={modelLabel(effectiveDefault, settings.catalog)}
          options={modelOptions(settings.catalog)}
          disabled={blocked}
          onChange={(v) => setValue("model", v ?? "")}
        />
        <PermissionPicker value={permissionMode} disabled={blocked} onChange={onPermissionModeChange} />
        <div style={{ flex: 1 }} />
        <AccountLink />
      </Group>
    </form>
  );
}

interface ModelPickerProps {
  value: string | null;
  defaultLabel: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string | null) => void;
}

/** Dropdown to override the model for the next message; "Por defecto" follows the account/app default. */
function ModelPicker({ value, defaultLabel, options, disabled, onChange }: ModelPickerProps) {
  const current = options.find((o) => o.value === value);
  const check = (on: boolean) => (on ? <IconCheck size={14} /> : <span style={{ width: 14 }} />);
  return (
    <Menu position="top-start" withinPortal shadow="md" width={240}>
      <Menu.Target>
        <UnstyledButton className={classes.modelPicker} disabled={disabled} aria-label={t("Model for this message")}>
          <IconCpu size={14} />
          <Text size="xs" fw={current ? 600 : 400} c={current ? "gray.2" : undefined}>
            {current ? current.label : defaultLabel}
          </Text>
          <IconChevronDown size={12} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t("Model for this message")}</Menu.Label>
        <Menu.Item leftSection={check(!current)} onClick={() => onChange(null)} rightSection={<Text size="xs" c="dimmed">{defaultLabel}</Text>}>
          {t("Default")}
        </Menu.Item>
        <Menu.Divider />
        {options.map((o) => (
          <Menu.Item key={o.value} leftSection={check(o.value === value)} onClick={() => onChange(o.value)}>
            {o.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/** The mode after `mode` in Claude Code's Shift+Tab cycle. */
function nextPermissionMode(mode: string): string {
  const i = PERMISSION_OPTIONS.findIndex((o) => o.value === mode);
  return PERMISSION_OPTIONS[(i + 1) % PERMISSION_OPTIONS.length]?.value ?? mode;
}

interface PermissionPickerProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

/** "⏵⏵ Auto mode on"-style switch for the session's permission mode, like Claude Code's footer. */
function PermissionPicker({ value, disabled, onChange }: PermissionPickerProps) {
  const current = PERMISSION_OPTIONS.find((o) => o.value === value) ?? { value, label: value, description: "", color: "gray" };
  const check = (on: boolean) => (on ? <IconCheck size={14} /> : <span style={{ width: 14 }} />);
  return (
    <Menu position="top-start" withinPortal shadow="md" width={300}>
      <Menu.Target>
        <Tooltip label={t("Permission mode (Shift+Tab to switch)")} openDelay={400}>
          <UnstyledButton className={classes.modelPicker} disabled={disabled} aria-label={t("Permission mode")}>
            <IconPlayerTrackNextFilled size={12} color={`var(--mantine-color-${current.color}-4)`} />
            <Text size="xs" fw={600} c={`${current.color}.4`}>
              {t("{mode} on", { mode: current.label })}
            </Text>
            <IconChevronDown size={12} />
          </UnstyledButton>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t("Permission mode · applies from the next message")}</Menu.Label>
        {PERMISSION_OPTIONS.map((o) => (
          <Menu.Item key={o.value} leftSection={check(o.value === current.value)} onClick={() => onChange(o.value)}>
            <Text size="sm" c={`${o.color}.4`} fw={600}>
              {o.label}
            </Text>
            <Text size="xs" c="dimmed">
              {o.description}
            </Text>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
