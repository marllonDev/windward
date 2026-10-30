"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Icon, ErrorState } from "./ui";

export type Selected = { db: string; table: string } | null;
type Col = { name: string; type: string };

function cell(row: unknown[], names: string[], want: string[], fallback: number): string {
  const idx = names.findIndex((n) => want.includes(n.toLowerCase()));
  return String(row[idx >= 0 ? idx : fallback] ?? "");
}

export async function loadColumns(db: string, table: string): Promise<Col[]> {
  const r = await api.query(`DESCRIBE ${db}.${table}`);
  const names = r.columns.map((c) => c.name);
  return r.rows
    .map((row) => ({ name: cell(row, names, ["col_name"], 0), type: cell(row, names, ["data_type"], 1) }))
    .filter((c) => c.name && !c.name.startsWith("#"));
}

export default function CatalogTree({ selected, onSelect, filter = "" }: {
  selected: Selected; onSelect: (s: Selected) => void; filter?: string;
}) {
  const [dbs, setDbs] = useState<string[] | null>(null);
  const [tables, setTables] = useState<Record<string, string[] | Error>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<Error | null>(null);

  const loadDbs = useCallback(async () => {
    try {
      const r = await api.query("SHOW DATABASES");
      setDbs(r.rows.map((row) => String(row[0])));
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, []);

  const loadTables = useCallback(async (db: string) => {
    try {
      const r = await api.query(`SHOW TABLES IN ${db}`);
      const names = r.columns.map((c) => c.name);
      setTables((t) => ({ ...t, [db]: r.rows.map((row) => cell(row, names, ["tablename"], 1)) }));
    } catch (e) {
      setTables((t) => ({ ...t, [db]: e as Error }));
    }
  }, []);

  useEffect(() => {
    loadDbs();
  }, [loadDbs]);

  useEffect(() => {
    // Expand every database once so tables are visible without clicking.
    dbs?.forEach((db) => {
      setOpen((o) => (db in o ? o : { ...o, [db]: true }));
      loadTables(db);
    });
  }, [dbs, loadTables]);

  if (error) return <ErrorState title="Couldn't load the catalog" error={error.message} onRetry={loadDbs} />;
  if (!dbs) return <div className="caption" style={{ padding: 12 }}>Loading catalog…</div>;
  if (dbs.length === 0)
    return <div className="caption" style={{ padding: 12 }}>No databases yet.</div>;

  const q = filter.trim().toLowerCase();
  return (
    <div className="tree" role="tree" aria-label="Catalog">
      {dbs.map((db) => {
        const t = tables[db];
        const list = Array.isArray(t) ? t.filter((n) => !q || n.toLowerCase().includes(q)) : [];
        return (
          <div key={db} role="treeitem" aria-expanded={!!open[db]}>
            <button className="row" onClick={() => setOpen((o) => ({ ...o, [db]: !o[db] }))}>
              <span style={{ transform: open[db] ? "rotate(90deg)" : "none", display: "flex" }}>
                <Icon name="chevron" size={14} />
              </span>
              <Icon name="folder" size={16} /> {db}
              {Array.isArray(t) && <span className="type">{t.length}</span>}
            </button>
            {open[db] && (
              <div className="child" role="group">
                {t instanceof Error && <div className="errblock">{t.message}</div>}
                {Array.isArray(t) && list.length === 0 && (
                  <div className="caption" style={{ padding: "4px 8px" }}>
                    {q ? "No tables match" : "No tables"}
                  </div>
                )}
                {list.map((name) => (
                  <button key={name} role="treeitem"
                    className={`row${selected?.db === db && selected.table === name ? " selected" : ""}`}
                    onClick={() => onSelect({ db, table: name })}>
                    <Icon name="table" size={16} /> <span className="mono">{name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
