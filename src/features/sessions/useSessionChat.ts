import { useEffect, useState } from "react";
import { SESSION_DELTA, SESSION_ITEM, sessionHistory } from "../../api/sessions";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import type { ChatItem } from "../../types";

/** Conversation of one session: stored history plus live items and streaming text. */
export function useSessionChat(sessionId: string) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setStreaming("");
    setLoading(true);
    sessionHistory(sessionId)
      .then((history) => !cancelled && setItems(history))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useTauriEvent<{ sessionId: string; item: ChatItem }>(SESSION_ITEM, (e) => {
    if (e.sessionId !== sessionId) return;
    setItems((prev) => [...prev, e.item]);
    if (e.item.kind === "text" || e.item.kind === "result" || e.item.kind === "toolUse") setStreaming("");
  });

  useTauriEvent<{ sessionId: string; text: string }>(SESSION_DELTA, (e) => {
    if (e.sessionId === sessionId) setStreaming((prev) => prev + e.text);
  });

  return { items, streaming, loading };
}
