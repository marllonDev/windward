"use client";
import { useEffect, useState } from "react";
import { api, type QueryResult } from "@/lib/api";
import { addHistory } from "@/lib/history";
import CatalogTree from "@/components/CatalogTree";
import ResultsGrid from "@/components/ResultsGrid";
import SqlEditor from "@/components/SqlEditor";
import { EmptyState, ErrorState, Icon, PageHead } from "@/components/ui";

export default function Console() {
  const [sql, setSql] = useState("select 1 as hello;");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("windward.rerun");
      if (pending) {
        setSql(pending);
        sessionStorage.removeItem("windward.rerun");
      }
    } catch {
      /* ignore */
    }
  }, []);

  async function run() {
    if (running || !sql.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const r = await api.query(sql);
      setResult(r);
      addHistory({ sql, status: "succeeded", durationMs: r.duration_ms, rows: r.row_count, error: null });
    } catch (e) {
      const err = e as { code?: string; message: string };
      setResult(null);
      setError({ code: err.code ?? "ERROR", message: err.message });
      addHistory({ sql, status: "failed", durationMs: null, rows: null, error: err.message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page">
      <PageHead title="SQL console" subtitle="Run Spark SQL against the Sail engine."
        actions={<button className="btn primary" onClick={run} disabled={running}>
          <Icon name="play" size={14} /> {running ? "Running…" : "Run"}</button>} />
      <div className="split">
        <div className="card pad"><CatalogTree selected={null}
          onSelect={(s) => s && setSql(`select * from ${s.db}.${s.table} limit 100;`)} /></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <SqlEditor value={sql} onChange={setSql} onRun={run} />
          {error ? <div className="card"><ErrorState title="The query failed" error={`${error.code}\n${error.message}`} /></div>
            : result ? <ResultsGrid result={result} />
            : <div className="card"><EmptyState icon="table" title="Run a query to see results"
                hint="Write SQL above and press Run, or Ctrl/⌘ + Enter." /></div>}
        </div>
      </div>
    </div>
  );
}
