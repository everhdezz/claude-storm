import { useState } from "react";
import { Badge, Group, Paper, Text, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconChevronDown, IconChevronRight, IconFile, IconStack2 } from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { modelLabel } from "../../api/sessions";
import type { ChatItem } from "../../types";
import { relativeTime } from "../../utils/time";
import { useProjectContext } from "../project/ProjectContext";
import { DiffBlock } from "./DiffBlock";
import { KIND_META, toolInfo } from "./toolKinds";
import { ResultStats } from "./TurnStats";
import classes from "./sessions.module.css";
import { t, tn } from "../../i18n";

type ToolUse = Extract<ChatItem, { kind: "toolUse" }>;
type ToolResult = Extract<ChatItem, { kind: "toolResult" }>;

/** Runs of this many back-to-back tool calls collapse into one group. */
const GROUP_MIN = 3;

type Segment = { item: ChatItem; index: number } | { group: { use: ToolUse; index: number }[] };

/** Whether a tool call renders its diff inline, so it stays out of groups. */
function isEditTool(use: ToolUse): boolean {
  return use.name === "Edit" || use.name === "MultiEdit" || use.name === "Write";
}

/** Splits the thread into single items and runs of consecutive non-edit tool calls. */
function segment(items: ChatItem[]): Segment[] {
  const out: Segment[] = [];
  let run: { use: ToolUse; index: number }[] = [];
  const flush = () => {
    if (run.length >= GROUP_MIN) out.push({ group: run });
    else for (const r of run) out.push({ item: r.use, index: r.index });
    run = [];
  };
  items.forEach((item, index) => {
    if (item.kind === "toolResult") return;
    if (item.kind === "toolUse" && !isEditTool(item)) {
      run.push({ use: item, index });
      return;
    }
    flush();
    out.push({ item, index });
  });
  flush();
  return out;
}

/** Renders a conversation, pairing each tool call with its result. */
export function ChatItems({ items, streaming }: { items: ChatItem[]; streaming: string }) {
  const results = new Map<string, ToolResult>();
  for (const item of items) if (item.kind === "toolResult") results.set(item.toolUseId, item);

  return (
    <div className={classes.thread}>
      {segment(items).map((seg) => {
        if ("group" in seg) return <ToolGroup key={seg.group[0]!.index} calls={seg.group} results={results} />;
        const { item, index } = seg;
        switch (item.kind) {
          case "prompt":
            return <PromptBubble key={index} item={item} />;
          case "text":
            return <Markdown key={index} text={item.text} />;
          case "toolUse":
            return <ToolBlock key={index} use={item} result={results.get(item.id)} />;
          case "result":
            return (
              <div key={index}>
                {!item.ok && (
                  <Text size="xs" c="red.4" className={classes.resultLine}>
                    {item.text ? t("Claude ended with an error: {text}", { text: item.text }) : t("Claude ended with an error")}
                  </Text>
                )}
                <ResultStats item={item} />
              </div>
            );
          case "notice":
            return (
              <Group key={index} gap={6} className={classes.notice} data-level={item.level}>
                {item.level !== "info" && <IconAlertTriangle size={14} />}
                <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
                  {item.text}
                </Text>
              </Group>
            );
          default:
            return null;
        }
      })}
      {streaming && <Markdown text={streaming} />}
    </div>
  );
}

/** The user's prompt, right aligned. */
function PromptBubble({ item }: { item: Extract<ChatItem, { kind: "prompt" }> }) {
  const { settings } = useProjectContext();
  const catalog = settings.catalog;
  return (
    <div className={classes.promptRow} data-prompt>
      <Paper className={`${classes.prompt} selectable`} radius="md" px="md" py={8}>
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
          {item.text}
        </Text>
        {item.attachments && item.attachments.length > 0 && (
          <Group gap={6} mt={6}>
            {item.attachments.map((name) => (
              <Group key={name} gap={4} className={classes.attachment}>
                <IconFile size={12} />
                <Text size="xs">{name}</Text>
              </Group>
            ))}
          </Group>
        )}
      </Paper>
      <Text size="xs" c="dimmed" mt={4}>
        {[item.account, item.model ? modelLabel(item.model, catalog) : null, relativeTime(item.at)].filter(Boolean).join(" · ")}
      </Text>
    </div>
  );
}

