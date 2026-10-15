import { useEffect, useState } from "react";
import { ActionIcon, Badge, Button, Group, Loader, Menu, PasswordInput, SegmentedControl, Select, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconChevronDown, IconKey, IconPencil, IconPlugConnected, IconPlus, IconRefresh, IconTrash, IconUserCircle } from "@tabler/icons-react";
import { Controller, useForm } from "react-hook-form";
import { modelLabel } from "../../api/sessions";
import {
  ACCOUNT_KIND_LABELS,
  createAccount,
  deleteAccount,
  modelOptions,
  profileStatus,
  resyncProfile,
  setProjectAccount,
  updateAccount,
} from "../../api/settings";
import { notifyError, notifySuccess } from "../../hooks/notify";
import type { ClaudeAccount } from "../../types";
import { useProjectContext } from "../project/ProjectContext";
import { LoginWizard } from "./LoginWizard";
import classes from "./settings.module.css";
import { t } from "../../i18n";

type Editing = { kind: "edit"; account: ClaudeAccount } | { kind: "newSimple" } | null;
type Wizard = { reconnect: ClaudeAccount | null } | null;

/** Claude accounts: subscription profiles (login wizard), API keys and this machine's login. */
export function AccountsSettings() {
  const { project, account: projectAccount, settings } = useProjectContext();
  const [editing, setEditing] = useState<Editing>(null);
  const [wizard, setWizard] = useState<Wizard>(null);

  function confirmDelete(account: ClaudeAccount) {
    modals.openConfirmModal({
      title: t("Delete “{account}”", { account: account.alias }),
      centered: true,
      children: (
        <Text size="sm">
          {account.kind === "profile"
            ? t("Claude Code will log this profile out and its folder will be deleted. Projects using it will be left without an account.")
            : t("Projects using it will be left without an account.")}
        </Text>
      ),
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => deleteAccount(account.id).catch((err) => notifyError(err)),
    });
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={4}>{t("Claude accounts")}</Title>
          <Text size="sm" c="dimmed">
            {t("Each subscription is an isolated profile where Claude Code performs and stores its own login; ClaudeStorm never sees those credentials.")}
          </Text>
        </div>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <Button size="xs" leftSection={<IconPlus size={14} />} rightSection={<IconChevronDown size={12} />}>
              {t("Add account")}
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconPlugConnected size={14} />} onClick={() => setWizard({ reconnect: null })}>
              {t("Claude subscription (log in)")}
            </Menu.Item>
            <Menu.Item leftSection={<IconKey size={14} />} onClick={() => setEditing({ kind: "newSimple" })}>
              {t("API key or this computer's login")}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      {settings.accounts.length === 0 && !editing && (
        <Text size="sm" c="dimmed">
          {t("No accounts yet.")}
        </Text>
      )}
      {settings.accounts.map((a) => (
        <div key={a.id} className={classes.accountRow}>
          <IconUserCircle size={22} stroke={1.4} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs">
              <Text fw={600}>{a.alias}</Text>
              {a.kind === "profile" && <ProfileBadge account={a} />}
              {a.id === projectAccount?.id && (
                <Badge size="xs" variant="light">
                  {t("used in {project}", { project: project.name })}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {ACCOUNT_KIND_LABELS[a.kind]}
              {a.loginEmail ? ` · ${a.loginEmail}` : ""}
              {a.tokenHint ? ` · ${a.tokenHint}` : ""}
              {a.defaultModel ? ` · ${modelLabel(a.defaultModel, settings.catalog)}` : ""}
            </Text>
          </div>
          {a.id !== projectAccount?.id && (
            <Button size="compact-xs" variant="light" onClick={() => setProjectAccount(project.id, a.id).catch((e) => notifyError(e))}>
              {t("Use in this project")}
            </Button>
          )}
          {a.kind === "profile" && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label={t("Profile actions")}>
                  <IconRefresh size={15} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconPlugConnected size={13} />} onClick={() => setWizard({ reconnect: a })}>
                  {t("Reconnect account")}
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconRefresh size={13} />}
                  onClick={() =>
                    resyncProfile(a.id)
                      .then((copied) => notifySuccess(copied.length ? t("Synced: {items}", { items: copied.join(", ") }) : t("There was no shared config")))
                      .catch((err) => notifyError(err))
                  }
                >
                  {t("Sync shared config")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
          <Tooltip label={t("Edit")}>
            <ActionIcon variant="subtle" color="gray" onClick={() => setEditing({ kind: "edit", account: a })} aria-label={t("Edit")}>
              <IconPencil size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Delete")}>
            <ActionIcon variant="subtle" color="red" onClick={() => confirmDelete(a)} aria-label={t("Delete")}>
              <IconTrash size={15} />
            </ActionIcon>
          </Tooltip>
        </div>
      ))}
      {editing && (
        <AccountForm
          key={editing.kind === "edit" ? editing.account.id : "new"}
          account={editing.kind === "edit" ? editing.account : null}
          onDone={() => setEditing(null)}
        />
      )}
      <LoginWizard
        opened={wizard !== null}
        reconnect={wizard?.reconnect ?? null}
        onClose={() => setWizard(null)}
        onCreated={(created) => !projectAccount && setProjectAccount(project.id, created.id).catch((e) => notifyError(e))}
      />
    </Stack>
  );
}

/** Live "connected / needs login" badge of a profile, checked with `claude auth status`. */
function ProfileBadge({ account }: { account: ClaudeAccount }) {
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    profileStatus(account.id)
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [account.id]);
  if (checking) return <Loader size={10} />;
  return account.needsLogin ? (
    <Badge size="xs" color="yellow" variant="light">
      {t("needs login")}
    </Badge>
  ) : (
    <Badge size="xs" color="teal" variant="light">
      {t("connected")}
    </Badge>
  );
}

