"use client";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CellOutput, type Notebook, type NotebookCell } from "@/lib/api";
import { useCatalogWords } from "@/lib/completions";
import { formatSql } from "@/lib/highlight";
import CodeEditor from "@/components/CodeEditor";
import ResultPanel from "@/components/ResultPanel";
import { useToast } from "@/components/Toast";
import { ErrorState, Icon, StatusBadge } from "@/components/ui";
import { CopyButton, Modal, Skeleton, useConfirm } from "@/components/kit";
import { download } from "@/lib/format";

const MAX_STORED_ROWS = 200;

/** A .ipynb that Jupyter opens: SQL cells become %%sql-tagged code so nothing is lost. */
function toIpynb(name: string, cells: Cell[]): string {
  return JSON.stringify({
    nbformat: 4, nbformat_minor: 5,
    metadata: { kernelspec: { name: "python3", display_name: "Python 3" }, windward: { name } },
    cells: cells.map((c) => ({
      cell_type: c.type === "markdown" ? "markdown" : "code",
      metadata: c.type === "sql" ? { windward_cell_type: "sql" } : {},
      source: (c.type === "sql" ? `%%sql\n${c.source}` : c.source).split("\n").map((l, i, a) => (i === a.length - 1 ? l : l + "\n")),
      ...(c.type === "markdown" ? {} : { execution_count: null, outputs: [] }),
    })),
  }, null, 1);
}

function toMarkdownDoc(name: string, cells: Cell[]): string {
  return [`# ${name}`, ...cells.map((c) =>
    c.type === "markdown" ? c.source : `\n\`\`\`${c.type}\n${c.source}\n\`\`\``)].join("\n\n");
}
type Cell = NotebookCell & { output?: (CellOutput & { count?: number }) | null };

function markdown(src: string): string {
  const esc = src.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const inline = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
  return esc.split("\n").map((line) => {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    if (/^\s*[-*]\s+/.test(line)) return `<div class="li">${inline(line.replace(/^\s*[-*]\s+/, ""))}</div>`;
    return line ? `<p>${inline(line)}</p>` : "";
  }).join("");
}

