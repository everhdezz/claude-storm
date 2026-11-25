/**
 * Unsent text and attachments of each chat's composer (and of the "new chat" one), kept in
 * localStorage so they survive switching chats, closing the tab or restarting the app.
 */
export interface Draft {
  text: string;
  attachments: string[];
}

const PREFIX = "claudestorm:draft:";
const EMPTY: Draft = { text: "", attachments: [] };

export function loadDraft(key: string): Draft {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments.filter((a): a is string => typeof a === "string") : [],
    };
  } catch {
    return EMPTY;
  }
}

export function saveDraft(key: string, draft: Draft) {
  try {
    if (!draft.text.trim() && draft.attachments.length === 0) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(draft));
  } catch {
    // Storage full or unavailable: the draft just is not kept.
  }
}

/** Forgets a chat's draft (the chat was deleted). */
export function clearDraft(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