interface FormValues {
  alias: string;
  kind: "apiKey" | "systemLogin";
  secret: string;
  defaultModel: string;
}

/** Form for API-key / this-machine accounts, and for editing alias and model of any account. */
function AccountForm({ account, onDone }: { account: ClaudeAccount | null; onDone: () => void }) {
  const { settings } = useProjectContext();
  const { register, control, handleSubmit, watch, formState } = useForm<FormValues>({
    defaultValues: {
      alias: account?.alias ?? "",
      kind: account?.kind === "apiKey" ? "apiKey" : "systemLogin",
      secret: "",
      defaultModel: account?.defaultModel ?? "",
    },
  });
  const kind = watch("kind");
  const showKey = account ? account.kind === "apiKey" : kind === "apiKey";

  async function submit(values: FormValues) {
    try {
      if (account) {
        await updateAccount(account.id, { alias: values.alias, secret: values.secret, defaultModel: values.defaultModel });
        notifySuccess(t("Account updated"));
      } else {
        const created = await createAccount({
          alias: values.alias,
          kind: values.kind,
          secret: values.kind === "apiKey" ? values.secret : null,
          defaultModel: values.defaultModel || null,
        });
        notifySuccess(t("Account “{account}” added", { account: created.alias }));
      }
      onDone();
    } catch (err) {
      notifyError(err, t("Could not save the account"));
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <Stack gap="sm" p="md" style={{ border: "1px solid var(--dh-island-border)", borderRadius: 8 }}>
        <Text fw={600} size="sm">
          {account ? t("Edit {account}", { account: account.alias }) : t("New account")}
        </Text>
        <TextInput
          label="Alias"
          placeholder={t("Work, Personal, Client X…")}
          data-autofocus
          error={formState.errors.alias?.message}
          {...register("alias", { validate: (v) => v.trim().length > 0 || t("Required") })}
        />
        {!account && (
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <SegmentedControl
                value={field.value}
                onChange={field.onChange}
                data={[
                  { value: "systemLogin", label: ACCOUNT_KIND_LABELS.systemLogin },
                  { value: "apiKey", label: ACCOUNT_KIND_LABELS.apiKey },
                ]}
              />
            )}
          />
        )}
        {showKey && (
          <PasswordInput
            label="API key"
            description={t("Stored in the system keychain and passed as ANTHROPIC_API_KEY (billed per token).")}
            placeholder={account ? t("Leave empty to keep {key}", { key: account.tokenHint ?? t("the current one") }) : "sk-ant-api…"}
            error={formState.errors.secret?.message}
            {...register("secret", { validate: (v) => !!account || v.trim().length > 0 || t("Required") })}
          />
        )}
        {!account && kind === "systemLogin" && (
          <Text size="xs" c="dimmed">
            {t("Uses the session you already logged into Claude Code with on this computer (~/.claude).")}
          </Text>
        )}
        <Controller
          control={control}
          name="defaultModel"
          render={({ field }) => (
            <Select
              label={t("This account's default model")}
              placeholder={t("The global one")}
              clearable
              data={modelOptions(settings.catalog)}
              value={field.value || null}
              onChange={(v) => field.onChange(v ?? "")}
            />
          )}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onDone}>
            {t("Cancel")}
          </Button>
          <Button type="submit" loading={formState.isSubmitting}>
            {account ? t("Save") : t("Add")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
