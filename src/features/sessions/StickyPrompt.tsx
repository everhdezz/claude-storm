import { useCallback, useEffect, useState, type RefObject } from "react";
import { Text, UnstyledButton } from "@mantine/core";
import { IconArrowUp } from "@tabler/icons-react";
import type { ChatItem } from "../../types";
import classes from "./sessions.module.css";
import { t } from "../../i18n";

/** Height the sticky bar covers at the top of the thread. */
const BAR = 44;

/**
 * Pins the latest prompt of yours that has scrolled out of view. Clicking it scrolls there; since
 * that prompt is then visible, the bar shows the one before it, so repeated clicks walk back.
 */
export function StickyPrompt({ viewport, items }: { viewport: RefObject<HTMLDivElement | null>; items: ChatItem[] }) {
  const prompts = items.filter((i): i is Extract<ChatItem, { kind: "prompt" }> => i.kind === "prompt");
  const [index, setIndex] = useState<number | null>(null);

  const update = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + BAR;
    const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-prompt]"));
    let found: number | null = null;
    // The last prompt whose bubble is entirely above the visible area.
    rows.forEach((row, i) => {
      if (row.getBoundingClientRect().bottom <= top) found = i;
    });
    setIndex(found);
  }, [viewport]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [viewport, update, items.length]);

  if (index === null || !prompts[index]) return null;

  function jump() {
    const el = viewport.current;
    const row = el?.querySelectorAll<HTMLElement>("[data-prompt]")[index!];
    if (!el || !row) return;
    const offset = row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - BAR - 8;
    el.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
  }

  return (
    <UnstyledButton className={classes.stickyPrompt} onClick={jump} title={t("Go to this message")}>
      <IconArrowUp size={13} className={classes.stickyIcon} />
      <Text size="xs" className={classes.stickyLabel}>
        {index === prompts.length - 1 ? t("Last message") : t("Message {n} of {total}", { n: index + 1, total: prompts.length })}
      </Text>
      <Text size="xs" c="inherit" truncate style={{ flex: 1, minWidth: 0 }}>
        {prompts[index].text || prompts[index].attachments?.join(", ")}
      </Text>
    </UnstyledButton>
  );
}
