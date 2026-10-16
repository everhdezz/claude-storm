import { useEffect, useRef, useState } from "react";
import { Center, Loader, Text } from "@mantine/core";
import { es as blockNoteEs, en as blockNoteEn } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "./blocknote.css";
import { wikiRead, wikiWrite } from "../../api/wiki";
import { notifyError } from "../../hooks/notify";
import { getLocale, t } from "../../i18n";
import classes from "./wiki.module.css";

const SAVE_DELAY_MS = 600;

interface WikiEditorProps {
  projectId: string;
  /** Current path; it changes on rename without reloading the document. */
  path: string;
  name: string;
  onRename: (name: string) => void;
}

/** Loads a document and shows it in the block editor; the parent remounts it per opened document. */
export function WikiEditor(props: WikiEditorProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstPath = useRef(props.path);

  useEffect(() => {
    let alive = true;
    wikiRead(props.projectId, firstPath.current)
      .then((md) => alive && setMarkdown(md))
      .catch((err) => alive && setError(String(err?.message ?? err)));
    return () => {
      alive = false;
    };
  }, [props.projectId]);

  if (error) {
    return (
      <Center h="100%">
        <Text c="red" size="sm">
          {error}
        </Text>
      </Center>
    );
  }
  if (markdown === null) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }
  return <BlockEditor {...props} initial={markdown} />;
}

/** Notion-like editor: slash menu, drag handles and formatting toolbar; saves Markdown as you type. */
function BlockEditor({ projectId, path, name, onRename, initial }: WikiEditorProps & { initial: string }) {
  const editor = useCreateBlockNote({ dictionary: getLocale() === "es" ? blockNoteEs : blockNoteEn });
  const ready = useRef(false);
  const saved = useRef(initial);
  const currentPath = useRef(path);
  currentPath.current = path;
  const timer = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<"saved" | "dirty" | "saving">("saved");

  useEffect(() => {
    if (initial.trim()) editor.replaceBlocks(editor.document, editor.tryParseMarkdownToBlocks(initial));
    // Compare later edits against the editor's own serialization, so opening a page never rewrites it.
    saved.current = editor.blocksToMarkdownLossy(editor.document);
    // The load itself fires a change event on the next tick; edits count from then on.
    const id = window.setTimeout(() => (ready.current = true), 0);
    return () => window.clearTimeout(id);
  }, [editor, initial]);

  // Unsaved edits are written when switching documents or closing the wiki.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function flush() {
    if (timer.current === undefined) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const md = editor.blocksToMarkdownLossy(editor.document);
    if (md === saved.current) {
      setStatus("saved");
      return;
    }
    setStatus("saving");
    wikiWrite(projectId, currentPath.current, md)
      .then(() => {
        saved.current = md;
        setStatus("saved");
      })
      .catch((err) => {
        // The page was deleted while an edit was pending; nothing left to save.
        if (String(err?.message ?? err).startsWith("Not found")) return;
        setStatus("dirty");
        notifyError(err, t("Could not save the page"));
      });
  }

  /** Clicking the empty space below the content puts the cursor at the end, like Notion. */
  function focusEnd(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target !== e.currentTarget && !target.classList.contains(classes.pageInner!)) return;
    e.preventDefault();
    const last = editor.document[editor.document.length - 1];
    if (last) editor.setTextCursorPosition(last, "end");
    editor.focus();
  }

  function onChange() {
    if (!ready.current) return;
    setStatus("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  }

  return (
    <div className={classes.page} onMouseDown={focusEnd}>
      <div className={classes.pageInner}>
        <div className={classes.pageMeta}>
          <Text size="xs" c="dimmed" truncate>
            {path.split("/").slice(0, -1).join(" / ")}
          </Text>
          <Text size="xs" c="dimmed">
            {status === "saved" ? t("Saved") : status === "saving" ? t("Saving…") : t("Unsaved changes")}
          </Text>
        </div>
        <PageTitle name={name} autoFocus={!initial.trim()} onRename={onRename} onEnter={() => editor.focus()} />
        <BlockNoteView editor={editor} theme="dark" onChange={onChange} className={classes.editor} />
      </div>
    </div>
  );
}

/** Big Notion-style title; editing it renames the file. */
function PageTitle({ name, autoFocus, onRename, onEnter }: { name: string; autoFocus: boolean; onRename: (name: string) => void; onEnter: () => void }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  function commit() {
    const next = value.trim();
    if (next && next !== name) onRename(next);
    else setValue(name);
  }
  return (
    <input
      className={classes.title}
      value={value}
      placeholder={t("Untitled")}
      autoFocus={autoFocus}
      onFocus={(e) => autoFocus && e.currentTarget.select()}
      onChange={(e) => setValue(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          onEnter();
        }
        if (e.key === "Escape") setValue(name);
      }}
    />
  );
}
