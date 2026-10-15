import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  Code,
  Collapse,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { IconBrowser, IconCheck, IconCopy, IconExternalLink } from "@tabler/icons-react";
import { useForm } from "react-hook-form";
import {
  accountUsage,
  cancelProfileLogin,
  createProfileAccount,
  LOGIN_PROGRESS,
  modelOptions,
  prepareProfile,
  reopenLoginUrl,
  startProfileLogin,
  submitLoginCode,
  verifyProfile,
} from "../../api/settings";
import type { UsageSnapshot } from "../../api/usage";
import { modelLabel } from "../../api/sessions";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import type { ClaudeAccount, LoginProgress, ProfileCheck } from "../../types";
import { useProjectContext } from "../project/ProjectContext";
import { timeUntil } from "../status/useClaudeUsage";
import { WizardSteps } from "./WizardSteps";

type Step = "data" | "prepare" | "authorize" | "verify" | "done";
const STEP_INDEX: Record<Step, number> = { data: 0, prepare: 1, authorize: 2, verify: 4, done: 5 };

interface Failure {
  message: string;
  details: string | null;
}

interface LoginWizardProps {
  opened: boolean;
  reconnect: ClaudeAccount | null;
  onClose: () => void;
  onCreated: (account: ClaudeAccount) => void;
}

