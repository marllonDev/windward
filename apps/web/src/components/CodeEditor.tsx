"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { SQL_FUNCTIONS, SQL_KEYWORDS, tokenize, type Language } from "@/lib/highlight";

const LINE = 20;
const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "'": "'", '"': '"', "`": "`" };
const COMMENT: Record<string, string> = { sql: "-- ", python: "# ", yaml: "# " };

export type CodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  language?: Language;
  onRun?: () => void;
  onSave?: () => void;
  /** Table, schema and column names offered besides the language keywords. */
  completions?: string[];
  placeholder?: string;
  ariaLabel?: string;
  minLines?: number;
  maxLines?: number;
  autoFocus?: boolean;
  readOnly?: boolean;
  onBlur?: () => void;
  /** Run on Shift+Enter (notebook cells) in addition to Ctrl/⌘+Enter. */
  shiftEnterRuns?: boolean;
};

export default function CodeEditor({
  value, onChange, language = "sql", onRun, onSave, completions = [], placeholder, ariaLabel = "Code editor",
  minLines = 5, maxLines = 28, autoFocus, readOnly, onBlur, shiftEnterRuns,
}: CodeEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<{ items: string[]; index: number; line: number; col: number; start: number } | null>(null);

  const dictionary = useMemo(() => {
    const words = new Set<string>(completions);
    if (language === "sql") {
      SQL_KEYWORDS.forEach((k) => words.add(k.toUpperCase()));
      SQL_FUNCTIONS.forEach((f) => words.add(f));
    }
    return [...words];
  }, [completions, language]);

  const tokens = useMemo(() => tokenize(value + "\n", language), [value, language]);
  const lines = value.split("\n").length;
  const height = Math.min(Math.max(lines, minLines), maxLines) * LINE + 20;

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  function syncScroll() {
    const a = area.current;
    if (!a) return;
    if (pre.current) { pre.current.scrollTop = a.scrollTop; pre.current.scrollLeft = a.scrollLeft; }
    if (gutter.current) gutter.current.scrollTop = a.scrollTop;
  }

  function edit(next: string, caret: number) {
    onChange(next);
    requestAnimationFrame(() => {
      const a = area.current;
      if (a) { a.selectionStart = a.selectionEnd = caret; }
    });
  }

  function suggest(text: string, caret: number) {
    const before = text.slice(0, caret);
    const m = /[A-Za-z_][\w.]*$/.exec(before);
    if (!m || m[0].length < 2 || readOnly) { setPopup(null); return; }
    const word = m[0].toLowerCase();
    const items = dictionary.filter((w) => w.toLowerCase().startsWith(word) && w.toLowerCase() !== word).slice(0, 8);
    if (items.length === 0) { setPopup(null); return; }
    const upTo = before.split("\n");
    setPopup({ items, index: 0, line: upTo.length - 1, col: upTo[upTo.length - 1].length - m[0].length, start: caret - m[0].length });
  }

  function accept(item: string) {
    const a = area.current;
    if (!a || !popup) return;
    const caret = a.selectionStart;
    edit(value.slice(0, popup.start) + item + value.slice(caret), popup.start + item.length);
    setPopup(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const a = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;
    if (popup) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setPopup({ ...popup, index: (popup.index + d + popup.items.length) % popup.items.length });
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !mod && !e.shiftKey)) { e.preventDefault(); accept(popup.items[popup.index]); return; }
      if (e.key === "Escape") { setPopup(null); return; }
    }
    if (mod && e.key === "Enter") { e.preventDefault(); onRun?.(); return; }
    if (shiftEnterRuns && e.shiftKey && e.key === "Enter") { e.preventDefault(); onRun?.(); return; }
    if (mod && e.key.toLowerCase() === "s" && onSave) { e.preventDefault(); onSave(); return; }
    const { selectionStart: s, selectionEnd: end } = a;
    if (mod && e.key === "/" && COMMENT[language]) {
      e.preventDefault();
      const from = value.lastIndexOf("\n", s - 1) + 1;
      const to = end === s || value[end - 1] !== "\n" ? (value.indexOf("\n", end) < 0 ? value.length : value.indexOf("\n", end)) : end - 1;
      const block = value.slice(from, to).split("\n");
      const marker = COMMENT[language];
      const all = block.every((l) => l.trim() === "" || l.trimStart().startsWith(marker.trim()));
      const next = block.map((l) => (all ? l.replace(marker.trim() + " ", "").replace(marker.trim(), "") : l.trim() ? marker + l : l)).join("\n");
      edit(value.slice(0, from) + next + value.slice(to), from + next.length);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (s !== end || e.shiftKey) {
        const from = value.lastIndexOf("\n", s - 1) + 1;
        const block = value.slice(from, end).split("\n");
        const next = block.map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, "") : "  " + l)).join("\n");
        edit(value.slice(0, from) + next + value.slice(end), from + next.length);
      } else {
        edit(value.slice(0, s) + "  " + value.slice(end), s + 2);
      }
      return;
    }
    if (e.key === "Enter" && !mod && !e.shiftKey) {
      const indent = /^[ \t]*/.exec(value.slice(value.lastIndexOf("\n", s - 1) + 1, s))![0];
      const extra = language === "python" && /:\s*$/.test(value.slice(0, s).split("\n").pop() ?? "") ? "  " : "";
      e.preventDefault();
      edit(value.slice(0, s) + "\n" + indent + extra + value.slice(end), s + 1 + indent.length + extra.length);
      return;
    }
    if (PAIRS[e.key] && !mod && s !== end) {
      e.preventDefault();
      edit(value.slice(0, s) + e.key + value.slice(s, end) + PAIRS[e.key] + value.slice(end), end + 2);
      return;
    }
    if (PAIRS[e.key] && !mod && /^["'`]$/.test(e.key) === false) {
      e.preventDefault();
      edit(value.slice(0, s) + e.key + PAIRS[e.key] + value.slice(end), s + 1);
      return;
    }
    if (e.key === ")" || e.key === "]" || e.key === "}") {
      if (value[s] === e.key) { e.preventDefault(); edit(value, s + 1); }
    }
  }

  return (
    <div className="code" style={{ height }}>
      <div className="code-gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
      </div>
      <div className="code-body">
        <pre className="code-pre" ref={pre} aria-hidden="true">
          {tokens.map((t, i) => (t.kind ? <span key={i} className={`tok-${t.kind}`}>{t.text}</span> : t.text))}
        </pre>
        <textarea
          ref={area} className="code-area" aria-label={ariaLabel} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          value={value} placeholder={placeholder} readOnly={readOnly} wrap="off"
          onChange={(e) => { onChange(e.target.value); suggest(e.target.value, e.target.selectionStart); }}
          onKeyDown={onKeyDown} onScroll={syncScroll} onBlur={() => { setPopup(null); onBlur?.(); }}
          onClick={() => setPopup(null)}
        />
        {popup && (
          <ul className="code-popup" role="listbox" style={{ top: 10 + (popup.line + 1) * LINE - (area.current?.scrollTop ?? 0), left: `calc(12px + ${popup.col}ch)` }}>
            {popup.items.map((item, i) => (
              <li key={item} role="option" aria-selected={i === popup.index} className={i === popup.index ? "on" : ""}
                onMouseDown={(e) => { e.preventDefault(); accept(item); }}>{item}</li>))}
          </ul>)}
      </div>
    </div>
  );
}