/** Assistant text rendered as GitHub-flavored Markdown. */
function Markdown({ text }: { text: string }) {
  return (
    <div className={`${classes.markdown} selectable`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

/** Collapsible block for one tool call and its output; edits show a diff. */
function ToolBlock({ use, result }: { use: ToolUse; result: ToolResult | undefined }) {
  const isEdit = isEditTool(use);
  const [open, setOpen] = useState(isEdit);
  const info = toolInfo(use);
  const meta = info.kind === "builtin" ? null : KIND_META[info.kind];
  const Icon = info.icon;
  return (
    <div className={classes.tool}>
      <UnstyledButton className={classes.toolHeader} onClick={() => setOpen((v) => !v)}>
        {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
        <Icon size={14} color={meta ? `var(--mantine-color-${meta.color}-4)` : undefined} />
        {meta && (
          <Badge size="xs" variant="light" color={meta.color}>
            {meta.tag}
          </Badge>
        )}
        <Text size="xs" fw={600} style={{ flexShrink: 0 }}>
          {info.label}
        </Text>
        <Text size="xs" c="dimmed" truncate ff="monospace" style={{ flex: 1 }}>
          {toolSummary(use)}
        </Text>
        {!result && <Badge size="xs" variant="light">{t("running")}</Badge>}
        {result?.isError && (
          <Badge size="xs" color="red" variant="light">
            {t("error")}
          </Badge>
        )}
      </UnstyledButton>
      {open && (
        <div className={classes.toolBody}>
          {isEdit ? <EditPreview use={use} /> : <pre className={`${classes.code} selectable`}>{JSON.stringify(use.input, null, 2)}</pre>}
          {result && !isEdit && <pre className={`${classes.code} ${classes.output} selectable`}>{result.content || t("(no output)")}</pre>}
          {result?.isError && isEdit && <pre className={`${classes.code} ${classes.output}`}>{result.content}</pre>}
        </div>
      )}
    </div>
  );
}

/** Collapsed run of back-to-back tool calls, e.g. a burst of Bash commands. */
function ToolGroup({ calls, results }: { calls: { use: ToolUse; index: number }[]; results: Map<string, ToolResult> }) {
  const [open, setOpen] = useState(false);
  const counts = new Map<string, number>();
  for (const { use } of calls) {
    const label = toolInfo(use).label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const breakdown = [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(" · ");
  const running = calls.filter(({ use }) => !results.has(use.id)).length;
  const errors = calls.filter(({ use }) => results.get(use.id)?.isError).length;
  return (
    <div className={classes.tool}>
      <UnstyledButton className={classes.toolHeader} onClick={() => setOpen((v) => !v)}>
        {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
        <IconStack2 size={14} />
        <Text size="xs" fw={600} style={{ flexShrink: 0 }}>
          {tn(calls.length, "{count} tool call", "{count} tool calls")}
        </Text>
        <Text size="xs" c="dimmed" truncate style={{ flex: 1 }}>
          {breakdown}
        </Text>
        {running > 0 && (
          <Badge size="xs" variant="light">
            {running > 1 ? `${t("running")} · ${running}` : t("running")}
          </Badge>
        )}
        {errors > 0 && (
          <Badge size="xs" color="red" variant="light">
            {errors > 1 ? `${t("error")} · ${errors}` : t("error")}
          </Badge>
        )}
      </UnstyledButton>
      {open && (
        <div className={`${classes.toolBody} ${classes.toolGroupBody}`}>
          {calls.map(({ use, index }) => (
            <ToolBlock key={index} use={use} result={results.get(use.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Diff-like view of Edit/MultiEdit/Write inputs. */
function EditPreview({ use }: { use: ToolUse }) {
  const input = use.input as Record<string, unknown>;
  if (use.name === "Write") {
    const content = String(input.content ?? "");
    return <DiffBlock diff={content.split("\n").map((l) => `+${l}`).join("\n")} />;
  }
  const edits = use.name === "MultiEdit" ? ((input.edits as Record<string, unknown>[]) ?? []) : [input];
  const diff = edits
    .map((e) => {
      const removed = String(e.old_string ?? "").split("\n").map((l) => `-${l}`);
      const added = String(e.new_string ?? "").split("\n").map((l) => `+${l}`);
      return ["@@", ...removed, ...added].join("\n");
    })
    .join("\n");
  return <DiffBlock diff={diff} />;
}

/** One-line description of a tool call. */
function toolSummary(use: ToolUse): string {
  const input = use.input as Record<string, unknown>;
  const value =
    input.file_path ?? input.command ?? input.pattern ?? input.path ?? input.url ?? input.query ?? input.description ?? input.args ?? "";
  return String(value);
}
