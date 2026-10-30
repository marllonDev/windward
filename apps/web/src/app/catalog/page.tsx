"use client";
import { useEffect, useState } from "react";
import CatalogTree, { loadColumns, type Selected } from "@/components/CatalogTree";
import { EmptyState, ErrorState, PageHead } from "@/components/ui";

type Col = { name: string; type: string };

export default function Catalog() {
  const [selected, setSelected] = useState<Selected>(null);
  const [filter, setFilter] = useState("");
  const [cols, setCols] = useState<Col[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    setCols(null);
    setError(null);
    loadColumns(selected.db, selected.table)
      .then((c) => live && setCols(c))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [selected, attempt]);

  return (
    <div className="page">
      <PageHead title="Catalog" subtitle="Databases, tables and their columns." />
      <div className="split" style={{ gridTemplateColumns: "320px 1fr" }}>
        <div className="card pad">
          <input className="input" placeholder="Filter tables" aria-label="Filter tables" value={filter}
            onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 12 }} />
          <CatalogTree selected={selected} onSelect={setSelected} filter={filter} />
        </div>
        <div className="card">
          {!selected ? <EmptyState icon="table" title="Select a table or view to see its details" />
            : error ? <ErrorState title={`Couldn't load metadata for ${selected.db}.${selected.table}`}
                error={error.message} onRetry={() => setAttempt((a) => a + 1)} />
            : !cols ? <div className="caption" style={{ padding: 16 }}>Loading…</div>
            : <>
                <div style={{ padding: "16px 16px 8px" }}>
                  <h2 className="mono">{selected.db}.{selected.table}</h2>
                  <div className="caption">{cols.length} columns</div>
                </div>
                <table className="tbl">
                  <thead><tr><th>Column</th><th>Type</th></tr></thead>
                  <tbody>{cols.map((c) => (
                    <tr key={c.name}><td className="mono">{c.name}</td><td className="mono">{c.type}</td></tr>
                  ))}</tbody>
                </table>
              </>}
        </div>
      </div>
    </div>
  );
}
