import type { QueryResult } from "@/lib/api";
import { formatCell, isNumericType } from "@/lib/format";

export default function ResultsGrid({ result }: { result: QueryResult }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="scroll" style={{ maxHeight: "45vh" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th aria-hidden="true" style={{ width: 44 }}>#</th>
              {result.columns.map((c) => (
                <th key={c.name} className={isNumericType(c.type) ? "num" : ""} title={c.type}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i}>
                <td className="num caption">{i + 1}</td>
                {row.map((cell, j) => (
                  <td key={j} className={`mono${isNumericType(result.columns[j].type) ? " num" : ""}`}>
                    {cell === null || cell === undefined ? <span className="null">NULL</span> : formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="caption" style={{ padding: "8px 12px", borderTop: "1px solid var(--border-default)" }}>
        {result.row_count} row{result.row_count === 1 ? "" : "s"}
        {result.truncated && ` (truncated at ${result.max_rows})`} · {result.duration_ms.toFixed(0)} ms
        {result.warnings.map((w) => ` · ${w}`)}
      </div>
    </div>
  );
}
