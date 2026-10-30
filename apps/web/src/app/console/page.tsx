"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type QueryResult, type SavedQuery } from "@/lib/api";
import { addHistory } from "@/lib/history";
import CatalogTree from "@/components/CatalogTree";
import ResultPanel from "@/components/ResultPanel";
import SqlEditor from "@/components/SqlEditor";
import { EmptyState, ErrorState, Icon, PageHead } from "@/components/ui";

type Tab = { id: string; name: string; sql: string; savedId?: string };
const KEY = "windward.tabs.v1";
const fresh = (n: number): Tab => ({ id: crypto.randomUUID(), name: `Query ${n}`, sql: "" });

export default function Console() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string>("");
  const [results, setResults] = useState<Record<string, QueryResult>>({});
  const [plans, setPlans] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [side, setSide] = useState<"catalog" | "saved">("catalog");
  const editorRef = useRef<HTMLDivElement>(null);

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
    } catch {
      /* storage unavailable: start with an empty tab */
    }
    if (stored.length === 0) stored = [{ ...fresh(1), sql: "select 1 as hello;" }];
    setTabs(stored);
    setActive(stored[stored.length - 1].id);
    loadSaved();
  }, [loadSaved]);

  useEffect(() => {
    if (tabs.length === 0) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(tabs));
    } catch {
      /* ignore */
    }
  }, [tabs]);

  const tab = tabs.find((t) => t.id === active);
  const patch = (changes: Partial<Tab>) => setTabs((ts) => ts.map((t) => (t.id === active ? { ...t, ...changes } : t)));

  function selectedOrAll(): string {
    const ta = editorRef.current?.querySelector("textarea");
    if (ta && ta.selectionStart !== ta.selectionEnd) return ta.value.slice(ta.selectionStart, ta.selectionEnd);
    return tab?.sql ?? "";
  }

  async function execute(sqlText: string, explain = false) {
    const sql = sqlText.trim().replace(/;+\s*$/, "");
    if (running || !sql || !tab) return;
    const id = tab.id;
    setRunning(true);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const r = await api.query(explain ? `EXPLAIN ${sql}` : sql);
      if (explain) {
        setPlans((p) => ({ ...p, [id]: r.rows.map((row) => row.join("\n")).join("\n") }));
        setResults((x) => { const { [id]: _drop, ...rest } = x; return rest; });
      } else {
        setResults((x) => ({ ...x, [id]: r }));
        setPlans((p) => { const { [id]: _drop, ...rest } = p; return rest; });
        addHistory({ sql, status: "succeeded", durationMs: r.duration_ms, rows: r.row_count, error: null });
      }
    } catch (e) {
      const err = e as { code?: string; message: string };
      setErrors((x) => ({ ...x, [id]: `${err.code ?? "ERROR"}\n${err.message}` }));
      if (!explain) addHistory({ sql, status: "failed", durationMs: null, rows: null, error: err.message });
    } finally {
      setRunning(false);
    }
  }

  async function save() {
    if (!tab || !tab.sql.trim()) return;
    const name = window.prompt("Name this query", tab.name);
    if (!name) return;
    const q = await api.saveQuery(name, tab.sql, tab.savedId);
    patch({ name, savedId: q.id });
    loadSaved();
  }

  function close(id: string) {
    setTabs((ts) => {
      const next = ts.filter((t) => t.id !== id);
      const list = next.length ? next : [fresh(1)];
      if (id === active) setActive(list[list.length - 1].id);
      return list;
    });
  }

  const result = tab ? results[tab.id] : undefined;
  const plan = tab ? plans[tab.id] : undefined;
  const error = tab ? errors[tab.id] : undefined;

  return (
    <div className="page">
      <PageHead title="SQL console" subtitle="Run Spark SQL against the Sail engine."
        actions={<>
          <button className="btn" onClick={() => execute(selectedOrAll(), true)} disabled={running}>Explain</button>
          <button className="btn" onClick={save}>Save</button>
          <button className="btn primary" onClick={() => execute(selectedOrAll())} disabled={running}>
            <Icon name="play" size={14} /> {running ? "Running…" : "Run"}</button>
        </>} />
      <div className="split">
        <div className="card pad">
          <div className="tabs" role="tablist" style={{ marginBottom: 8 }}>
            <button role="tab" aria-selected={side === "catalog"} onClick={() => setSide("catalog")}>Catalog</button>
            <button role="tab" aria-selected={side === "saved"} onClick={() => { setSide("saved"); loadSaved(); }}>Saved</button>
          </div>
          {side === "catalog"
            ? <CatalogTree selected={null} onSelect={(s) => s && patch({ sql: `select * from ${s.db}.${s.table} limit 100;` })} />
            : saved.length === 0
              ? <div className="caption">No saved queries yet. Press Save in the editor.</div>
              : saved.map((q) => (
                <div key={q.id} className="tree"><div style={{ display: "flex" }}>
                  <button className="row" title={q.sql} style={{ flex: 1 }}
                    onClick={() => setTabs((ts) => { const t = { id: crypto.randomUUID(), name: q.name, sql: q.sql, savedId: q.id }; setActive(t.id); return [...ts, t]; })}>
                    <Icon name="terminal" size={15} /> {q.name}</button>
                  <button className="btn ghost sm" aria-label={`Delete ${q.name}`}
                    onClick={() => api.deleteQuery(q.id).then(loadSaved)}>×</button></div></div>))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={t.id === active} onClick={() => setActive(t.id)}
                onDoubleClick={() => { const n = window.prompt("Rename tab", t.name); if (n) setTabs((ts) => ts.map((x) => x.id === t.id ? { ...x, name: n } : x)); }}>
                {t.name}{tabs.length > 1 && <span role="button" aria-label={`Close ${t.name}`} style={{ marginLeft: 8, opacity: 0.6 }}
                  onClick={(e) => { e.stopPropagation(); close(t.id); }}>×</span>}
              </button>))}
            <button onClick={() => { const t = fresh(tabs.length + 1); setTabs((ts) => [...ts, t]); setActive(t.id); }} aria-label="New tab">+</button>
          </div>
          <div ref={editorRef}>
            <SqlEditor value={tab?.sql ?? ""} onChange={(sql) => patch({ sql })} onRun={() => execute(selectedOrAll())} />
          </div>
          {error ? <div className="card"><ErrorState title="The query failed" error={error} /></div>
            : plan ? <div className="card pad"><h3 style={{ marginBottom: 8 }}>Query plan</h3><pre className="log" style={{ margin: 0 }}>{plan}</pre></div>
            : result ? <ResultPanel filename={tab?.name ?? "result"} data={{
                columns: result.columns.map((c) => c.name), types: result.columns.map((c) => c.type), rows: result.rows,
                footer: `${result.truncated ? `truncated at ${result.max_rows} · ` : ""}${result.duration_ms.toFixed(0)} ms${result.warnings.map((w) => ` · ${w}`).join("")}` }} />
            : <div className="card"><EmptyState icon="table" title="Run a query to see results"
                hint="Press Run or Ctrl/⌘ + Enter. Select part of the text to run only that." /></div>}
        </div>
      </div>
    </div>
  );
}
