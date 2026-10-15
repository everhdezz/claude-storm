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
import { t } from "../../i18n";

type Step = "data" | "prepare" | "authorize" | "code" | "verify" | "done";

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

/** Visual wizard: Claude Code logs in inside a hidden PTY; claude-storm only relays URL and code. */
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
      setFailure({ message: p.message ?? t("The login did not complete."), details: p.details });
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
      setFailure({ message: t("Could not start the Claude Code login."), details: String(err instanceof Error ? err.message : err) });
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
      setFailure({ message: t("Could not prepare the profile."), details: String(err instanceof Error ? err.message : err) });
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
            ? t("The account logged in but Claude did not answer correctly.")
            : t("Claude Code does not see an active session in this profile."),
          details: result.details,
        });
        return;
      }
      setUsage(await accountUsage(target.id, true).catch(() => null));
      setStep("done");
      if (!reconnect) onCreated(target);
    } catch (err) {
      setFailure({ message: t("Could not verify the account."), details: String(err instanceof Error ? err.message : err) });
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

  const steps: { id: Step; label: string }[] = [
    { id: "data", label: t("Details") },
    { id: "prepare", label: t("Profile") },
    { id: "authorize", label: t("Authorize") },
    ...(codeOpen ? [{ id: "code" as Step, label: t("Code") }] : []),
    { id: "verify", label: t("Verify") },
    { id: "done", label: t("Done") },
  ];
  const current: Step = step === "authorize" && codeOpen ? "code" : step;
  const active = steps.findIndex((s) => s.id === current);

  return (
    <Modal opened={opened} onClose={cancel} title={reconnect ? t("Reconnect {account}", { account: reconnect.alias }) : t("Add a Claude account")} size={560} centered closeOnClickOutside={false}>
      <WizardSteps labels={steps.map((s) => s.label)} active={active} />

      {failure ? (
        <Stack>
          <Alert color="red" variant="light" title={t("Something went wrong")}>
            {failure.message}
          </Alert>
          {failure.details && (
            <>
              <Anchor size="xs" onClick={() => setShowDetails((v) => !v)}>
                {showDetails ? t("Hide technical details") : t("Show technical details")}
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
              {t("Cancel")}
            </Button>
            <Button onClick={retry}>{t("Retry")}</Button>
          </Group>
        </Stack>
      ) : step === "data" ? (
        <form onSubmit={handleSubmit(submitData)}>
          <Stack>
            <TextInput
              label="Alias"
              placeholder={t("Work, Personal, Client X…")}
              data-autofocus
              error={formState.errors.alias?.message}
              {...register("alias", { validate: (v) => v.trim().length > 0 || t("Required") })}
            />
            <Select
              label={t("Default model")}
              placeholder={t("The global one")}
              clearable
              data={modelOptions(settings.catalog)}
              value={watch("defaultModel") || null}
              onChange={(v) => setValue("defaultModel", v ?? "")}
            />
            <Text size="xs" c="dimmed">
              {t("An isolated Claude Code profile is created. Claude Code does the login in your browser; ClaudeStorm never sees your password or credentials.")}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={cancel}>
                {t("Cancel")}
              </Button>
              <Button type="submit" loading={formState.isSubmitting}>
                {t("Continue")}
              </Button>
            </Group>
          </Stack>
        </form>
      ) : step === "prepare" ? (
        <WizardWait title={t("Preparing the profile")} text={t("Copying your shared configuration (settings, CLAUDE.md, agents, commands, skills, MCP)…")} />
      ) : step === "authorize" ? (
        <Stack>
          <Group wrap="nowrap" align="flex-start">
            <ThemeIcon size={42} radius="xl" variant="light">
              <IconBrowser size={22} />
            </ThemeIcon>
            <div>
              <Text fw={600}>{t("Authorize in your browser")}</Text>
              <Text size="sm" c="dimmed">
                {manualUrl
                  ? browserOpened
                    ? t("We opened Claude's page. Log in with the account you want to use and accept access; it is detected here automatically.")
                    : t("Open the link in your browser, log in and accept access.")
                  : t("Starting Claude Code…")}
              </Text>
              {synced.length > 0 && (
                <Text size="xs" c="dimmed" mt={4}>
                  {t("Config copied: {items}", { items: synced.join(", ") })}
                </Text>
              )}
            </div>
          </Group>
          <Group justify="center" py="xs">
            <Loader size="sm" type="dots" />
            <Text size="sm" c="dimmed">
              {t("Waiting for authorization (5 min max)")}
            </Text>
          </Group>
          <Group justify="center" gap="xs">
            <Button size="xs" variant="default" leftSection={<IconExternalLink size={14} />} disabled={!loginId || !manualUrl} onClick={() => loginId && reopenLoginUrl(loginId)}>
              {t("Open again")}
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconCopy size={14} />}
              disabled={!manualUrl}
              onClick={() => manualUrl && navigator.clipboard.writeText(manualUrl)}
            >
              {t("Copy link")}
            </Button>
          </Group>
          {!codeOpen ? (
            <Anchor size="xs" ta="center" onClick={() => setCodeOpen(true)}>
              {t("Did the page show you a code to paste?")}
            </Anchor>
          ) : (
            <Paper withBorder p="md" radius="md">
              <Text size="sm" fw={600} mb={6}>
                {t("Paste the authorization code")}
              </Text>
              <Group wrap="nowrap" align="flex-start">
                <TextInput
                  style={{ flex: 1 }}
                  placeholder={t("code#state")}
                  value={code}
                  onChange={(e) => setCode(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendCode()}
                  error={codeError}
                  ff="monospace"
                  autoFocus
                />
                <Button onClick={sendCode} disabled={!code.trim()}>
                  {t("Send")}
                </Button>
              </Group>
            </Paper>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={cancel}>
              {t("Cancel")}
            </Button>
          </Group>
        </Stack>
      ) : step === "verify" ? (
        <WizardWait title={t("Verifying")} text={t("Confirming with Claude Code that the account is logged in and answers…")} />
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
                        {b.percent}%{b.resetsAt ? ` · ${t("resets in {time}", { time: timeUntil(b.resetsAt) ?? "" })}` : ""}
                      </Text>
                    </Group>
                    <Progress value={b.percent} size="sm" color={b.percent >= 85 ? "red" : b.percent >= 60 ? "yellow" : "teal"} />
                  </div>
                ))}
              </Stack>
            ) : (
              <Text size="xs" c="dimmed">
                {t("This account's usage will show up in the footer as soon as Claude Code reports it.")}
              </Text>
            )}
          </Paper>
          <Group justify="flex-end">
            <Button onClick={onClose}>{t("Done")}</Button>
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
