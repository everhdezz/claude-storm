import { useEffect, useState } from "react";
import {
  ActionIcon,
  Button,
  Checkbox,
  Code,
  Group,
  Modal,
  NavLink,
  NumberInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconAdjustments, IconPlus, IconTerminal, IconTrash, IconWand } from "@tabler/icons-react";
import { Controller, useFieldArray, useForm, type Control, type UseFormRegister } from "react-hook-form";
import { redetectRepo, updateRepo } from "../../api/repos";
import { FrameworkIcon } from "../../components/FrameworkIcon";
import { notifyError, notifySuccess } from "../../hooks/notify";
import type { Framework, Repo, RepoCommand } from "../../types";
import classes from "../settings/settings.module.css";
import { t } from "../../i18n";

/** Sections of the repo dialog; add new ones here and render them in the content switch. */
export type RepoSection = "general" | "commands";

const SECTIONS: { id: RepoSection; label: string; icon: typeof IconAdjustments }[] = [
  { id: "general", label: t("General"), icon: IconAdjustments },
  { id: "commands", label: t("Commands"), icon: IconTerminal },
];

const FRAMEWORK_LABELS: Record<Framework, string> = {
  next: "Next.js",
  vite: "Vite",
  react: "React",
  expo: "Expo",
  laravel: "Laravel",
  node: "Node",
  generic: t("Generic"),
};

interface FormValues {
  name: string;
  port: number | "";
  commands: RepoCommand[];
}

interface RepoSettingsModalProps {
  projectId: string;
  /** Always the live repo from the project, so re-detection shows up right away. */
  repo: Repo | null;
  onClose: () => void;
}

/** Settings-style dialog for one repo: section list on the left, one shared form saved together. */
export function RepoSettingsModal({ projectId, repo, onClose }: RepoSettingsModalProps) {
  const [section, setSection] = useState<RepoSection>("general");
  const { control, register, handleSubmit, reset, formState } = useForm<FormValues>();
  const repoId = repo?.id;
  // Changes only when another repo opens or its stored values change (e.g. re-detection),
  // not on every project refresh, so unsaved edits are not wiped.
  const storedKey = repo ? JSON.stringify([repo.id, repo.name, repo.port, repo.commands]) : "";

  useEffect(() => {
    if (repo) reset({ name: repo.name, port: repo.port ?? "", commands: repo.commands });
  }, [storedKey]);

  useEffect(() => {
    if (repoId) setSection("general");
  }, [repoId]);

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
      notifyError(err, t("Could not save"));
    }
  }

  return (
    <Modal
      opened={repo !== null}
      onClose={onClose}
      title={
        <Group gap={8}>
          {repo && <FrameworkIcon framework={repo.framework} size={20} />}
          <Text fw={600}>{repo?.name}</Text>
        </Group>
      }
      size={880}
      centered
      padding={0}
      classNames={{ header: classes.header }}
    >
      {repo && (
        <form onSubmit={handleSubmit(submit)}>
          <div className={classes.layout}>
            <nav className={classes.nav}>
              {SECTIONS.map((s) => (
                <NavLink
                  key={s.id}
                  label={s.label}
                  leftSection={<s.icon size={16} stroke={1.6} />}
                  active={section === s.id}
                  onClick={() => setSection(s.id)}
                  variant="filled"
                  style={{ borderRadius: 6 }}
                />
              ))}
            </nav>
            <div className={classes.content}>
              {/* Every section stays mounted so unsaved edits survive switching sections. */}
              <div hidden={section !== "general"}>
                <GeneralSection projectId={projectId} repo={repo} control={control} register={register} error={formState.errors.name?.message} />
              </div>
              <div hidden={section !== "commands"}>
                <CommandsSection control={control} register={register} />
              </div>
            </div>
          </div>
          <Group justify="flex-end" p="md" style={{ borderTop: "1px solid var(--dh-island-border)" }}>
            <Button variant="default" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" loading={formState.isSubmitting}>
              {t("Save")}
            </Button>
          </Group>
        </form>
      )}
    </Modal>
  );
}

interface SectionProps {
  control: Control<FormValues>;
  register: UseFormRegister<FormValues>;
}

/** Name, port, location and framework detection. */
function GeneralSection({ projectId, repo, control, register, error }: SectionProps & { projectId: string; repo: Repo; error?: string }) {
  function confirmRedetect() {
    modals.openConfirmModal({
      title: t("Detect the framework again"),
      centered: true,
      children: <Text size="sm">{t("The framework, port and commands are replaced with the detected ones. Unsaved changes are lost.")}</Text>,
      labels: { confirm: t("Detect"), cancel: t("Cancel") },
      onConfirm: () =>
        redetectRepo(projectId, repo.id)
          .then(() => notifySuccess(t("Repo detected again")))
          .catch((err) => notifyError(err, t("Could not detect"))),
    });
  }

  return (
    <Stack>
      <Title order={4}>{t("General")}</Title>
      <Group grow align="flex-start">
        <TextInput label={t("Name")} error={error} {...register("name", { validate: (v) => v.trim().length > 0 || t("Required") })} />
        <Controller
          control={control}
          name="port"
          render={({ field }) => (
            <NumberInput
              label={t("Server port")}
              description={t("Used to warn when it is taken and to open the browser")}
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
        <Text size="sm" fw={500} mb={4}>
          {t("Folder")}
        </Text>
        <Code block>{repo.path}</Code>
      </div>
      <div className={classes.accountRow}>
        <FrameworkIcon framework={repo.framework} size={28} />
        <div style={{ flex: 1 }}>
          <Text size="sm" fw={500}>
            {FRAMEWORK_LABELS[repo.framework]}
          </Text>
          <Text size="xs" c="dimmed">
            {repo.packageManager ? t("Package manager: {manager}", { manager: repo.packageManager }) : t("No package manager detected")}
          </Text>
        </div>
        <Button variant="default" size="xs" leftSection={<IconWand size={14} />} onClick={confirmRedetect}>
          {t("Detect again")}
        </Button>
      </div>
    </Stack>
  );
}

/** Editable list of commands shown in Services and in the repo's Run menu. */
function CommandsSection({ control, register }: SectionProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "commands" });
  return (
    <Stack>
      <div>
        <Title order={4}>{t("Commands")}</Title>
        <Text size="xs" c="dimmed">
          {t("They show up in Services and in the repo menu. Check “Server” on the ones that keep running.")}
        </Text>
      </div>
      <Stack gap="xs">
        {fields.map((field, index) => (
          <Group key={field.id} wrap="nowrap" align="center">
            <TextInput w={130} placeholder={t("Label")} {...register(`commands.${index}.label`, { required: true })} />
            <TextInput style={{ flex: 1 }} placeholder="pnpm dev" ff="monospace" {...register(`commands.${index}.command`)} />
            <Controller
              control={control}
              name={`commands.${index}.longRunning`}
              render={({ field: f }) => <Checkbox label="Server" checked={f.value} onChange={(e) => f.onChange(e.currentTarget.checked)} />}
            />
            <ActionIcon variant="subtle" color="red" onClick={() => remove(index)} aria-label={t("Remove command")}>
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}
        {fields.length === 0 && (
          <Text size="sm" c="dimmed">
            {t("No commands. Add one or use “Detect again” in General.")}
          </Text>
        )}
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconPlus size={14} />}
          w="fit-content"
          onClick={() => append({ id: "", label: "", command: "", longRunning: false })}
        >
          {t("Add command")}
        </Button>
      </Stack>
    </Stack>
  );
}
