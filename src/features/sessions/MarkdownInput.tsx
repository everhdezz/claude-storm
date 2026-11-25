import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Compartment, EditorState, type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, placeholder as placeholderExt, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";
import classes from "./sessions.module.css";

export interface MarkdownInputHandle {
  focus: () => void;
  /** Replaces the whole text (and puts the cursor at the end). */
  setText: (text: string) => void;
}

interface MarkdownInputProps {
  initial: string;
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (text: string) => void;
  /** Cmd/Ctrl+Enter. */
  onSubmit: () => void;
  /** Shift+Tab. */
  onShiftTab?: () => void;
  /** Return true when the paste was handled (files attached) so the text is not inserted. */
  onPaste?: (e: ClipboardEvent) => boolean;
}

/** Markdown shown as it is written: headings, bold, italics, code and lists look the part while the text stays Markdown. */
const markdownStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.35em", fontWeight: "700", color: "var(--mantine-color-gray-0)" },
  { tag: tags.heading2, fontSize: "1.2em", fontWeight: "700", color: "var(--mantine-color-gray-0)" },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: "700", color: "var(--mantine-color-gray-0)" },
  { tag: tags.strong, fontWeight: "700", color: "var(--mantine-color-gray-0)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--mantine-color-indigo-3)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--mantine-color-indigo-3)" },
  { tag: tags.quote, color: "var(--mantine-color-gray-5)", fontStyle: "italic" },
  { tag: tags.monospace, fontFamily: "var(--mantine-font-family-monospace)", fontSize: "0.92em", color: "#e8b77d" },
  { tag: tags.processingInstruction, color: "var(--mantine-color-gray-6)" },
  { tag: tags.contentSeparator, color: "var(--mantine-color-gray-6)" },
  // Code inside fenced blocks (highlighted by their language).
  { tag: tags.keyword, color: "#c678dd" },
  { tag: [tags.string, tags.special(tags.string)], color: "#98c379" },
  { tag: [tags.number, tags.bool, tags.null], color: "#d19a66" },
  { tag: tags.comment, color: "var(--mantine-color-gray-6)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#61afef" },
  { tag: [tags.typeName, tags.className], color: "#e5c07b" },
  { tag: tags.propertyName, color: "#e06c75" },
]);

const codeLine = Decoration.line({ class: "cm-md-code" });
const quoteLine = Decoration.line({ class: "cm-md-quote" });

/** Background for fenced code blocks and a bar for quotes, one line at a time. */
const blockLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const lines = new Map<number, Decoration>();
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            const deco = node.name === "FencedCode" || node.name === "CodeBlock" ? codeLine : node.name === "Blockquote" ? quoteLine : null;
            if (!deco) return;
            for (let pos = node.from; pos <= node.to; ) {
              const line = view.state.doc.lineAt(pos);
              lines.set(line.from, deco);
              pos = line.to + 1;
            }
            return false;
          },
        });
      }
      const builder = new RangeSetBuilder<Decoration>();
      for (const from of [...lines.keys()].sort((a, b) => a - b)) builder.add(from, from, lines.get(from)!);
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.theme(
  {
    "&": { background: "transparent", color: "var(--mantine-color-gray-2)", fontSize: "var(--mantine-font-size-sm)" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--mantine-font-family)", lineHeight: "1.55", minHeight: "3.1em", maxHeight: "300px", overflow: "auto" },
    ".cm-content": { padding: "2px 0", caretColor: "var(--mantine-color-gray-0)" },
    ".cm-line": { padding: "0 2px" },
    ".cm-placeholder": { color: "var(--mantine-color-placeholder)" },
    ".cm-cursor": { borderLeftColor: "var(--mantine-color-gray-0)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { background: "rgba(76, 110, 245, 0.35) !important" },
    ".cm-md-code": { background: "#141517", fontFamily: "var(--mantine-font-family-monospace)", fontSize: "0.92em" },
    ".cm-md-quote": { borderLeft: "3px solid var(--mantine-color-gray-6)", paddingLeft: "8px" },
  },
  { dark: true },
);

/**
 * The prompt box: Enter adds a line (continuing lists and quotes), Cmd/Ctrl+Enter sends. The text is
 * plain Markdown, shown with its formatting while it is typed; that Markdown is what Claude gets.
 */
export const MarkdownInput = forwardRef<MarkdownInputHandle, MarkdownInputProps>(function MarkdownInput(
  { initial, placeholder, disabled = false, autoFocus, onChange, onSubmit, onShiftTab, onPaste },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  const hint = useRef(new Compartment());
  // The editor is built once; callbacks are read through refs so they stay current.
  const handlers = useRef({ onChange, onSubmit, onShiftTab, onPaste });
  handlers.current = { onChange, onSubmit, onShiftTab, onPaste };

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    setText: (text: string) => {
      const v = view.current;
      if (!v) return;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, selection: { anchor: text.length } });
      v.focus();
    },
  }));

  useEffect(() => {
    const extensions: Extension[] = [
      history(),
      keymap.of([
        { key: "Mod-Enter", preventDefault: true, run: () => (handlers.current.onSubmit(), true) },
        { key: "Shift-Tab", preventDefault: true, run: () => (handlers.current.onShiftTab?.(), true) },
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(markdownStyle),
      blockLines,
      EditorView.lineWrapping,
      theme,
      editable.current.of([EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)]),
      hint.current.of(placeholderExt(placeholder)),
      EditorView.contentAttributes.of({ "aria-label": placeholder, spellcheck: "true" }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) handlers.current.onChange(u.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        paste: (e) => handlers.current.onPaste?.(e) ?? false,
      }),
    ];
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: initial, extensions, selection: { anchor: initial.length } }),
    });
    view.current = v;
    if (autoFocus) requestAnimationFrame(() => v.focus());
    return () => {
      v.destroy();
      view.current = null;
    };
    // Built once per mount; `initial` only seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: editable.current.reconfigure([EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)]) });
  }, [disabled]);

  useEffect(() => {
    view.current?.dispatch({ effects: hint.current.reconfigure(placeholderExt(placeholder)) });
  }, [placeholder]);

  return <div ref={host} className={classes.markdownInput} data-composer />;
});