/** Visual wizard: Claude Code logs in inside a hidden PTY; DevHub only relays URL and code. */
export function LoginWizard({ opened, reconnect, onClose, onCreated }: LoginWizardProps) {
  const { settings } = useProjectContext();
  const [step, setStep] = useState<Step>("data");
  const [account, setAccount] = useState<ClaudeAccount | null>(null);
  const [synced, setSynced] = useState<string[]>([]);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [browserOpened, setBrowserOpened] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [check, setCheck] = useState<ProfileCheck | null>(null);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const loginRef = useRef<string | null>(null);
  const { register, handleSubmit, reset, setValue, watch, formState } = useForm<{ alias: string; defaultModel: string }>();

  useEffect(() => {
    if (!opened) return;
    setFailure(null);
    setCheck(null);
    setUsage(null);
    setCodeOpen(false);
    setCode("");
    setCodeError(null);
    setBrowserOpened(false);
    setManualUrl(null);
    reset({ alias: "", defaultModel: "" });
    if (reconnect) {
      setAccount(reconnect);
      setStep("authorize");
      startLogin(reconnect);
    } else {
      setAccount(null);
      setStep("data");
    }
  }, [opened]);

  useTauriEvent<LoginProgress>(LOGIN_PROGRESS, (p) => {
    if (p.loginId !== loginRef.current) return;
    if (p.stage === "browser") {
      setBrowserOpened(!!p.url);
      setManualUrl(p.manualUrl ?? p.url);
    } else if (p.stage === "codeInvalid") {
      setCodeError(p.message);
    } else if (p.stage === "authorized") {
      loginRef.current = null;
      setLoginId(null);
      verify();
    } else {
      loginRef.current = null;
      setLoginId(null);
      setFailure({ message: p.message ?? "El login no se completó.", details: p.details });
    }
  });

  async function startLogin(target: ClaudeAccount) {
    setFailure(null);
    setBrowserOpened(false);
    setManualUrl(null);
    setCodeError(null);
    try {
      const id = await startProfileLogin(target.id);
      loginRef.current = id;
      setLoginId(id);
    } catch (err) {
      setFailure({ message: "No se pudo iniciar el login de Claude Code.", details: String(err instanceof Error ? err.message : err) });
    }
  }

  async function submitData(values: { alias: string; defaultModel: string }) {
    try {
      const created = await createProfileAccount(values.alias, values.defaultModel || null);
      setAccount(created);
      setStep("prepare");
      setSynced(await prepareProfile(created.id));
      setStep("authorize");
      await startLogin(created);
    } catch (err) {
      setFailure({ message: "No se pudo preparar el perfil.", details: String(err instanceof Error ? err.message : err) });
    }
  }

  async function verify() {
    if (!account && !reconnect) return;
    const target = (account ?? reconnect)!;
    setStep("verify");
    try {
      const result = await verifyProfile(target.id);
      setCheck(result);
      if (!result.loggedIn || !result.replyOk) {
        setFailure({
          message: result.loggedIn
            ? "La cuenta inició sesión pero Claude no respondió correctamente."
            : "Claude Code no ve una sesión activa en este perfil.",
          details: result.details,
        });
        return;
      }
      setUsage(await accountUsage(target.id, true).catch(() => null));
      setStep("done");
      if (!reconnect) onCreated(target);
    } catch (err) {
      setFailure({ message: "No se pudo verificar la cuenta.", details: String(err instanceof Error ? err.message : err) });
    }
  }

  async function sendCode() {
    if (!loginId || !code.trim()) return;
    setCodeError(null);
    try {
      await submitLoginCode(loginId, code);
      setCode("");
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancel() {
    const target = account ?? reconnect;
    const discard = !reconnect && step !== "done";
    if (target) await cancelProfileLogin(loginRef.current, target.id, discard).catch(() => undefined);
    loginRef.current = null;
    setLoginId(null);
    onClose();
  }

  function retry() {
    const target = account ?? reconnect;
    setShowDetails(false);
    if (!target) {
      setFailure(null);
      setStep("data");
      return;
    }
    setStep("authorize");
    startLogin(target);
  }

  const active = step === "authorize" && codeOpen ? 3 : STEP_INDEX[step];

  return (
    <Modal opened={opened} onClose={cancel} title={reconnect ? `Reconectar ${reconnect.alias}` : "Agregar cuenta de Claude"} size={560} centered closeOnClickOutside={false}>
      <WizardSteps
        labels={["Datos", "Perfil", "Autoriza", "Código", "Verifica", "Listo"]}
        active={active}
        optional={[3]}
        skipped={codeOpen ? [] : [3]}
      />

      {failure ? (
        <Stack>
          <Alert color="red" variant="light" title="Algo salió mal">
            {failure.message}
          </Alert>
          {failure.details && (
            <>
              <Anchor size="xs" onClick={() => setShowDetails((v) => !v)}>
                {showDetails ? "Ocultar detalles técnicos" : "Ver detalles técnicos"}
              </Anchor>
              <Collapse in={showDetails}>
                <Code block fz={11} mah={200} style={{ overflow: "auto" }}>
                  {failure.details}
                </Code>
              </Collapse>
            </>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={cancel}>
              Cancelar
            </Button>
            <Button onClick={retry}>Reintentar</Button>
          </Group>
        </Stack>
      ) : step === "data" ? (
        <form onSubmit={handleSubmit(submitData)}>
          <Stack>
            <TextInput
              label="Alias"
              placeholder="Trabajo, Personal, Cliente X…"
              data-autofocus
              error={formState.errors.alias?.message}
              {...register("alias", { validate: (v) => v.trim().length > 0 || "Obligatorio" })}
            />
            <Select
              label="Modelo por defecto"
              placeholder="El global"
              clearable
              data={modelOptions(settings.catalog)}
              value={watch("defaultModel") || null}
              onChange={(v) => setValue("defaultModel", v ?? "")}
            />
            <Text size="xs" c="dimmed">
              Se crea un perfil aislado de Claude Code. El inicio de sesión lo hace Claude Code en tu navegador; DevHub nunca ve tu contraseña ni tus
              credenciales.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={cancel}>
                Cancelar
              </Button>
              <Button type="submit" loading={formState.isSubmitting}>
                Continuar
              </Button>
            </Group>
          </Stack>
        </form>
      ) : step === "prepare" ? (
        <WizardWait title="Preparando el perfil" text="Copiando tu configuración compartida (settings, CLAUDE.md, agents, commands, skills, MCP)…" />
      ) : step === "authorize" ? (
        <Stack>
          <Group wrap="nowrap" align="flex-start">
            <ThemeIcon size={42} radius="xl" variant="light">
              <IconBrowser size={22} />
            </ThemeIcon>
            <div>
              <Text fw={600}>Autoriza en tu navegador</Text>
              <Text size="sm" c="dimmed">
                {manualUrl
                  ? browserOpened
                    ? "Abrimos la página de Claude. Inicia sesión con la cuenta que quieres usar y acepta el acceso; aquí se detecta solo."
                    : "Abre el enlace en tu navegador, inicia sesión y acepta el acceso."
                  : "Iniciando Claude Code…"}
              </Text>
              {synced.length > 0 && (
                <Text size="xs" c="dimmed" mt={4}>
                  Config copiada: {synced.join(", ")}
                </Text>
              )}
            </div>
          </Group>
          <Group justify="center" py="xs">
            <Loader size="sm" type="dots" />
            <Text size="sm" c="dimmed">
              Esperando la autorización (máx. 5 min)
            </Text>
          </Group>
          <Group justify="center" gap="xs">
            <Button size="xs" variant="default" leftSection={<IconExternalLink size={14} />} disabled={!loginId || !manualUrl} onClick={() => loginId && reopenLoginUrl(loginId)}>
              Abrir de nuevo
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconCopy size={14} />}
              disabled={!manualUrl}
              onClick={() => manualUrl && navigator.clipboard.writeText(manualUrl)}
            >
              Copiar enlace
            </Button>
          </Group>
          {!codeOpen ? (
            <Anchor size="xs" ta="center" onClick={() => setCodeOpen(true)}>
              ¿La página te mostró un código para pegar?
            </Anchor>
          ) : (
            <Paper withBorder p="md" radius="md">
              <Text size="sm" fw={600} mb={6}>
                Pega el código de autorización
              </Text>
              <Group wrap="nowrap" align="flex-start">
                <TextInput
                  style={{ flex: 1 }}
                  placeholder="código#estado"
                  value={code}
                  onChange={(e) => setCode(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendCode()}
                  error={codeError}
                  ff="monospace"
                  autoFocus
                />
                <Button onClick={sendCode} disabled={!code.trim()}>
                  Enviar
                </Button>
              </Group>
            </Paper>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={cancel}>
              Cancelar
            </Button>
          </Group>
        </Stack>
      ) : step === "verify" ? (
        <WizardWait title="Verificando" text="Confirmando con Claude Code que la cuenta tiene sesión y responde…" />
      ) : (
        <Stack>
          <Paper withBorder p="md" radius="md">
            <Group gap="sm" mb="sm">
              <ThemeIcon color="teal" radius="xl">
                <IconCheck size={16} />
              </ThemeIcon>
              <div>
                <Text fw={600}>{(account ?? reconnect)?.alias}</Text>
                <Text size="xs" c="dimmed">
                  {[check?.email, check?.subscription, modelLabel((account ?? reconnect)?.defaultModel, settings.catalog)].filter(Boolean).join(" · ")}
                </Text>
              </div>
            </Group>
            {usage?.bars.length ? (
              <Stack gap="xs">
                {usage.bars.map((b) => (
                  <div key={b.label}>
                    <Group justify="space-between">
                      <Text size="xs">{b.label}</Text>
                      <Text size="xs" c="dimmed">
                        {b.percent}%{b.resetsAt ? ` · reinicia en ${timeUntil(b.resetsAt)}` : ""}
                      </Text>
                    </Group>
                    <Progress value={b.percent} size="sm" color={b.percent >= 85 ? "red" : b.percent >= 60 ? "yellow" : "teal"} />
                  </div>
                ))}
              </Stack>
            ) : (
              <Text size="xs" c="dimmed">
                {usage?.error ?? "El uso aparecerá en el footer en cuanto Claude Code lo reporte."}
              </Text>
            )}
          </Paper>
          <Group justify="flex-end">
            <Button onClick={onClose}>Listo</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/** Spinner block for automatic steps. */
function WizardWait({ title, text }: { title: string; text: string }) {
  return (
    <Stack align="center" py="lg" gap={6}>
      <Loader size="md" />
      <Text fw={600}>{title}</Text>
      <Text size="sm" c="dimmed" ta="center">
        {text}
      </Text>
    </Stack>
  );
}