function Output({ out }: { out: NonNullable<Cell["output"]> }) {
  const r = out.result;
  return (
    <div className="nbout">
      {out.error && <pre className="errblock">{out.error}</pre>}
      {out.stdout && <pre className="nbstdout">{out.stdout}</pre>}
      {r?.type === "text" && <pre className="nbstdout">{r.text}</pre>}
      {r?.type === "table" && <ResultPanel maxHeight="320px" filename="cell" data={{ columns: r.columns, rows: r.rows,
        footer: `${r.truncated ? "truncated · " : ""}${out.durationMs != null ? `${out.durationMs.toFixed(0)} ms` : ""}` }} />}
    </div>
  );
}

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [nb, setNb] = useState<(Omit<Notebook, "cells"> & { cells: Cell[] }) | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [dirty, setDirty] = useState<"saved" | "saving" | "unsaved">("saved");
  const [editingMd, setEditingMd] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [vars, setVars] = useState<{ live: boolean; variables: { name: string; type: string; detail: string }[] } | null>(null);
  const [showVars, setShowVars] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const confirm = useConfirm();
  const [counter, setCounter] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<typeof nb>(null);
  latest.current = nb;
  const words = useCatalogWords();

  useEffect(() => {
    api.notebook(id).then((n) => {
      setNb(n as typeof nb);
      setCounter(Math.max(0, ...n.cells.map((c) => (c.output as { count?: number } | null | undefined)?.count ?? 0)));
    }).catch(setError);
  }, [id]);

  const save = useCallback(async () => {
    const cur = latest.current;
    if (!cur) return;
    setDirty("saving");
    try {
      await api.saveNotebook(cur.id, cur.name, cur.cells);
      setDirty("saved");
    } catch {
      setDirty("unsaved");
    }
  }, []);

  const change = useCallback((fn: (n: NonNullable<typeof nb>) => NonNullable<typeof nb>) => {
    setNb((n) => (n ? fn(n) : n));
    setDirty("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
  }, [save]);

  const setCell = (cid: string, patch: Partial<Cell>) =>
    change((n) => ({ ...n, cells: n.cells.map((c) => (c.id === cid ? { ...c, ...patch } : c)) }));

  async function runCell(cell: Cell, advance = false) {
    if (cell.type === "markdown") { setEditingMd(null); return; }
    if (!cell.source.trim()) return;
    setRunning(cell.id);
    const count = counter + 1;
    setCounter(count);
    let output: Cell["output"];
    try {
      if (cell.type === "sql") {
        const q = await api.query(cell.source.trim().replace(/;+\s*$/, ""), MAX_STORED_ROWS);
        output = { count, durationMs: q.duration_ms, result: { type: "table", columns: q.columns.map((c) => c.name), rows: q.rows, truncated: q.truncated } };
      } else {
        const r = await api.runPython(id, cell.source);
        const res = r.result && r.result.type === "table" ? { ...r.result, rows: r.result.rows.slice(0, MAX_STORED_ROWS) } : r.result;
        output = { count, stdout: [r.stdout, r.stderr].filter(Boolean).join(""), error: r.error, durationMs: r.duration_ms, result: res };
      }
    } catch (e) {
      output = { count, error: (e as Error).message };
    }
    setCell(cell.id, { output });
    setRunning(null);
    if (advance) {
      const cells = latest.current?.cells ?? [];
      const next = cells[cells.findIndex((c) => c.id === cell.id) + 1];
      requestAnimationFrame(() => document.getElementById(`cell-${next?.id}`)?.querySelector("textarea")?.focus());
    }
  }

  async function runAll() {
    for (const c of latest.current?.cells ?? []) if (c.type !== "markdown") await runCell(c);
    toast("Ran all cells");
  }

  function add(type: NotebookCell["type"], after?: string) {
    const fresh: Cell = { id: crypto.randomUUID(), type, source: "" };
    change((n) => {
      const i = after ? n.cells.findIndex((c) => c.id === after) + 1 : n.cells.length;
      return { ...n, cells: [...n.cells.slice(0, i), fresh, ...n.cells.slice(i)] };
    });
    if (type === "markdown") setEditingMd(fresh.id);
    requestAnimationFrame(() => document.getElementById(`cell-${fresh.id}`)?.querySelector("textarea")?.focus());
  }

  function move(cid: string, dir: -1 | 1) {
    change((n) => {
      const cells = [...n.cells], i = cells.findIndex((c) => c.id === cid), j = i + dir;
      if (j < 0 || j >= cells.length) return n;
      [cells[i], cells[j]] = [cells[j], cells[i]];
      return { ...n, cells };
    });
  }

  const duplicate = (c: Cell) => change((n) => {
    const i = n.cells.findIndex((x) => x.id === c.id) + 1;
    return { ...n, cells: [...n.cells.slice(0, i), { ...c, id: crypto.randomUUID(), output: null }, ...n.cells.slice(i)] };
  });

  const refreshVars = useCallback(async () => {
    try { setVars(await api.kernelVariables(id)); } catch { setVars({ live: false, variables: [] }); }
  }, [id]);

  useEffect(() => {
    if (!showVars) return;
    refreshVars();
    const t = setInterval(refreshVars, 4000);
    return () => clearInterval(t);
  }, [showVars, refreshVars]);

  if (error) return <div className="page"><div className="card"><ErrorState title="Couldn't open this notebook" error={error.message} /></div></div>;
  if (!nb) return <div className="page"><Skeleton rows={6} height={26} /></div>;

  const Adder = ({ after }: { after?: string }) => (
    <div className="nbadd"><div className="nbadd-inner">
      {(["sql", "python", "markdown"] as const).map((t) => (
        <button key={t} className="btn ghost sm" onClick={() => add(t, after)}>+ {t === "markdown" ? "Text" : t.toUpperCase() === "SQL" ? "SQL" : "Python"}</button>))}
    </div></div>
  );

  return (
    <div className="nb">
      <div className="nbbar">
        <input className="nbtitle" aria-label="Notebook name" value={nb.name} onChange={(e) => change((n) => ({ ...n, name: e.target.value }))} />
        <div className="row-actions">
          <StatusBadge status={dirty === "saved" ? "success" : dirty === "saving" ? "running" : "warning"} label={dirty} />
          <span className={`kernel ${running ? "busy" : ""}`} title="Python kernel"><span className="dot" aria-hidden="true" /> {running ? "Kernel busy" : "Kernel idle"}</span>
          <button className="btn sm" onClick={() => setShowVars((v) => !v)} aria-pressed={showVars}>Variables</button>
          <div className="menu-wrap">
            <button className="btn sm" onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen}>Export ▾</button>
            {exportOpen && <div className="menu" onMouseLeave={() => setExportOpen(false)}>
              <button onClick={() => { download(`${nb.name}.ipynb`, toIpynb(nb.name, nb.cells), "application/json"); setExportOpen(false); }}>Jupyter (.ipynb)</button>
              <button onClick={() => { download(`${nb.name}.sql`, nb.cells.filter((c) => c.type === "sql").map((c) => c.source.trim().replace(/;*$/, ";")).join("\n\n"), "text/plain"); setExportOpen(false); }}>SQL only</button>
              <button onClick={() => { download(`${nb.name}.md`, toMarkdownDoc(nb.name, nb.cells), "text/markdown"); setExportOpen(false); }}>Markdown</button>
            </div>}
          </div>
          <button className="btn sm" onClick={async () => {
            if (await confirm({ title: "Restart the kernel?", body: "Python variables and imports are cleared. SQL cells are unaffected.", confirm: "Restart" })) {
              await api.restartKernel(id); setVars({ live: false, variables: [] }); toast("Kernel restarted");
            }
          }}>Restart kernel</button>
          <button className="btn sm" onClick={() => change((n) => ({ ...n, cells: n.cells.map((c) => ({ ...c, output: null })) }))}>Clear outputs</button>
          <button className="btn sm primary" onClick={runAll} disabled={running !== null}><Icon name="play" size={12} /> Run all</button>
        </div>
      </div>
      {showVars && (
        <div className="varbar">
          <div className="row-actions" style={{ marginBottom: 6 }}>
            <span className="label" style={{ flex: 1 }}>Kernel variables</span>
            <span className="caption">{vars?.live ? "kernel running" : "kernel not started"}</span>
            <button className="btn ghost sm" onClick={refreshVars}><Icon name="refresh" size={13} /></button>
            <button className="btn ghost sm" onClick={() => setShowVars(false)}>Hide</button>
          </div>
          {!vars ? <Skeleton rows={2} /> : vars.variables.length === 0
            ? <div className="caption">Nothing defined yet. Run a Python cell.</div>
            : <table className="tbl"><tbody>{vars.variables.map((v) => (
                <tr key={v.name}><td className="mono" style={{ width: 160 }}>{v.name}</td>
                  <td className="caption" style={{ width: 120 }}>{v.type}</td>
                  <td className="mono caption">{v.detail}</td></tr>))}</tbody></table>}
        </div>)}
      <div className="nbcells">
        {nb.cells.map((c) => {
          const state = running === c.id ? "running" : c.output?.error ? "err" : c.output ? "ok" : "";
          const hidden = collapsed.has(c.id);
          return (
            <div key={c.id}>
              <div id={`cell-${c.id}`} className={`nbcell ${state}`}>
                <div className="nbgutter">
                  {c.type !== "markdown" ? (
                    <button className="runbtn" aria-label="Run cell" disabled={running !== null} onClick={() => runCell(c)}>
                      {running === c.id ? <span className="spin" aria-hidden="true" /> : <Icon name="play" size={14} />}
                    </button>) : <span style={{ height: 28 }} />}
                  <span className="count">{c.type === "markdown" ? "" : running === c.id ? "[*]" : c.output?.count ? `[${c.output.count}]` : "[ ]"}</span>
                </div>
                <div className="nbmain">
                  <div className="nbtools">
                    <select className="nbtype" aria-label="Cell type" value={c.type} onChange={(e) => setCell(c.id, { type: e.target.value as Cell["type"], output: null })}>
                      <option value="sql">SQL</option><option value="python">Python</option><option value="markdown">Text</option>
                    </select>
                    {c.output?.durationMs != null && <span className={`caption ${state === "err" ? "bad" : ""}`}>{state === "err" ? "Failed" : "Ran"} in {c.output.durationMs.toFixed(0)} ms</span>}
                    <div style={{ flex: 1 }} />
                    <div className="nbactions">
                      {c.type === "sql" && <button className="btn ghost sm" onClick={() => setCell(c.id, { source: formatSql(c.source) })}>Format</button>}
                      <CopyButton small label="Copy" text={c.source} />
                      {c.output && <button className="btn ghost sm" onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}>{hidden ? "Show output" : "Hide output"}</button>}
                      <button className="btn ghost sm" aria-label="Move up" onClick={() => move(c.id, -1)}>↑</button>
                      <button className="btn ghost sm" aria-label="Move down" onClick={() => move(c.id, 1)}>↓</button>
                      <button className="btn ghost sm" onClick={() => duplicate(c)}>Duplicate</button>
                      <button className="btn ghost sm" aria-label="Delete cell" onClick={() => change((n) => ({ ...n, cells: n.cells.filter((x) => x.id !== c.id) }))}>Delete</button>
                    </div>
                  </div>
                  {c.type === "markdown" && editingMd !== c.id
                    ? <div className="md" onDoubleClick={() => setEditingMd(c.id)} title="Double-click to edit"
                        dangerouslySetInnerHTML={{ __html: markdown(c.source) || "<span class='caption'>Empty text cell — double-click to edit</span>" }} />
                    : <CodeEditor language={c.type === "markdown" ? "markdown" : c.type} value={c.source} minLines={2} maxLines={24}
                        ariaLabel={`${c.type} cell`} autoFocus={editingMd === c.id} shiftEnterRuns
                        completions={c.type === "sql" ? words : []} onChange={(source) => setCell(c.id, { source })}
                        onRun={() => runCell(c, true)} onBlur={() => c.type === "markdown" && setEditingMd(null)}
                        placeholder={c.type === "sql" ? "select * from demo.route_summary" : c.type === "python" ? "spark.sql('select 1').show()" : "# Write notes in Markdown"} />}
                  {c.output && !hidden && <Output out={c.output} />}
                </div>
              </div>
              <Adder after={c.id} />
            </div>);
        })}
        {nb.cells.length === 0 && <div className="state"><Icon name="notebook" size={44} /><div className="primary">This notebook is empty</div><Adder /></div>}
      </div>
    </div>
  );
}
