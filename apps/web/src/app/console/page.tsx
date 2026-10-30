"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type QueryResult, type SavedQuery } from "@/lib/api";
import { useCatalogWords } from "@/lib/completions";
import { duration } from "@/lib/format";
import { formatSql } from "@/lib/highlight";
import { addHistory, loadHistory, type HistoryEntry } from "@/lib/history";
import CatalogTree from "@/components/CatalogTree";
import CodeEditor from "@/components/CodeEditor";
import ResultPanel from "@/components/ResultPanel";
import { Field, Modal, Segmented, useConfirm } from "@/components/kit";
import { useToast } from "@/components/Toast";
import { EmptyState, ErrorState, Icon, PageHead } from "@/components/ui";

type Tab = { id: string; name: string; sql: string; savedId?: string };
type Panel = { result?: QueryResult; plan?: string; error?: string; elapsed?: number };
const KEY = "windward.tabs.v1";
const fresh = (n: number): Tab => ({ id: crypto.randomUUID(), name: `Query ${n}`, sql: "" });

export default function Console() {
  const toast = useToast();
  const confirm = useConfirm();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState("");
  const [panels, setPanels] = useState<Record<string, Panel>>({});
  const [runningId, setRunningId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [side, setSide] = useState<"catalog" | "saved" | "history">("catalog");
  const [recent, setRecent] = useState<HistoryEntry[]>([]);
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const words = useCatalogWords();

  const loadSaved = useCallback(() => api.savedQueries().then(setSaved).catch(() => undefined), []);

  useEffect(() => {
    let stored: Tab[] = [];
    try {
      stored = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      const pending = sessionStorage.getItem("windward.rerun");
      if (pending) {
        sessionStorage.removeItem("windward.rerun");
        stored.push({ id: crypto.randomUUID(), name: "From history", sql: pending });
      }
    } catch { /* storage unavailable: start with an empty tab */ }
    if (stored.length === 0) stored = [{ ...fresh(1), sql: "select * from demo.route_summary order by total_fare desc;" }];
    setTabs(stored);
    setActive(stored[stored.length - 1].id);
    loadSaved();
  }, [loadSaved]);

  useEffect(() => {
    if (tabs.length === 0) return;
    try { localStorage.setItem(KEY, JSON.stringify(tabs)); } catch { /* ignore */ }
  }, [tabs]);

  useEffect(() => {
    if (!runningId) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - started), 100);
    return () => clearInterval(t);
  }, [runningId]);

  const tab = tabs.find((t) => t.id === active);
  const patch = (changes: Partial<Tab>) => setTabs((ts) => ts.map((t) => (t.id === active ? { ...t, ...changes } : t)));
  const setPanel = (id: string, p: Panel) => setPanels((x) => ({ ...x, [id]: p }));

  function selectedOrAll(): string {
    const area = editorRef.current?.querySelector("textarea");
    if (area && area.selectionStart !== area.selectionEnd) return area.value.slice(area.selectionStart, area.selectionEnd);
    return tab?.sql ?? "";
  }

  async function execute(text: string, explain = false) {
    const sql = text.trim().replace(/;+\s*$/, "");
    if (runningId || !sql || !tab) return;
    const id = tab.id;
    const started = Date.now();
    setRunningId(id);
    setPanel(id, {});
    try {
      const r = await api.query(explain ? `EXPLAIN ${sql}` : sql);
      if (explain) setPanel(id, { plan: r.rows.map((row) => row.join("\n")).join("\n") });
      else {
        setPanel(id, { result: r, elapsed: Date.now() - started });
        addHistory({ sql, status: "succeeded", durationMs: r.duration_ms, rows: r.row_count, error: null });
      }
    } catch (e) {
      const err = e as { code?: string; message: string };
      setPanel(id, { error: `${err.code ?? "ERROR"}\n${err.message}` });
      if (err.code === "QUERY_CANCELLED") toast("Query cancelled");
      else if (!explain) addHistory({ sql, status: "failed", durationMs: null, rows: null, error: err.message });
    } finally {
      setRunningId(null);
    }
  }

  async function cancel() {
    const running = await api.runningQueries().catch(() => []);
    if (running.length === 0) { toast("Nothing is running on the engine"); return; }
    await Promise.all(running.map((q) => api.cancelQuery(q.query_id)));
  }

  async function save(nameFromDialog?: string) {
    if (!tab?.sql.trim()) return;
    const name = nameFromDialog ?? tab.name;
    const q = await api.saveQuery(name, tab.sql, tab.savedId);
    patch({ name, savedId: q.id });
    loadSaved();
    toast(`Saved “${name}”`);
  }

  function close(id: string) {
    setTabs((ts) => {
      const next = ts.filter((t) => t.id !== id);
      const list = next.length ? next : [fresh(1)];
      if (id === active) setActive(list[list.length - 1].id);
      return list;
    });
  }

  const panel = tab ? panels[tab.id] ?? {} : {};
  return (
    <div className="page">
      <PageHead title="SQL console" subtitle="Spark SQL on the Sail engine."
        actions={<>
          <button className="btn" onClick={() => tab && patch({ sql: formatSql(tab.sql) })} disabled={!tab?.sql.trim()} title="Uppercase keywords and break clauses">Format</button>
          <button className="btn" onClick={() => execute(selectedOrAll(), true)} disabled={!!runningId}>Explain</button>
          <button className="btn" onClick={() => setSaveAs(tab?.name ?? "Query")}>Save</button>
          {runningId
            ? <button className="btn danger" onClick={cancel}>Cancel ({(elapsed / 1000).toFixed(1)}s)</button>
            : <button className="btn primary" onClick={() => execute(selectedOrAll())}><Icon name="play" size={14} /> Run</button>}
        </>} />
      <div className="split">
        <div className="card pad side">
          <Segmented size="sm" value={side} onChange={(v) => { setSide(v); if (v === "saved") loadSaved(); if (v === "history") setRecent(loadHistory().slice(0, 40)); }}
            options={[{ value: "catalog", label: "Catalog" }, { value: "saved", label: "Saved" }, { value: "history", label: "History" }]} />
          <div className="side-body">
            {side === "catalog" && <CatalogTree selected={null} onSelect={(s) => s && patch({ sql: `select * from ${s.db}.${s.table} limit 100;` })} />}
            {side === "saved" && (saved.length === 0 ? <div className="caption">No saved queries yet. Press Save.</div>
              : <div className="tree">{saved.map((q) => (
                  <div key={q.id} style={{ display: "flex" }}>
                    <button className="row" title={q.sql} style={{ flex: 1, minWidth: 0 }} onClick={() => {
                      const t = { id: crypto.randomUUID(), name: q.name, sql: q.sql, savedId: q.id };
                      setTabs((ts) => [...ts, t]); setActive(t.id);
                    }}><Icon name="terminal" size={14} /><span className="clip">{q.name}</span></button>
                    <button className="btn ghost sm" aria-label={`Delete ${q.name}`} onClick={async () => {
                      if (await confirm({ title: `Delete “${q.name}”?`, confirm: "Delete", danger: true })) { await api.deleteQuery(q.id); loadSaved(); }
                    }}>✕</button>
                  </div>))}</div>)}
            {side === "history" && (recent.length === 0 ? <div className="caption">Nothing run yet.</div>
              : <div className="tree">{recent.map((h) => (
                  <button key={h.id} className="row hist" title={`${h.sql}\n${h.error ?? ""}`} onClick={() => {
                    const t = { id: crypto.randomUUID(), name: "From history", sql: h.sql };
                    setTabs((ts) => [...ts, t]); setActive(t.id);
                  }}>
                    <span className={`dot ${h.status === "failed" ? "bad" : "ok"}`} aria-hidden="true" />
                    <span className="mono clip">{h.sql.replace(/\s+/g, " ")}</span>
                    <span className="caption">{duration(h.durationMs)}</span>
                  </button>))}</div>)}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="tabs qtabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={t.id === active} onClick={() => setActive(t.id)}
                onDoubleClick={() => setSaveAs(t.name)}>
                {panels[t.id]?.error ? <span className="dot bad" /> : panels[t.id]?.result ? <span className="dot ok" /> : null}
                {t.name}
                {tabs.length > 1 && <span role="button" aria-label={`Close ${t.name}`} className="x"
                  onClick={(e) => { e.stopPropagation(); close(t.id); }}>✕</span>}
              </button>))}
            <button onClick={() => { const t = fresh(tabs.length + 1); setTabs((ts) => [...ts, t]); setActive(t.id); }} aria-label="New query tab">+</button>
          </div>
          <div ref={editorRef}>
            <CodeEditor language="sql" value={tab?.sql ?? ""} onChange={(sql) => patch({ sql })}
              onRun={() => execute(selectedOrAll())} onSave={() => setSaveAs(tab?.name ?? "Query")}
              completions={words} minLines={9} ariaLabel="SQL editor"
              placeholder="select * from demo.route_summary;   -- Ctrl/⌘ + Enter to run, select text to run part of it" />
          </div>
          {runningId === tab?.id ? <div className="card running-card"><span className="spin" aria-hidden="true" />
              <span>Running on Sail… {(elapsed / 1000).toFixed(1)}s</span>
              <button className="btn sm danger" onClick={cancel}>Cancel</button></div>
            : panel.error ? <div className="card"><ErrorState title="The query failed" error={panel.error} /></div>
            : panel.plan ? <div className="card pad"><div className="row-actions" style={{ marginBottom: 8 }}><h3 style={{ flex: 1 }}>Query plan</h3></div>
                <pre className="log" style={{ margin: 0 }}>{panel.plan}</pre></div>
            : panel.result ? <ResultPanel filename={tab?.name ?? "result"} data={{
                columns: panel.result.columns.map((c) => c.name), types: panel.result.columns.map((c) => c.type),
                rows: panel.result.rows,
                footer: `${panel.result.truncated ? `truncated at ${panel.result.max_rows} · ` : ""}${panel.result.duration_ms.toFixed(0)} ms engine${panel.elapsed ? ` · ${duration(panel.elapsed)} total` : ""}${panel.result.warnings.map((w) => ` · ${w}`).join("")}` }} />
            : <div className="card"><EmptyState icon="table" title="Run a query to see results"
                hint="Ctrl/⌘ + Enter runs. Select part of the text to run only that. Double-click a cell in the results to expand it." /></div>}
        </div>
      </div>
      {saveAs !== null && (
        <Modal title="Save query" onClose={() => setSaveAs(null)}
          footer={<><button className="btn" onClick={() => setSaveAs(null)}>Cancel</button>
            <button className="btn primary" onClick={() => { save(saveAs); setSaveAs(null); }}>Save</button></>}>
          <Field label="Name"><input className="input" value={saveAs} autoFocus
            onChange={(e) => setSaveAs(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { save(saveAs); setSaveAs(null); } }} /></Field>
        </Modal>)}
    </div>
  );
}
