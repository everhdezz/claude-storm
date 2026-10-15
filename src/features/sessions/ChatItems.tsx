import { useState } from "react";
import { Badge, Group, Paper, Text, UnstyledButton } from "@mantine/core";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFileText,
  IconPencil,
  IconSearch,
  IconTerminal2,
  IconTool,
} from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { modelLabel } from "../../api/sessions";
import type { ChatItem } from "../../types";
import { relativeTime } from "../../utils/time";
import { useProjectContext } from "../project/ProjectContext";
import { DiffBlock } from "./DiffBlock";
import classes from "./sessions.module.css";

type ToolUse = Extract<ChatItem, { kind: "toolUse" }>;
type ToolResult = Extract<ChatItem, { kind: "toolResult" }>;

/** Renders a conversation, pairing each tool call with its result. */
export function ChatItems({ items, streaming }: { items: ChatItem[]; streaming: string }) {
  const results = new Map<string, ToolResult>();
  for (const item of items) if (item.kind === "toolResult") results.set(item.toolUseId, item);

  return (
    <div className={classes.thread}>
      {items.map((item, index) => {
        switch (item.kind) {
          case "prompt":
            return <PromptBubble key={index} item={item} />;
          case "text":
            return <Markdown key={index} text={item.text} />;
          case "toolUse":
            return <ToolBlock key={index} use={item} result={results.get(item.id)} />;
          case "result":
            return item.ok ? null : (
              <Text key={index} size="xs" c="red.4" className={classes.resultLine}>
                Claude terminó con error{item.text ? `: ${item.text}` : ""}
              </Text>
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
    <div className={classes.promptRow}>
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
  const isEdit = use.name === "Edit" || use.name === "MultiEdit" || use.name === "Write";
  const [open, setOpen] = useState(isEdit);
  const Icon = toolIcon(use.name);
  return (
    <div className={classes.tool}>
      <UnstyledButton className={classes.toolHeader} onClick={() => setOpen((v) => !v)}>
        {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
        <Icon size={14} />
        <Text size="xs" fw={600}>
          {use.name}
        </Text>
        <Text size="xs" c="dimmed" truncate ff="monospace" style={{ flex: 1 }}>
          {toolSummary(use)}
        </Text>
        {!result && <Badge size="xs" variant="light">ejecutando</Badge>}
        {result?.isError && (
          <Badge size="xs" color="red" variant="light">
            error
          </Badge>
        )}
      </UnstyledButton>
      {open && (
        <div className={classes.toolBody}>
          {isEdit ? <EditPreview use={use} /> : <pre className={`${classes.code} selectable`}>{JSON.stringify(use.input, null, 2)}</pre>}
          {result && !isEdit && <pre className={`${classes.code} ${classes.output} selectable`}>{result.content || "(sin salida)"}</pre>}
          {result?.isError && isEdit && <pre className={`${classes.code} ${classes.output}`}>{result.content}</pre>}
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
  const value = input.file_path ?? input.command ?? input.pattern ?? input.path ?? input.url ?? input.description ?? "";
  return String(value);
}

/** Icon for a tool name. */
function toolIcon(name: string) {
  if (name === "Bash") return IconTerminal2;
  if (name === "Read") return IconFileText;
  if (name === "Edit" || name === "MultiEdit" || name === "Write") return IconPencil;
  if (name === "Grep" || name === "Glob") return IconSearch;
  return IconTool;
}
