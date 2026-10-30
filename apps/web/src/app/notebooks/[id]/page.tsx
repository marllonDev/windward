"use client";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CellOutput, type Notebook, type NotebookCell } from "@/lib/api";
import ResultPanel from "@/components/ResultPanel";
import { ErrorState, Icon, PageHead, StatusBadge } from "@/components/ui";

const MAX_STORED_ROWS = 200;

function markdown(src: string): string {
  const esc = src.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return esc.split("\n").map((line) => {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const inline = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
    if (h) return `<h${h[1].length} style="margin:8px 0 4px">${inline(h[2])}</h${h[1].length}>`;
    if (/^\s*[-*]\s+/.test(line)) return `<div>• ${inline(line.replace(/^\s*[-*]\s+/, ""))}</div>`;
    return line ? `<p style="margin:4px 0">${inline(line)}</p>` : "";
  }).join("");
}

function Output({ out }: { out: CellOutput }) {
  const r = out.result;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      {out.error && <pre className="errblock">{out.error}</pre>}
      {out.stdout && <pre className="log" style={{ margin: 0, minHeight: 0 }}>{out.stdout}</pre>}
      {r?.type === "text" && <pre className="log" style={{ margin: 0, minHeight: 0 }}>{r.text}</pre>}
      {r?.type === "table" && <ResultPanel maxHeight="320px" data={{ columns: r.columns, rows: r.rows,
        footer: `${r.truncated ? "truncated · " : ""}${out.durationMs != null ? `${out.durationMs.toFixed(0)} ms` : ""}` }} />}
    </div>
  );
}

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const [nb, setNb] = useState<Notebook | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [dirty, setDirty] = useState<"saved" | "saving" | "unsaved">("saved");
  const [editingMd, setEditingMd] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Notebook | null>(null);
  latest.current = nb;

  useEffect(() => {
    api.notebook(id).then(setNb).catch(setError);
  }, [id]);

  const save = useCallback(async () => {
    const current = latest.current;
    if (!current) return;
    setDirty("saving");
    try {
      await api.saveNotebook(current.id, current.name, current.cells);
      setDirty("saved");
    } catch {
      setDirty("unsaved");
    }
  }, []);

  const change = useCallback((fn: (n: Notebook) => Notebook) => {
    setNb((n) => (n ? fn(n) : n));
    setDirty("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
  }, [save]);

  const setCell = (cid: string, patch: Partial<NotebookCell>) =>
    change((n) => ({ ...n, cells: n.cells.map((c) => (c.id === cid ? { ...c, ...patch } : c)) }));

  async function runCell(cell: NotebookCell) {
    if (cell.type === "markdown") { setEditingMd(null); return; }
    setRunning(cell.id);
    let output: CellOutput;
    try {
      if (cell.type === "sql") {
        const q = await api.query(cell.source.trim().replace(/;+\s*$/, ""), MAX_STORED_ROWS);
        output = { durationMs: q.duration_ms, result: { type: "table", columns: q.columns.map((c) => c.name), rows: q.rows, truncated: q.truncated } };
      } else {
        const r = await api.runPython(id, cell.source);
        const res = r.result && r.result.type === "table" ? { ...r.result, rows: r.result.rows.slice(0, MAX_STORED_ROWS) } : r.result;
        output = { stdout: [r.stdout, r.stderr].filter(Boolean).join(""), error: r.error, durationMs: r.duration_ms, result: res };
      }
    } catch (e) {
      output = { error: (e as Error).message };
    }
    setCell(cell.id, { output });
    setRunning(null);
  }

  async function runAll() {
    for (const c of latest.current?.cells ?? []) if (c.type !== "markdown") await runCell(c);
  }

  function add(type: NotebookCell["type"], after?: string) {
    const fresh: NotebookCell = { id: crypto.randomUUID(), type, source: "" };
    change((n) => {
      const i = after ? n.cells.findIndex((c) => c.id === after) + 1 : n.cells.length;
      return { ...n, cells: [...n.cells.slice(0, i), fresh, ...n.cells.slice(i)] };
    });
    if (type === "markdown") setEditingMd(fresh.id);
  }

  function move(cid: string, dir: -1 | 1) {
    change((n) => {
      const cells = [...n.cells], i = cells.findIndex((c) => c.id === cid), j = i + dir;
      if (j < 0 || j >= cells.length) return n;
      [cells[i], cells[j]] = [cells[j], cells[i]];
      return { ...n, cells };
    });
  }

  if (error) return <div className="page"><div className="card"><ErrorState title="Couldn't open this notebook" error={error.message} /></div></div>;
  if (!nb) return <div className="page"><div className="caption">Loading…</div></div>;

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <PageHead title={nb.name} subtitle="SQL cells query Sail; Python cells share one kernel with `spark` ready."
        actions={<>
          <StatusBadge status={dirty === "saved" ? "success" : dirty === "saving" ? "running" : "warning"} label={dirty} />
          <input className="input" aria-label="Notebook name" style={{ width: 200 }} value={nb.name}
            onChange={(e) => change((n) => ({ ...n, name: e.target.value }))} />
          <button className="btn" onClick={() => api.restartKernel(id)} title="Clears Python variables">Restart kernel</button>
          <button className="btn primary" onClick={runAll} disabled={running !== null}><Icon name="play" size={13} /> Run all</button>
        </>} />
      {nb.cells.map((c) => (
        <div key={c.id} className="card pad">
          <div className="row-actions" style={{ marginBottom: 8 }}>
            <span className="badge idle">{c.type}</span>
            {c.type !== "markdown" && <button className="btn sm primary" disabled={running !== null} onClick={() => runCell(c)}>
              <Icon name="play" size={12} /> {running === c.id ? "Running…" : "Run"}</button>}
            <div style={{ flex: 1 }} />
            <button className="btn ghost sm" aria-label="Move up" onClick={() => move(c.id, -1)}>↑</button>
            <button className="btn ghost sm" aria-label="Move down" onClick={() => move(c.id, 1)}>↓</button>
            <button className="btn ghost sm" aria-label="Delete cell" onClick={() => change((n) => ({ ...n, cells: n.cells.filter((x) => x.id !== c.id) }))}>Delete</button>
          </div>
          {c.type === "markdown" && editingMd !== c.id
            ? <div onDoubleClick={() => setEditingMd(c.id)} title="Double-click to edit"
                dangerouslySetInnerHTML={{ __html: markdown(c.source) || "<span class='caption'>Empty note — double-click to edit</span>" }} />
            : <textarea className="input mono" aria-label={`${c.type} cell`} spellCheck={false} value={c.source}
                rows={Math.max(3, c.source.split("\n").length + 1)} autoFocus={editingMd === c.id}
                style={{ height: "auto", padding: 10, resize: "vertical", lineHeight: "20px" }}
                onChange={(e) => setCell(c.id, { source: e.target.value })}
                onBlur={() => c.type === "markdown" && setEditingMd(null)}
                onKeyDown={(e) => { if (e.shiftKey && e.key === "Enter") { e.preventDefault(); runCell(c); } }} />}
          {c.output && <Output out={c.output} />}
          <div className="row-actions" style={{ marginTop: 8 }}>
            <span className="caption">Add below:</span>
            {(["sql", "python", "markdown"] as const).map((t) => (
              <button key={t} className="btn ghost sm" onClick={() => add(t, c.id)}>+ {t}</button>))}
          </div>
        </div>))}
      {nb.cells.length === 0 && <div className="row-actions">
        {(["sql", "python", "markdown"] as const).map((t) => <button key={t} className="btn" onClick={() => add(t)}>+ {t} cell</button>)}</div>}
    </div>
  );
}
