import { Fragment, useState } from "react";
import { Badge, Group, Loader, Paper, Text, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconChevronDown, IconChevronRight, IconFile, IconListDetails, IconStack2 } from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import { CopyablePre } from "./CopyablePre";
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
type Result = Extract<ChatItem, { kind: "result" }>;

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

type Entry = { item: ChatItem; index: number };

/**
 * One prompt and everything Claude did for it. `activity` is the work (narration and tool calls),
 * `answer` the text after the last tool call, shown as the reply once the turn is over.
 */
interface Turn {
  prompt: Entry | null;
  activity: Entry[];
  answer: Entry[];
  /** Notices and the final result line, always visible. */
  trailer: Entry[];
  live: boolean;
}

/** Splits the conversation into turns; the last one is live while the session works. */
function toTurns(items: ChatItem[], working: boolean): Turn[] {
  const turns: { prompt: Entry | null; body: Entry[] }[] = [];
  items.forEach((item, index) => {
    if (item.kind === "prompt") turns.push({ prompt: { item, index }, body: [] });
    else {
      if (turns.length === 0) turns.push({ prompt: null, body: [] });
      turns[turns.length - 1]!.body.push({ item, index });
    }
  });
  return turns.map(({ prompt, body }, i) => {
    const content = body.filter((e) => e.item.kind === "text" || e.item.kind === "toolUse");
    const trailer = body.filter((e) => e.item.kind === "notice" || e.item.kind === "result");
    // A result followed by more work (Claude resumed after a background task) makes the turn live again.
    const live = working && i === turns.length - 1 && body[body.length - 1]?.item.kind !== "result";
    let lastTool = -1;
    content.forEach((e, k) => e.item.kind === "toolUse" && (lastTool = k));
    if (lastTool === -1) return { prompt, activity: [], answer: content, trailer, live };
    // While Claude works every word may still be narration, so it all stays in the activity.
    if (live) return { prompt, activity: content, answer: [], trailer, live };
    return { prompt, activity: content.slice(0, lastTool + 1), answer: content.slice(lastTool + 1), trailer, live };
  });
}

/** Renders a conversation: per turn, the work collapses into one activity block and the reply stands apart. */
export function ChatItems({ items, streaming, working = false }: { items: ChatItem[]; streaming: string; working?: boolean }) {
  const results = new Map<string, ToolResult>();
  for (const item of items) if (item.kind === "toolResult") results.set(item.toolUseId, item);
  const turns = toTurns(items, working);

  return (
    <div className={classes.thread}>
      {turns.map((turn, i) => {
        const last = i === turns.length - 1;
        const liveStream = last && turn.live ? streaming : "";
        return (
          <Fragment key={turn.prompt?.index ?? `t${i}`}>
            {turn.prompt && <PromptBubble item={turn.prompt.item as Extract<ChatItem, { kind: "prompt" }>} />}
            {turn.activity.length > 0 && (
              <Activity entries={turn.activity} results={results} live={turn.live} streaming={liveStream} />
            )}
            {turn.answer.map(({ item, index }) => (item.kind === "text" ? <Markdown key={index} text={item.text} /> : null))}
            {/* Before the first tool call a reply streams as plain text, as in any chat. */}
            {turn.activity.length === 0 && liveStream && <Markdown text={liveStream} />}
            {turn.trailer.map(({ item, index }) => renderTrailer(item, index))}
            {!turn.live && <TurnTotal turn={turn} />}
          </Fragment>
        );
      })}
      {!working && streaming && <Markdown text={streaming} />}
    </div>
  );
}

/**
 * One stats line per turn, even when Claude stopped and picked up again (background work, automatic
 * resumes): the time runs from the prompt to the last result, and tokens add up.
 */
function TurnTotal({ turn }: { turn: Turn }) {
  const results = turn.trailer.flatMap((e) => (e.item.kind === "result" ? [e.item] : []));
  const last = results[results.length - 1];
  if (!last) return null;
  const sum = (pick: (r: Result) => number | null | undefined) =>
    results.some((r) => pick(r) != null) ? results.reduce((n, r) => n + (pick(r) ?? 0), 0) : null;
  const startedAt = turn.prompt?.item.kind === "prompt" ? Date.parse(turn.prompt.item.at) : NaN;
  const endedAt = last.at ? Date.parse(last.at) : NaN;
  // Older results have no time of their own: their durations are added instead.
  const durationMs = Number.isFinite(startedAt) && Number.isFinite(endedAt) ? endedAt - startedAt : sum((r) => r.durationMs);
  const total: Result = {
    ...last,
    durationMs,
    turns: sum((r) => r.turns),
    costUsd: sum((r) => r.costUsd),
    inputTokens: sum((r) => r.inputTokens),
    outputTokens: sum((r) => r.outputTokens),
  };
  return <ResultStats item={total} />;
}

