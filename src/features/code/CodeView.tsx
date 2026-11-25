import { useEffect, useRef, useState } from "react";
import { ActionIcon, Center, Group, Text, Tooltip } from "@mantine/core";
import { IconDeviceFloppy, IconRefresh } from "@tabler/icons-react";
import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { repoReadFile, repoWriteFile } from "../../api/files";
import { notifyError } from "../../hooks/notify";
import { t } from "../../i18n";
import { useProjectContext } from "../project/ProjectContext";
import classes from "./code.module.css";

/** A file of a repo open in the editor. */
export interface CodeFile {
  repoId: string;
  path: string;
}

/** What the code editor remembered before tabs moved to the main area (read once to migrate). */
export interface CodeUiState {
  tabs?: CodeFile[];
  active?: number;
}

/** Same key as the file's tab in the main area. */
export const codeKey = (f: CodeFile) => `code:${f.repoId}:${f.path}`;
const keyOf = codeKey;
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Loaded text of a tab: the editor state (keeps undo history) and the text last saved to disk. */
interface Buffer {
  state: EditorState;
  saved: string;
}

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", backgroundColor: "transparent" },
  ".cm-scroller": { fontFamily: "var(--mantine-font-family-monospace)", lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none" },
});

interface CodeViewProps {
  hidden: boolean;
  /** File of the active main-area tab, if that tab is a file. */
  file: CodeFile | null;
  /** Every file with an open tab; buffers of closed ones are dropped. */
  open: CodeFile[];
  /** Line to show in a file (from a search result); `seq` changes on every request. */
  reveal: { key: string; line: number; seq: number } | null;
  /** Keys (see `codeKey`) of files with unsaved edits. */
  onDirtyChange: (keys: string[]) => void;
}

/** Code editor of the main area: shows the active file tab, keeping each open file's undo history. */
export function CodeView({ hidden, file, open, reveal, onDirtyChange }: CodeViewProps) {
  const { project } = useProjectContext();
  const [dirty, setDirty] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const buffers = useRef(new Map<string, Buffer>());
  const language = useRef(new Compartment());
  const current = file;
  const currentRef = useRef(current);
  currentRef.current = current;

  const reposById = new Map(project.repos.map((r) => [r.id, r]));

  useEffect(() => onDirtyChange(dirty), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // A requested line waits until its file is in the editor (it may still be loading).
  const pendingReveal = useRef<{ key: string; line: number } | null>(null);
  function applyReveal() {
    const wanted = pendingReveal.current;
    const editor = view.current;
    if (!wanted || !editor || !currentRef.current || keyOf(currentRef.current) !== wanted.key) return;
    const line = editor.state.doc.line(Math.min(Math.max(wanted.line, 1), editor.state.doc.lines));
    editor.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    editor.focus();
    pendingReveal.current = null;
  }
  useEffect(() => {
    if (!reveal) return;
    pendingReveal.current = { key: reveal.key, line: reveal.line };
    if (view.current && currentRef.current && keyOf(currentRef.current) === reveal.key && buffers.current.has(reveal.key)) applyReveal();
  }, [reveal?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // A closed tab forgets its buffer (and its unsaved edits, which the tab bar confirmed).
  const openKeys = open.map(keyOf).join("\n");
  useEffect(() => {
    const keep = new Set(openKeys.split("\n"));
    for (const key of [...buffers.current.keys()]) if (!keep.has(key)) buffers.current.delete(key);
    setDirty((prev) => (prev.every((k) => keep.has(k)) ? prev : prev.filter((k) => keep.has(k))));
  }, [openKeys]);

  function save() {
    const file = currentRef.current;
    const editor = view.current;
    if (!file || !editor) return true;
    const key = keyOf(file);
    const text = editor.state.doc.toString();
    repoWriteFile(project.id, file.repoId, file.path, text)
      .then(() => {
        const buffer = buffers.current.get(key);
        if (buffer) buffer.saved = text;
        setDirty((prev) => prev.filter((k) => k !== key));
      })
      .catch((err) => notifyError(err, t("Could not save the file")));
    return true;
  }
  const saveRef = useRef(save);
  saveRef.current = save;

  function newState(doc: string, key: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab, { key: "Mod-s", preventDefault: true, run: () => saveRef.current() }]),
        oneDark,
        theme,
        language.current.of([]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const buffer = buffers.current.get(key);
          if (!buffer) return;
          buffer.state = update.state;
          const isDirty = update.state.doc.toString() !== buffer.saved;
          setDirty((prev) => (isDirty === prev.includes(key) ? prev : isDirty ? [...prev, key] : prev.filter((k) => k !== key)));
        }),
      ],
    });
  }

  /** Shows a tab's buffer in the editor, loading it from disk the first time. */
  async function show(file: CodeFile, reload = false) {
    const key = keyOf(file);
    let buffer = reload ? undefined : buffers.current.get(key);
    setError(null);
    if (!buffer) {
      try {
        const text = await repoReadFile(project.id, file.repoId, file.path);
        buffer = { state: newState(text, key), saved: text };
        buffers.current.set(key, buffer);
        setDirty((prev) => prev.filter((k) => k !== key));
      } catch (err) {
        if (currentRef.current && keyOf(currentRef.current) === key) setError(String(err));
        return;
      }
    }
    if (!currentRef.current || keyOf(currentRef.current) !== key) return;
    if (!view.current) view.current = new EditorView({ state: buffer.state, parent: host.current! });
    else view.current.setState(buffer.state);
    const lang = LanguageDescription.matchFilename(languages, baseName(file.path));
    if (lang) {
      lang.load().then((support) => {
        if (currentRef.current && keyOf(currentRef.current) === key) view.current?.dispatch({ effects: language.current.reconfigure(support) });
      });
    }
    if (!hidden) view.current.focus();
    applyReveal();
  }

  useEffect(() => {
    if (current) show(current);
  }, [current?.repoId, current?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => view.current?.destroy(), []);

  const currentDirty = current ? dirty.includes(keyOf(current)) : false;

  return (
    <div style={{ flex: 1, minHeight: 0, display: hidden || !current ? "none" : "flex", flexDirection: "column" }}>
      {current && (
        <Group className={classes.toolbar} justify="space-between" wrap="nowrap" gap={6}>
          <Text size="xs" c="dimmed" truncate>
            {reposById.get(current.repoId)?.name ?? "?"} / {current.path}
          </Text>
          <Group gap={4} wrap="nowrap">
            <Tooltip label={t("Reload from disk")}>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => show(current, true)} aria-label={t("Reload from disk")}>
                <IconRefresh size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("Save (⌘S)")}>
              <ActionIcon variant="subtle" color="gray" size="sm" disabled={!currentDirty} onClick={save} aria-label={t("Save (⌘S)")}>
                <IconDeviceFloppy size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      )}
      <div ref={host} className={classes.editor} style={{ display: current && !error ? undefined : "none" }} />
      {current && error && (
        <Center style={{ flex: 1 }}>
          <Text size="sm" c="dimmed">
            {error}
          </Text>
        </Center>
      )}
    </div>
  );
}
