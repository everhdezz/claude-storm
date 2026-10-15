import { useState } from "react";
import { Anchor, Badge, Button, Checkbox, Code, Group, Radio, Stack, Text, TextInput } from "@mantine/core";
import { IconHelpCircle, IconShieldCheck, IconShieldOff } from "@tabler/icons-react";
import { sessionAnswerApproval, updateSession } from "../../api/sessions";
import { notifyError } from "../../hooks/notify";
import { t } from "../../i18n";
import type { ApprovalDecision, ApprovalRequest, Session } from "../../types";
import { toolInfo } from "./toolKinds";
import classes from "./sessions.module.css";

interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
}

/**
 * What Claude is waiting on right now: tool permissions (allow / always / deny) and
 * AskUserQuestion prompts (pick an option or write another answer). Claude stays paused until
 * each card is answered.
 */
export function ApprovalPrompts({ session }: { session: Session }) {
  if (session.approvals.length === 0) return <AllowedToolsBar session={session} />;
  return (
    <Stack gap={8} mb={8}>
      <AllowedToolsBar session={session} />
      {session.approvals.map((a) =>
        a.toolName === "AskUserQuestion" ? (
          <QuestionCard key={a.id} session={session} request={a} />
        ) : (
          <PermissionCard key={a.id} session={session} request={a} />
        ),
      )}
    </Stack>
  );
}

/** What is already allowed "always" in this session, with a way to take it back. */
function AllowedToolsBar({ session }: { session: Session }) {
  const rules = session.allowedTools ?? [];
  if (rules.length === 0) return null;
  const all = rules.includes("*");
  return (
    <Group gap={6} mb={6} wrap="nowrap">
      <IconShieldOff size={14} color={all ? "var(--mantine-color-orange-4)" : "var(--mantine-color-dimmed)"} />
      <Text size="xs" c={all ? "orange.4" : "dimmed"} style={{ flex: 1 }}>
        {all ? t("Everything is allowed in this session") : t("{count} always-allowed rules in this session", { count: rules.length })}
      </Text>
      <Anchor
        size="xs"
        c="dimmed"
        onClick={() => updateSession(session.id, { clearAllowedTools: true }).catch((err) => notifyError(err))}
      >
        {t("Revoke")}
      </Anchor>
    </Group>
  );
}

function answer(session: Session, request: ApprovalRequest, decision: ApprovalDecision) {
  return sessionAnswerApproval(session.id, request.id, decision).catch((err) => notifyError(err, t("Could not answer")));
}

/** One-line description of what the tool will do (command, URL, file…). */
function target(input: Record<string, unknown>): string {
  const value = input.command ?? input.url ?? input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.description ?? "";
  return String(value);
}

function PermissionCard({ session, request }: { session: Session; request: ApprovalRequest }) {
  const [busy, setBusy] = useState(false);
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [showInput, setShowInput] = useState(false);
  const info = toolInfo({ kind: "toolUse", id: request.id, name: request.toolName, input: request.input });
  const Icon = info.icon;
  const what = target(request.input);
  const isBash = request.toolName === "Bash";

  async function decide(decision: ApprovalDecision) {
    setBusy(true);
    await answer(session, request, decision);
    setBusy(false);
  }

  return (
    <div className={classes.approval}>
      <Group gap={8} wrap="nowrap" mb={6}>
        <IconShieldCheck size={16} color="var(--mantine-color-yellow-4)" />
        <Text size="sm" fw={600} style={{ flex: 1 }}>
          {t("Claude wants to use {tool}", { tool: info.label })}
        </Text>
        <Badge size="xs" variant="light" color="yellow" leftSection={<Icon size={10} />}>
          {request.toolName}
        </Badge>
      </Group>
      {what && (
        <Code block className={classes.approvalTarget}>
          {what}
        </Code>
      )}
      <Anchor size="xs" c="dimmed" onClick={() => setShowInput((v) => !v)}>
        {showInput ? t("Hide details") : t("Show details")}
      </Anchor>
      {showInput && (
        <Code block mt={4} className={classes.approvalTarget}>
          {JSON.stringify(request.input, null, 2)}
        </Code>
      )}
      {noting && (
        <TextInput
          mt={8}
          size="xs"
          placeholder={t("Tell Claude why, or what to do instead (optional)")}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && decide({ allow: false, message: note })}
          autoFocus
        />
      )}
      <Group gap={6} mt={8}>
        <Button size="compact-sm" color="teal" loading={busy} onClick={() => decide({ allow: true })}>
          {t("Allow")}
        </Button>
        <Button size="compact-sm" variant="light" color="teal" disabled={busy} onClick={() => decide({ allow: true, always: true })}>
          {isBash ? t("Always allow this command") : t("Always allow {tool} in this session", { tool: request.toolName })}
        </Button>
        <Button size="compact-sm" variant="light" color="orange" disabled={busy} onClick={() => decide({ allow: true, all: true })}>
          {t("Allow everything in this session")}
        </Button>
        <div style={{ flex: 1 }} />
        {noting ? (
          <Button size="compact-sm" variant="light" color="red" disabled={busy} onClick={() => decide({ allow: false, message: note })}>
            {t("Deny with note")}
          </Button>
        ) : (
          <>
            <Anchor size="xs" c="dimmed" onClick={() => setNoting(true)}>
              {t("Add a note")}
            </Anchor>
            <Button size="compact-sm" variant="light" color="red" disabled={busy} onClick={() => decide({ allow: false })}>
              {t("Deny")}
            </Button>
          </>
        )}
      </Group>
    </div>
  );
}

