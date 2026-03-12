/** CodeMirror 기반 YAML 에디터 — 대시보드 테마 연동 + syntax highlighting. */

import { useRef, useEffect } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { yaml } from "@codemirror/lang-yaml";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/** 대시보드 CSS 변수 기반 CodeMirror 테마. */
const dashboardTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12.5px",
    backgroundColor: "var(--bg)",
    color: "var(--text)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
  },
  ".cm-content": { padding: "8px 0", caretColor: "var(--accent)" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent) 20%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--panel)",
    color: "var(--muted)",
    borderRight: "1px solid var(--line)",
  },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent) 5%, transparent)" },
  ".cm-foldGutter span": { color: "var(--muted)" },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)",
  },
});

/** YAML syntax highlighting — CSS 변수 직접 참조로 테마 전환 시 자동 반영. */
const dashboardHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: "var(--accent)" },
  { tag: tags.atom, color: "var(--syn-atom, #e5c07b)" },
  { tag: tags.number, color: "var(--syn-number, #d19a66)" },
  { tag: tags.string, color: "var(--syn-string, #98c379)" },
  { tag: tags.bool, color: "var(--syn-number, #d19a66)" },
  { tag: tags.null, color: "var(--muted)", fontStyle: "italic" },
  { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
  { tag: tags.meta, color: "var(--syn-meta, #c678dd)" },
  { tag: tags.propertyName, color: "var(--syn-property, #61afef)" },
  { tag: tags.punctuation, color: "var(--muted)" },
]));

interface YamlEditorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function YamlEditor({ value, onChange, className }: YamlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        foldGutter(),
        yaml(),
        dashboardTheme,
        dashboardHighlight,
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
        updateListener,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={containerRef} className={`yaml-editor ${className || ""}`} />;
}
