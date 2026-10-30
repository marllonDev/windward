"use client";
import { useState } from "react";
import { download, formatCell, toCsv } from "@/lib/format";
import Chart from "./Chart";
import DataGrid from "./DataGrid";
import { CopyButton, Segmented } from "./kit";

export type Tabular = { columns: string[]; types?: string[]; rows: unknown[][]; footer?: string };

function toJson(columns: string[], rows: unknown[][]): string {
  return JSON.stringify(rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))), null, 2);
}

function toMarkdown(columns: string[], rows: unknown[][]): string {
  const head = `| ${columns.join(" | ")} |`;
  const rule = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.slice(0, 500).map((r) => `| ${r.map((c) => formatCell(c).replace(/\|/g, "\\|")).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

/** Results as a grid or a chart, with export. Shared by the console, notebooks and jobs. */
export default function ResultPanel({ data, maxHeight = "45vh", filename = "result" }: {
  data: Tabular; maxHeight?: string; filename?: string;
}) {
  const [view, setView] = useState<"table" | "chart">("table");
  const [exporting, setExporting] = useState(false);
  return (
    <div className="card result" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="result-head">
        <Segmented size="sm" value={view} onChange={setView}
          options={[{ value: "table", label: "Table", icon: "table" }, { value: "chart", label: "Chart", icon: "dbt" }]} />
        <div style={{ flex: 1 }} />
        <CopyButton small label="Copy" text={() => toMarkdown(data.columns, data.rows)} />
        <div className="menu-wrap">
          <button className="btn ghost sm" onClick={() => setExporting((v) => !v)} aria-expanded={exporting}>Export ▾</button>
          {exporting && (
            <div className="menu" onMouseLeave={() => setExporting(false)}>
              <button onClick={() => { download(`${filename}.csv`, toCsv(data.columns, data.rows)); setExporting(false); }}>CSV</button>
              <button onClick={() => { download(`${filename}.json`, toJson(data.columns, data.rows), "application/json"); setExporting(false); }}>JSON</button>
              <button onClick={() => { download(`${filename}.md`, toMarkdown(data.columns, data.rows), "text/markdown"); setExporting(false); }}>Markdown</button>
            </div>)}
        </div>
      </div>
      {view === "chart"
        ? <Chart columns={data.columns} types={data.types} rows={data.rows} />
        : <DataGrid columns={data.columns} types={data.types} rows={data.rows} maxHeight={maxHeight} />}
      <div className="caption result-foot">
        {data.rows.length} row{data.rows.length === 1 ? "" : "s"}{data.footer ? ` · ${data.footer}` : ""}
      </div>
    </div>
  );
}
