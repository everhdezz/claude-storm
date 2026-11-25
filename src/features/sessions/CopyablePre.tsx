import { type ComponentPropsWithoutRef, useRef, useState } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { t } from "../../i18n";
import classes from "./sessions.module.css";

/** A `<pre>` with a copy button in its corner (shown on hover) that copies exactly its text. */
export function CopyablePre(props: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) {
  // `node` comes from react-markdown and is not a DOM attribute.
  const { node: _node, ...rest } = props;
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = pre.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text.replace(/\n$/, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied: nothing to do.
    }
  }

  return (
    <div className={classes.copyable}>
      <pre ref={pre} {...rest} />
      <Tooltip label={copied ? t("Copied") : t("Copy")} withArrow position="left">
        <ActionIcon className={classes.copyButton} size="sm" variant="default" color={copied ? "teal" : "gray"} onClick={copy} aria-label={t("Copy")}>
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
        </ActionIcon>
      </Tooltip>
    </div>
  );
}