function QuestionCard({ session, request }: { session: Session; request: ApprovalRequest }) {
  const questions = (Array.isArray(request.input.questions) ? request.input.questions : []) as Question[];
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const complete = questions.every((q) => (picked[q.question]?.length ?? 0) > 0 || (other[q.question] ?? "").trim());

  async function submit() {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const chosen = [...(picked[q.question] ?? [])];
      const typed = (other[q.question] ?? "").trim();
      if (typed) chosen.push(typed);
      answers[q.question] = chosen.join(", ");
    }
    setBusy(true);
    await answer(session, request, { allow: true, answers });
    setBusy(false);
  }

  return (
    <div className={classes.approval} data-kind="question">
      <Group gap={8} wrap="nowrap" mb={6}>
        <IconHelpCircle size={16} color="var(--mantine-color-indigo-3)" />
        <Text size="sm" fw={600}>
          {t("Claude has a question")}
        </Text>
      </Group>
      <Stack gap="sm">
        {questions.map((q) => (
          <div key={q.question}>
            {q.header && (
              <Badge size="xs" variant="light" mb={4}>
                {q.header}
              </Badge>
            )}
            <Text size="sm" mb={6}>
              {q.question}
            </Text>
            {q.multiSelect ? (
              <Checkbox.Group value={picked[q.question] ?? []} onChange={(v) => setPicked((p) => ({ ...p, [q.question]: v }))}>
                <Stack gap={6}>
                  {(q.options ?? []).map((o) => (
                    <Checkbox key={o.label} value={o.label} label={o.label} description={o.description} />
                  ))}
                </Stack>
              </Checkbox.Group>
            ) : (
              <Radio.Group value={picked[q.question]?.[0] ?? null} onChange={(v) => setPicked((p) => ({ ...p, [q.question]: [v] }))}>
                <Stack gap={6}>
                  {(q.options ?? []).map((o) => (
                    <Radio key={o.label} value={o.label} label={o.label} description={o.description} />
                  ))}
                </Stack>
              </Radio.Group>
            )}
            <TextInput
              mt={6}
              size="xs"
              placeholder={t("Other answer…")}
              value={other[q.question] ?? ""}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setOther((o) => ({ ...o, [q.question]: value }));
                if (value && !q.multiSelect) setPicked((p) => ({ ...p, [q.question]: [] }));
              }}
            />
          </div>
        ))}
      </Stack>
      <Group gap={6} mt={10}>
        <Button size="compact-sm" loading={busy} disabled={!complete} onClick={submit}>
          {t("Answer")}
        </Button>
        <div style={{ flex: 1 }} />
        <Button size="compact-sm" variant="subtle" color="gray" disabled={busy} onClick={() => answer(session, request, { allow: false, message: "The user skipped the question." })}>
          {t("Skip")}
        </Button>
      </Group>
    </div>
  );
}
