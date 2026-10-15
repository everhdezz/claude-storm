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

type Editing = { kind: "edit"; account: ClaudeAccount } | { kind: "newSimple" } | null;
type Wizard = { reconnect: ClaudeAccount | null } | null;

/** Claude accounts: subscription profiles (login wizard), API keys and this machine's login. */
export function AccountsSettings() {
  const { project, account: projectAccount, settings } = useProjectContext();
  const [editing, setEditing] = useState<Editing>(null);
  const [wizard, setWizard] = useState<Wizard>(null);

  function confirmDelete(account: ClaudeAccount) {
    modals.openConfirmModal({
      title: `Eliminar «${account.alias}»`,
      centered: true,
      children: (
        <Text size="sm">
          {account.kind === "profile"
            ? "Claude Code cerrará la sesión de este perfil y se borrará su carpeta. Los proyectos que lo usen quedarán sin cuenta."
            : "Los proyectos que la usen quedarán sin cuenta."}
        </Text>
      ),
      labels: { confirm: "Eliminar", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: () => deleteAccount(account.id).catch((err) => notifyError(err)),
    });
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={4}>Cuentas de Claude</Title>
          <Text size="sm" c="dimmed">
            Cada suscripción es un perfil aislado donde Claude Code hace y guarda su propio login; claude-storm nunca ve esas credenciales.
          </Text>
        </div>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <Button size="xs" leftSection={<IconPlus size={14} />} rightSection={<IconChevronDown size={12} />}>
              Agregar cuenta
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconPlugConnected size={14} />} onClick={() => setWizard({ reconnect: null })}>
              Suscripción de Claude (iniciar sesión)
            </Menu.Item>
            <Menu.Item leftSection={<IconKey size={14} />} onClick={() => setEditing({ kind: "newSimple" })}>
              API key o login de este equipo
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      {settings.accounts.length === 0 && !editing && (
        <Text size="sm" c="dimmed">
          Aún no hay cuentas.
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
                  usada en {project.name}
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
              Usar en este proyecto
            </Button>
          )}
          {a.kind === "profile" && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label="Acciones del perfil">
                  <IconRefresh size={15} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconPlugConnected size={13} />} onClick={() => setWizard({ reconnect: a })}>
                  Reconectar cuenta
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconRefresh size={13} />}
                  onClick={() =>
                    resyncProfile(a.id)
                      .then((copied) => notifySuccess(copied.length ? `Sincronizado: ${copied.join(", ")}` : "No había config compartida"))
                      .catch((err) => notifyError(err))
                  }
                >
                  Sincronizar config compartida
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
          <Tooltip label="Editar">
            <ActionIcon variant="subtle" color="gray" onClick={() => setEditing({ kind: "edit", account: a })} aria-label="Editar">
              <IconPencil size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Eliminar">
            <ActionIcon variant="subtle" color="red" onClick={() => confirmDelete(a)} aria-label="Eliminar">
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
      requiere login
    </Badge>
  ) : (
    <Badge size="xs" color="teal" variant="light">
      conectada
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
        notifySuccess("Cuenta actualizada");
      } else {
        const created = await createAccount({
          alias: values.alias,
          kind: values.kind,
          secret: values.kind === "apiKey" ? values.secret : null,
          defaultModel: values.defaultModel || null,
        });
        notifySuccess(`Cuenta «${created.alias}» agregada`);
      }
      onDone();
    } catch (err) {
      notifyError(err, "No se pudo guardar la cuenta");
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <Stack gap="sm" p="md" style={{ border: "1px solid var(--dh-island-border)", borderRadius: 8 }}>
        <Text fw={600} size="sm">
          {account ? `Editar ${account.alias}` : "Nueva cuenta"}
        </Text>
        <TextInput
          label="Alias"
          placeholder="Trabajo, Personal, Cliente X…"
          data-autofocus
          error={formState.errors.alias?.message}
          {...register("alias", { validate: (v) => v.trim().length > 0 || "Obligatorio" })}
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
            description="Se guarda en el llavero del sistema y se inyecta como ANTHROPIC_API_KEY (cobro por token)."
            placeholder={account ? `Deja vacío para conservar ${account.tokenHint ?? "la actual"}` : "sk-ant-api…"}
            error={formState.errors.secret?.message}
            {...register("secret", { validate: (v) => !!account || v.trim().length > 0 || "Obligatorio" })}
          />
        )}
        {!account && kind === "systemLogin" && (
          <Text size="xs" c="dimmed">
            Usa la sesión con la que ya iniciaste Claude Code en este equipo (~/.claude).
          </Text>
        )}
        <Controller
          control={control}
          name="defaultModel"
          render={({ field }) => (
            <Select
              label="Modelo por defecto de esta cuenta"
              placeholder="El global"
              clearable
              data={modelOptions(settings.catalog)}
              value={field.value || null}
              onChange={(v) => field.onChange(v ?? "")}
            />
          )}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onDone}>
            Cancelar
          </Button>
          <Button type="submit" loading={formState.isSubmitting}>
            {account ? "Guardar" : "Agregar"}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
