import { useState } from "react";
import { ActionIcon, Autocomplete, Badge, Button, Group, PasswordInput, SegmentedControl, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { Controller, useForm } from "react-hook-form";
import { ACCOUNT_KIND_LABELS, createAccount, deleteAccount, detectKind, setProjectAccount, updateAccount } from "../../api/settings";
import { notifyError, notifySuccess } from "../../hooks/notify";
import type { AccountKind, ClaudeAccount } from "../../types";
import { useProjectContext } from "../project/ProjectContext";
import classes from "./settings.module.css";

/** List of Claude accounts with add / edit / delete. */
export function AccountsSettings() {
  const { project, account: projectAccount, settings } = useProjectContext();
  const [editing, setEditing] = useState<ClaudeAccount | "new" | null>(settings.accounts.length === 0 ? "new" : null);

  function confirmDelete(account: ClaudeAccount) {
    modals.openConfirmModal({
      title: `Eliminar «${account.alias}»`,
      centered: true,
      children: <Text size="sm">Se borra la cuenta y su token del llavero. Los proyectos que la usen quedarán sin cuenta.</Text>,
      labels: { confirm: "Eliminar", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: () => deleteAccount(account.id).catch((err) => notifyError(err)),
    });
  }

  return (
    <Stack>
      <div>
        <Title order={4}>Cuentas de Claude</Title>
        <Text size="sm" c="dimmed">
          Cada proyecto elige una cuenta; sin cuenta no puede enviar mensajes. Los tokens se guardan en el llavero del sistema, nunca en
          disco.
        </Text>
      </div>
      {settings.accounts.map((a) => (
        <div key={a.id} className={classes.accountRow}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs">
              <Text fw={600}>{a.alias}</Text>
              {a.id === projectAccount?.id && (
                <Badge size="xs" variant="light">
                  usada en {project.name}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {ACCOUNT_KIND_LABELS[a.kind]}
              {a.tokenHint ? ` · ${a.tokenHint}` : ""}
              {a.defaultModel ? ` · modelo ${a.defaultModel}` : ""}
            </Text>
          </div>
          {a.id !== projectAccount?.id && (
            <Button size="compact-xs" variant="light" onClick={() => setProjectAccount(project.id, a.id).catch((e) => notifyError(e))}>
              Usar en este proyecto
            </Button>
          )}
          <Tooltip label="Editar">
            <ActionIcon variant="subtle" color="gray" onClick={() => setEditing(a)} aria-label="Editar">
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
      {editing ? (
        <AccountForm key={editing === "new" ? "new" : editing.id} account={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
      ) : (
        <Button variant="default" leftSection={<IconPlus size={14} />} w="fit-content" onClick={() => setEditing("new")}>
          Agregar cuenta
        </Button>
      )}
    </Stack>
  );
}

interface FormValues {
  alias: string;
  kind: AccountKind;
  secret: string;
  defaultModel: string;
}

/** Create/edit form; the token is never read back, only replaced. */
function AccountForm({ account, onDone }: { account: ClaudeAccount | null; onDone: () => void }) {
  const { project, account: projectAccount, settings } = useProjectContext();
  const { register, control, handleSubmit, watch, setValue, formState } = useForm<FormValues>({
    defaultValues: {
      alias: account?.alias ?? "",
      kind: account?.kind ?? "oauthToken",
      secret: "",
      defaultModel: account?.defaultModel ?? "",
    },
  });
  const kind = watch("kind");

  async function submit(values: FormValues) {
    try {
      if (account) {
        await updateAccount(account.id, { alias: values.alias, secret: values.secret, defaultModel: values.defaultModel });
        notifySuccess("Cuenta actualizada");
      } else {
        const created = await createAccount({
          alias: values.alias,
          kind: values.kind,
          secret: values.kind === "systemLogin" ? null : values.secret,
          defaultModel: values.defaultModel || null,
        });
        if (!projectAccount) await setProjectAccount(project.id, created.id);
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
                onChange={(v) => field.onChange(v as AccountKind)}
                data={[
                  { value: "oauthToken", label: ACCOUNT_KIND_LABELS.oauthToken },
                  { value: "apiKey", label: ACCOUNT_KIND_LABELS.apiKey },
                  { value: "systemLogin", label: ACCOUNT_KIND_LABELS.systemLogin },
                ]}
              />
            )}
          />
        )}
        {kind !== "systemLogin" && (
          <PasswordInput
            label={kind === "apiKey" ? "API key" : "Token"}
            description={
              kind === "apiKey"
                ? "Se inyecta como ANTHROPIC_API_KEY (cobro por token)."
                : "Genera uno con `claude setup-token` (requiere suscripción). Se inyecta como CLAUDE_CODE_OAUTH_TOKEN."
            }
            placeholder={account ? `Deja vacío para conservar ${account.tokenHint ?? "el actual"}` : "sk-ant-…"}
            error={formState.errors.secret?.message}
            {...register("secret", {
              validate: (v) => !!account || v.trim().length > 0 || "Obligatorio",
              onChange: (e) => {
                const detected = detectKind(e.target.value);
                if (detected && !account) setValue("kind", detected);
              },
            })}
          />
        )}
        {kind === "systemLogin" && (
          <Text size="xs" c="dimmed">
            Usa la sesión con la que ya iniciaste Claude Code en este equipo (sin token). Útil para tu cuenta principal.
          </Text>
        )}
        <Controller
          control={control}
          name="defaultModel"
          render={({ field }) => (
            <Autocomplete
              label="Modelo por defecto de esta cuenta"
              placeholder="El global"
              data={settings.models.map((m) => m.value)}
              value={field.value}
              onChange={field.onChange}
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
