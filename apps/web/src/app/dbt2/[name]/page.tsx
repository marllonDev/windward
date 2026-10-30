"use client";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Dbt2Run } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import CodeEditor from "@/components/CodeEditor";
import Dag from "@/components/Dag";
import ResultPanel from "@/components/ResultPanel";
import { useToast } from "@/components/Toast";
import { EmptyState, ErrorState, Icon, PageHead, StatusBadge } from "@/components/ui";
import { CopyButton, Modal, Segmented, Skeleton, useConfirm } from "@/components/kit";
import type { Language } from "@/lib/highlight";

const COMMANDS = ["parse", "compile", "seed", "run", "test", "build"] as const;
const langOf = (p: string): Language => /\.sql$/.test(p) ? "sql" : /\.ya?ml$/.test(p) ? "yaml" : /\.md$/.test(p) ? "markdown" : /\.py$/.test(p) ? "python" : "plain";

export default function Dbt2Project() {
  const { name } = useParams<{ name: string }>();
  const toast = useToast();
  const files = usePoll(() => api.dbt2Files(name), 6000);
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [panel, setPanel] = useState<"run" | "lineage" | "data" | "compiled">("run");
  const [run, setRun] = useState<Dbt2Run | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [select, setSelect] = useState("");
  const [sql, setSql] = useState("select * from customer_orders limit 100");
  const [data, setData] = useState<{ columns: string[]; rows: unknown[][]; truncated: boolean } | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [compiled, setCompiled] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [hits, setHits] = useState<{ path: string; line: number; text: string }[] | null>(null);
  const [newFile, setNewFile] = useState<string | null>(null);
  const confirm = useConfirm();
  const offset = useRef(0);
  const logEl = useRef<HTMLDivElement>(null);
  const graph = usePoll(() => api.dbt2Graph(name), 10000);
  const tables = usePoll(() => api.dbt2Tables(name), 10000);
  const dirty = path !== null && content !== saved;

  useEffect(() => {
    if (!path && files.data?.length) setPath(files.data.find((f) => f.path.endsWith("customer_orders.sql"))?.path ?? files.data[0].path);
  }, [files.data, path]);
  useEffect(() => {
    if (!path) return;
    api.dbt2Read(name, path).then((r) => { setContent(r.content); setSaved(r.content); }).catch((e) => toast((e as Error).message, "error"));
  }, [name, path, toast]);

  const save = useCallback(async () => {
    if (!path || !dirty) return;
    try { await api.dbt2Write(name, path, content); setSaved(content); toast(`Saved ${path}`); } catch (e) { toast((e as Error).message, "error"); }
  }, [name, path, content, dirty, toast]);

  const running = run?.status === "running";
  useEffect(() => {
    if (!run || !running) return;
    const t = setInterval(async () => {
      try {
        const next = await api.dbt2Run(run.run_id, offset.current);
        offset.current = next.log_total;
        setLog((l) => [...l, ...next.log]);
        setRun(next);
        if (next.status !== "running") { graph.refresh(); tables.refresh(); }
      } catch { /* the next tick retries */ }
    }, 900);
    return () => clearInterval(t);
  }, [run, running, graph, tables]);
  useEffect(() => { logEl.current?.scrollTo({ top: logEl.current.scrollHeight }); }, [log]);

  async function start(command: string) {
    if (dirty) await save();
    try {
      const r = await api.dbt2Start(name, command, select || undefined);
      offset.current = 0; setLog([]); setRun(r); setPanel("run");
    } catch (e) { toast((e as Error).message, "error"); }
  }

  async function query(text: string) {
    setDataError(null);
    try { setData(await api.dbt2Query(name, text)); } catch (e) { setData(null); setDataError((e as Error).message); }
  }

  const tree = useMemo(() => {
    const groups = new Map<string, string[]>();
    (files.data ?? []).forEach((f) => { const i = f.path.lastIndexOf("/"); const d = i < 0 ? "" : f.path.slice(0, i); groups.set(d, [...(groups.get(d) ?? []), f.path]); });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [files.data]);
  const statusOf = (id: string) => run?.nodes.find((n) => n.unique_id === id)?.status;

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <PageHead title={name} subtitle="dbt 2 · DuckDB · independent from Sail"
        actions={<>
          {COMMANDS.map((c) => <button key={c} className={`btn sm${c === "build" ? " primary" : ""}`} disabled={running} onClick={() => start(c)}><Icon name="play" size={12} /> dbt {c}</button>)}
        </>} />
      <div className="ide">
        <div className="card ide-tree tree">
          <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="row-actions">
              <span className="label" style={{ flex: 1 }}>Files</span>
              <button className="btn ghost sm" onClick={() => setNewFile("models/")}>+ New</button>
            </div>
            <input className="input" placeholder="Search in project" aria-label="Search in project" value={find}
              onChange={async (e) => {
                setFind(e.target.value);
                if (e.target.value.trim().length < 2) { setHits(null); return; }
                try { setHits(await api.dbt2Search(name, e.target.value.trim())); } catch { setHits([]); }
              }} />
          </div>
          {hits && <div className="searchhits">
            {hits.length === 0 ? <div className="caption" style={{ padding: 8 }}>No matches.</div>
              : hits.slice(0, 40).map((h, i) => (
                <button key={i} className="row" onClick={() => { setPath(h.path); setHits(null); setFind(""); }}>
                  <span style={{ minWidth: 0 }}><span className="mono clip">{h.path}:{h.line}</span>
                    <span className="caption clip">{h.text}</span></span></button>))}
          </div>}
          {tree.map(([dir, items]) => (
            <div key={dir}>
              {dir && <div className="caption" style={{ padding: "6px 12px 2px" }}>{dir}/</div>}
              {items.map((p) => (
                <button key={p} className={`row ide-file${p === path ? " selected" : ""}`} onClick={() => setPath(p)}>
                  <Icon name="table" size={14} /> <span className="mono clip">{p.slice(dir ? dir.length + 1 : 0)}</span></button>))}
            </div>))}
        </div>
        <div className="ide-main">
          <div className="row-actions">
            <span className="mono">{path ?? "Select a file"}</span>{dirty && <span className="caption">● unsaved</span>}
            <div style={{ flex: 1 }} />
            <button className="btn sm" disabled={!dirty} onClick={save}>Save</button>
            <CopyButton small text={content} />
            <button className="btn ghost sm" disabled={!path} onClick={async () => {
              if (path && await confirm({ title: `Delete ${path}?`, confirm: "Delete", danger: true })) {
                await api.dbt2DeleteFile(name, path); setPath(null); files.refresh();
              }
            }}>Delete</button>
          </div>
          {path ? <CodeEditor key={path} language={langOf(path)} value={content} onChange={setContent} onSave={save} minLines={14} maxLines={30} ariaLabel={`Editing ${path}`} />
            : <div className="card"><EmptyState icon="table" title="Pick a file to edit" /></div>}
          <Segmented size="sm" value={panel} onChange={(v) => {
            setPanel(v);
            if (v === "compiled" && path) api.dbt2Compiled(name, path).then((r) => setCompiled(r.content)).catch((e) => setCompiled(`-- ${(e as Error).message}`));
          }} options={[
            { value: "run", label: "Run & logs" }, { value: "compiled", label: "Compiled SQL" },
            { value: "lineage", label: "Lineage" }, { value: "data", label: "Data (DuckDB)" }]} />
          {panel === "run" && <>
            <div className="row-actions"><input className="input mono" style={{ maxWidth: 260 }} placeholder="--select (e.g. stg_orders+)" aria-label="dbt select" value={select} onChange={(e) => setSelect(e.target.value)} />
              {run && <StatusBadge status={run.status} label={`${run.command} ${run.status}`} />}</div>
            <div className="log" ref={logEl} role="log">{log.length ? log.join("\n") : "Run a dbt 2 command to see its output."}</div>
          </>}
          {panel === "compiled" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="row-actions"><span className="caption">Jinja resolved by dbt. Run compile or build to refresh it.</span>
                <div style={{ flex: 1 }} />{compiled && <CopyButton small text={compiled} />}</div>
              {compiled === null ? <Skeleton rows={4} /> : <CodeEditor language="sql" value={compiled} onChange={() => undefined} readOnly minLines={10} maxLines={26} ariaLabel="Compiled SQL" />}
            </div>)}
          {panel === "lineage" && (graph.error && !graph.data ? <ErrorState title="Couldn't read the graph" error={graph.error.message} />
            : !graph.data?.parsed ? <div className="card"><EmptyState icon="dbt" title="No graph yet" hint="Run dbt parse or dbt build to generate the manifest." /></div>
            : <Dag nodes={graph.data.nodes.map((n) => ({ id: n.unique_id, label: n.name, sub: `${n.resource_type}${n.materialized ? ` · ${n.materialized}` : ""}`, status: statusOf(n.unique_id), deps: n.depends_on }))} />)}
          {panel === "data" && <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="row-actions">{(tables.data ?? []).length === 0 ? <span className="caption">No tables yet — run dbt build.</span>
              : (tables.data ?? []).map((t) => <button key={`${t.schema}.${t.name}`} className="btn sm" onClick={() => { const q = `select * from ${t.schema}.${t.name} limit 100`; setSql(q); query(q); }}>{t.schema}.{t.name}</button>)}</div>
            <CodeEditor language="sql" value={sql} onChange={setSql} onRun={() => query(sql)} minLines={3} maxLines={8} ariaLabel="DuckDB SQL" />
            <div><button className="btn primary sm" onClick={() => query(sql)}><Icon name="play" size={12} /> Run on DuckDB</button></div>
            {dataError ? <pre className="errblock">{dataError}</pre> : data ? <ResultPanel data={{ columns: data.columns, rows: data.rows, footer: data.truncated ? "truncated" : "DuckDB" }} /> : null}
          </div>}
        </div>
      </div>
      {newFile !== null && (
        <Modal title="New file" onClose={() => setNewFile(null)}
          footer={<><button className="btn" onClick={() => setNewFile(null)}>Cancel</button>
            <button className="btn primary" onClick={async () => {
              try { await api.dbt2Write(name, newFile, ""); await files.refresh(); setPath(newFile); setNewFile(null); }
              catch (e) { toast((e as Error).message, "error"); }
            }}>Create</button></>}>
          <label className="field"><span className="field-label">Path inside the project</span>
            <input className="input mono" autoFocus value={newFile} onChange={(e) => setNewFile(e.target.value)} /></label>
          <span className="caption">For example <span className="mono">models/marts/orders.sql</span> or <span className="mono">models/schema.yml</span>.</span>
        </Modal>)}
    </div>
  );
}