/** Notices and errors at the end of a turn. */
function renderTrailer(item: ChatItem, index: number) {
  if (item.kind === "result") {
    return (
      <div key={index}>
        {!item.ok && (
          <Text size="xs" c="red.4" className={classes.resultLine}>
            {item.text ? t("Claude ended with an error: {text}", { text: item.text }) : t("Claude ended with an error")}
          </Text>
        )}
      </div>
    );
  }
  if (item.kind === "notice") {
    return (
      <Group key={index} gap={6} className={classes.notice} data-level={item.level}>
        {item.level !== "info" && <IconAlertTriangle size={14} />}
        <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
          {item.text}
        </Text>
      </Group>
    );
  }
  return null;
}

/** Last paragraph of a text as plain words (no Markdown markers), for the gray live status. */
function lastParagraph(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map((p) =>
    p
      .split("\n")
      .map((l) => l.replace(/^[#>*\-\s\d.]+/, "").replace(/[*_`]/g, "").trim())
      .filter(Boolean)
      .join(" · "),
  );
  return paragraphs.filter(Boolean).pop() ?? "";
}

/**
 * Collapsed record of what Claude did in a turn, like claude.ai: while it works the header shows
 * its latest words in gray as they stream; afterwards, a count of the steps it took.
 */
function Activity({ entries, results, live, streaming }: { entries: Entry[]; results: Map<string, ToolResult>; live: boolean; streaming: string }) {
  const [open, setOpen] = useState(false);
  const uses = entries.flatMap((e) => (e.item.kind === "toolUse" ? [e.item] : []));
  const counts = new Map<string, number>();
  for (const use of uses) {
    const label = toolInfo(use).label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const breakdown = [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(" · ");
  let status = "";
  if (live) {
    const lastEntry = entries[entries.length - 1]?.item;
    const pending = lastEntry?.kind === "toolUse" && !results.has(lastEntry.id) ? lastEntry : null;
    const lastText = [...entries].reverse().find((e) => e.item.kind === "text")?.item;
    status =
      lastParagraph(streaming) ||
      (pending ? `${toolInfo(pending).label} ${toolSummary(pending)}` : "") ||
      (lastText?.kind === "text" ? lastParagraph(lastText.text) : "") ||
      t("Thinking…");
  }

  return (
    <div className={classes.activity} data-live={live || undefined}>
      <UnstyledButton className={classes.activityHeader} onClick={() => setOpen((v) => !v)}>
        {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
        {live ? <Loader size={12} type="oval" /> : <IconListDetails size={14} />}
        {live ? (
          <Text size="xs" c="dimmed" lineClamp={2} style={{ flex: 1 }} className={classes.activityStatus}>
            {status}
          </Text>
        ) : (
          <>
            <Text size="xs" fw={600} c="dimmed" style={{ flexShrink: 0 }}>
              {tn(uses.length, "{count} step", "{count} steps")}
            </Text>
            <Text size="xs" c="dimmed" truncate style={{ flex: 1 }}>
              {breakdown}
            </Text>
          </>
        )}
        {live && uses.length > 0 && (
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            {tn(uses.length, "{count} step", "{count} steps")}
          </Text>
        )}
        {!live && <LastStepBadge uses={uses} results={results} />}
      </UnstyledButton>
      {open && (
        <div className={classes.activityBody}>
          {segment(entries.map((e) => e.item)).map((seg) => {
            if ("group" in seg) {
              const calls = seg.group.map((g) => ({ use: g.use, index: entries[g.index]!.index }));
              return <ToolGroup key={calls[0]!.index} calls={calls} results={results} />;
            }
            const { item } = seg;
            const index = entries[seg.index]!.index;
            if (item.kind === "text") return <Markdown key={index} text={item.text} muted />;
            if (item.kind === "toolUse") return <ToolBlock key={index} use={item} result={results.get(item.id)} />;
            return null;
          })}
          {streaming && <Markdown text={streaming} muted />}
        </div>
      )}
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

const MARKDOWN_COMPONENTS = { pre: CopyablePre };

/** Assistant text rendered as GitHub-flavored Markdown; code blocks get a copy button. */
function Markdown({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div className={`${classes.markdown} ${muted ? classes.markdownMuted : ""} selectable`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
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
          {isEdit ? <EditPreview use={use} /> : <CopyablePre className={`${classes.code} selectable`}>{JSON.stringify(use.input, null, 2)}</CopyablePre>}
          {result && !isEdit && <CopyablePre className={`${classes.code} ${classes.output} selectable`}>{result.content || t("(no output)")}</CopyablePre>}
          {result?.isError && isEdit && <pre className={`${classes.code} ${classes.output}`}>{result.content}</pre>}
        </div>
      )}
    </div>
  );
}

/**
 * State of the last call of a group: an error Claude already got past does not keep the whole
 * group red; what shows is how the latest step went (running, error, or nothing when it worked).
 */
function LastStepBadge({ uses, results }: { uses: ToolUse[]; results: Map<string, ToolResult> }) {
  const last = uses[uses.length - 1];
  if (!last) return null;
  const result = results.get(last.id);
  if (!result) return <Badge size="xs" variant="light">{t("running")}</Badge>;
  if (result.isError) {
    return (
      <Badge size="xs" color="red" variant="light">
        {t("error")}
      </Badge>
    );
  }
  return null;
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
        <LastStepBadge uses={calls.map((c) => c.use)} results={results} />
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
