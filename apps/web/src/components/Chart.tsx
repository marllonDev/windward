"use client";
import { useMemo, useState } from "react";
import { isNumericType } from "@/lib/format";

type Kind = "bar" | "line" | "pie";
const PALETTE = ["var(--action-primary)", "var(--accent-engine)", "var(--accent-dbt)", "var(--status-warning)",
  "var(--status-error)", "var(--status-success)"];

/** A small result visualisation: pick a label column, one or more numeric columns, a chart type. */
export default function Chart({ columns, types, rows }: { columns: string[]; types?: string[]; rows: unknown[][] }) {
  const numeric = useMemo(
    () => columns.map((c, i) => i).filter((i) =>
      types ? isNumericType(types[i]) : rows.some((r) => typeof r[i] === "number")),
    [columns, types, rows],
  );
  const labelCandidates = columns.map((_, i) => i).filter((i) => !numeric.includes(i));
  const [kind, setKind] = useState<Kind>("bar");
  const [label, setLabel] = useState<number>(labelCandidates[0] ?? 0);
  const [series, setSeries] = useState<number[]>(numeric.slice(0, 1));

  if (numeric.length === 0)
    return <div className="state"><div className="primary">Nothing to plot</div>
      <div className="caption">Charts need at least one numeric column.</div></div>;

  const data = rows.slice(0, 200).map((r) => ({
    label: String(r[label] ?? ""), values: series.map((s) => Number(r[s]) || 0),
  }));
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const W = 760, H = 280, L = 48, B = 56, T = 12, R = 12;
  const plotW = W - L - R, plotH = H - T - B;
  const x = (i: number) => L + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const bandW = plotW / Math.max(data.length, 1);

  return (
    <div style={{ padding: 12 }}>
      <div className="row-actions" style={{ marginBottom: 8 }}>
        <select className="input" style={{ width: 110 }} aria-label="Chart type" value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option>
        </select>
        <select className="input" style={{ width: 160 }} aria-label="Label column" value={label}
          onChange={(e) => setLabel(Number(e.target.value))}>
          {columns.map((c, i) => <option key={c} value={i}>{c}</option>)}
        </select>
        {numeric.map((i) => (
          <label key={i} className="caption" style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={series.includes(i)}
              onChange={(e) => setSeries((s) => e.target.checked ? [...s, i] : s.filter((v) => v !== i))} />
            {columns[i]}
          </label>))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Result chart" style={{ maxHeight: 340 }}>
        {kind !== "pie" && [0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={T + plotH * (1 - f)} y2={T + plotH * (1 - f)} stroke="var(--border-default)" />
            <text x={L - 6} y={T + plotH * (1 - f) + 4} textAnchor="end" fontSize={11} fill="var(--text-tertiary)">
              {(max * f).toLocaleString(undefined, { maximumFractionDigits: 1 })}</text>
          </g>))}
        {kind === "bar" && data.map((d, i) => d.values.map((v, k) => {
          const bw = (bandW * 0.7) / series.length;
          return <rect key={`${i}-${k}`} x={L + i * bandW + bandW * 0.15 + k * bw} width={bw}
            y={T + plotH * (1 - v / max)} height={plotH * (v / max)} fill={PALETTE[k % PALETTE.length]} rx={2}>
            <title>{`${d.label}: ${v}`}</title></rect>;
        }))}
        {kind === "line" && series.map((_, k) => (
          <polyline key={k} fill="none" stroke={PALETTE[k % PALETTE.length]} strokeWidth={2}
            points={data.map((d, i) => `${x(i)},${T + plotH * (1 - d.values[k] / max)}`).join(" ")} />))}
        {kind !== "pie" && data.map((d, i) => (i % Math.ceil(data.length / 12) === 0) && (
          <text key={i} x={kind === "bar" ? L + i * bandW + bandW / 2 : x(i)} y={H - B + 16} textAnchor="middle"
            fontSize={11} fill="var(--text-secondary)">{d.label.slice(0, 14)}</text>))}
        {kind === "pie" && (() => {
          const total = data.reduce((a, d) => a + Math.max(d.values[0] ?? 0, 0), 0) || 1;
          let angle = -Math.PI / 2;
          return data.slice(0, 12).map((d, i) => {
            const frac = Math.max(d.values[0] ?? 0, 0) / total, a2 = angle + frac * Math.PI * 2;
            const cx = W / 2 - 120, cy = H / 2, r = 110;
            const p = (a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
            const path = `M${cx},${cy} L${p(angle)} A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${p(a2)} Z`;
            angle = a2;
            return <g key={i}><path d={path} fill={PALETTE[i % PALETTE.length]} opacity={0.9}><title>{`${d.label}: ${d.values[0]}`}</title></path>
              <rect x={W / 2 + 40} y={20 + i * 20} width={10} height={10} fill={PALETTE[i % PALETTE.length]} />
              <text x={W / 2 + 56} y={29 + i * 20} fontSize={12} fill="var(--text-primary)">{d.label.slice(0, 22)} · {d.values[0]}</text></g>;
          });
        })()}
      </svg>
    </div>
  );
}
