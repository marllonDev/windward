"use client";
import { useState } from "react";
import { download, formatCell, isNumericType, toCsv } from "@/lib/format";
import Chart from "./Chart";

export type Tabular = { columns: string[]; types?: string[]; rows: unknown[][]; footer?: string };

/** Results as a table or a chart, with CSV export. Shared by the console and notebooks. */
export default function ResultPanel({ data, maxHeight = "45vh", filename = "result" }: {
  data: Tabular; maxHeight?: string; filename?: string;
}) {
  const [view, setView] = useState<"table" | "chart">("table");
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="tabs" role="tablist" style={{ padding: "0 8px" }}>
        <button role="tab" aria-selected={view === "table"} onClick={() => setView("table")}>Table</button>
        <button role="tab" aria-selected={view === "chart"} onClick={() => setView("chart")}>Chart</button>
        <div style={{ flex: 1 }} />
        <button className="btn ghost sm" style={{ alignSelf: "center" }}
          onClick={() => download(`${filename}.csv`, toCsv(data.columns, data.rows))}>Export CSV</button>
      </div>
      {view === "chart" ? <Chart columns={data.columns} types={data.types} rows={data.rows} /> : (
        <div className="scroll" style={{ maxHeight }}>
          <table className="tbl">
            <thead><tr>
              <th aria-hidden="true" style={{ width: 44 }}>#</th>
              {data.columns.map((c, i) => (
                <th key={`${c}-${i}`} className={data.types && isNumericType(data.types[i]) ? "num" : ""}
                  title={data.types?.[i]}>{c}</th>))}
            </tr></thead>
            <tbody>{data.rows.map((row, i) => (
              <tr key={i}>
                <td className="num caption">{i + 1}</td>
                {row.map((cell, j) => (
                  <td key={j} className={`mono${(data.types ? isNumericType(data.types[j]) : typeof cell === "number") ? " num" : ""}`}>
                    {cell === null || cell === undefined ? <span className="null">NULL</span> : formatCell(cell)}
                  </td>))}
              </tr>))}</tbody>
          </table>
        </div>)}
      <div className="caption" style={{ padding: "8px 12px", borderTop: "1px solid var(--border-default)" }}>
        {data.rows.length} row{data.rows.length === 1 ? "" : "s"}{data.footer ? ` · ${data.footer}` : ""}
      </div>
    </div>
  );
}
