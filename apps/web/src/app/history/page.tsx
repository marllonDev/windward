"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearHistory, loadHistory, type HistoryEntry } from "@/lib/history";
import { duration } from "@/lib/format";
import { EmptyState, PageHead, StatusBadge } from "@/components/ui";

export default function History() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryEntry[] | null>(null);
  const [filter, setFilter] = useState<"all" | "succeeded" | "failed">("all");

  useEffect(() => setItems(loadHistory()), []);

  const shown = (items ?? []).filter((i) => filter === "all" || i.status === filter);

  function rerun(sql: string) {
    try {
      sessionStorage.setItem("windward.rerun", sql);
    } catch {
      /* ignore */
    }
    router.push("/console");
  }

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <PageHead title="Query history" subtitle="Queries you ran in this browser."
        actions={<>
          <select className="input" aria-label="Filter by status" style={{ width: 150 }} value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All statuses</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option>
          </select>
          <button className="btn" disabled={!items?.length} onClick={() => { clearHistory(); setItems([]); }}>Clear</button>
        </>} />
      <div className="card">
        {items && items.length === 0
          ? <EmptyState icon="history" title="No queries yet" hint="Queries you run in the SQL console will show up here." />
          : shown.length === 0 && items
          ? <EmptyState icon="search" title="No queries match these filters"
              action={<button className="btn" onClick={() => setFilter("all")}>Clear filters</button>} />
          : <table className="tbl"><tbody>{shown.map((h) => (
              <tr key={h.id} style={{ cursor: "pointer" }} onClick={() => rerun(h.sql)} title="Open in the console">
                <td style={{ width: 110 }}><StatusBadge status={h.status} /></td>
                <td className="mono" style={{ maxWidth: 520, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.sql.replace(/\s+/g, " ")}
                  {h.error && <div className="caption" style={{ color: "var(--text-danger)" }}>{h.error}</div>}
                </td>
                <td className="caption" style={{ whiteSpace: "nowrap" }}>
                  {new Date(h.at).toLocaleString()}<br />{duration(h.durationMs)}{h.rows !== null && ` · ${h.rows} rows`}
                </td>
              </tr>))}</tbody></table>}
      </div>
    </div>
  );
}
