"use client";
import { useMemo, useState } from "react";
import { formatCell, isNumericType } from "@/lib/format";
import { Modal } from "./kit";
import { Icon } from "./ui";

type Sort = { index: number; dir: 1 | -1 } | null;

function compare(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  const na = Number(a), nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

/** Per-column summary computed in the browser over the rows on screen. */
function summarise(values: unknown[], numeric: boolean) {
  const nulls = values.filter((v) => v === null || v === undefined).length;
  const present = values.filter((v) => v !== null && v !== undefined);
  const distinct = new Set(present.map((v) => String(v))).size;
  if (!numeric || present.length === 0) return { nulls, distinct, min: null, max: null, avg: null };
  const numbers = present.map(Number).filter((n) => !Number.isNaN(n));
  if (!numbers.length) return { nulls, distinct, min: null, max: null, avg: null };
  return {
    nulls, distinct,
    min: Math.min(...numbers), max: Math.max(...numbers),
    avg: numbers.reduce((a, b) => a + b, 0) / numbers.length,
  };
}

export default function DataGrid({ columns, types, rows, maxHeight = "45vh" }: {
  columns: string[]; types?: string[]; rows: unknown[][]; maxHeight?: string;
}) {
  const [sort, setSort] = useState<Sort>(null);
  const [filter, setFilter] = useState("");
  const [cell, setCell] = useState<{ column: string; value: unknown } | null>(null);
  const [stats, setStats] = useState<number | null>(null);
  const numeric = useMemo(
    () => columns.map((_, i) => (types ? isNumericType(types[i]) : rows.some((r) => typeof r[i] === "number"))),
    [columns, types, rows],
  );

  const view = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let out = needle ? rows.filter((r) => r.some((c) => formatCell(c).toLowerCase().includes(needle))) : rows;
    if (sort) {
      out = [...out].sort((a, b) => compare(a[sort.index], b[sort.index]) * sort.dir);
    }
    return out;
  }, [rows, filter, sort]);

  const summary = stats === null ? null : summarise(rows.map((r) => r[stats]), numeric[stats]);

  return (
    <>
      <div className="grid-tools">
        <div className="grid-filter">
          <Icon name="search" size={14} />
          <input aria-label="Filter rows" placeholder={`Filter ${rows.length} rows`} value={filter}
            onChange={(e) => setFilter(e.target.value)} />
          {filter && <button className="btn ghost sm" onClick={() => setFilter("")}>Clear</button>}
        </div>
        {sort && <button className="btn ghost sm" onClick={() => setSort(null)}>Reset sort</button>}
      </div>
      <div className="scroll" style={{ maxHeight }}>
        <table className="tbl grid">
          <thead><tr>
            <th aria-hidden="true" style={{ width: 46 }}>#</th>
            {columns.map((c, i) => (
              <th key={`${c}-${i}`} className={numeric[i] ? "num" : ""} title={types?.[i]}>
                <span className="th-inner">
                  <button className="th-sort" onClick={() => setSort((s) => (s?.index === i ? (s.dir === 1 ? { index: i, dir: -1 } : null) : { index: i, dir: 1 }))}>
                    {c}{sort?.index === i && <span aria-hidden="true">{sort.dir === 1 ? " ▲" : " ▼"}</span>}
                  </button>
                  <button className="th-stats" aria-label={`Statistics for ${c}`} onClick={() => setStats(i)}>ⓘ</button>
                </span>
                {types?.[i] && <span className="th-type">{types[i]}</span>}
              </th>))}
          </tr></thead>
          <tbody>
            {view.map((row, i) => (
              <tr key={i}>
                <td className="num caption">{i + 1}</td>
                {row.map((value, j) => (
                  <td key={j} className={`mono${numeric[j] ? " num" : ""}`} onDoubleClick={() => setCell({ column: columns[j], value })}>
                    {value === null || value === undefined ? <span className="null">NULL</span>
                      : <span className="cellv">{formatCell(value)}</span>}
                  </td>))}
              </tr>))}
            {view.length === 0 && <tr><td colSpan={columns.length + 1} className="caption" style={{ padding: 16 }}>No rows match “{filter}”.</td></tr>}
          </tbody>
        </table>
      </div>
      {cell && (
        <Modal title={cell.column} onClose={() => setCell(null)}
          footer={<button className="btn" onClick={() => { navigator.clipboard?.writeText(formatCell(cell.value)); setCell(null); }}>Copy value</button>}>
          <pre className="cell-full">{formatCell(cell.value) || "(empty)"}</pre>
        </Modal>)}
      {stats !== null && summary && (
        <Modal title={`Column: ${columns[stats]}`} onClose={() => setStats(null)}>
          <table className="tbl"><tbody>
            <tr><td>Type</td><td className="mono">{types?.[stats] ?? "—"}</td></tr>
            <tr><td>Rows on screen</td><td className="mono">{rows.length}</td></tr>
            <tr><td>Nulls</td><td className="mono">{summary.nulls} ({rows.length ? ((summary.nulls * 100) / rows.length).toFixed(1) : 0}%)</td></tr>
            <tr><td>Distinct</td><td className="mono">{summary.distinct}</td></tr>
            {summary.min !== null && <><tr><td>Min</td><td className="mono">{summary.min}</td></tr>
              <tr><td>Max</td><td className="mono">{summary.max}</td></tr>
              <tr><td>Average</td><td className="mono">{summary.avg?.toFixed(3)}</td></tr></>}
          </tbody></table>
          <span className="caption">Computed over the rows loaded here, not the whole table. The catalog page profiles the full table.</span>
        </Modal>)}
    </>
  );
}
