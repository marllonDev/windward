"use client";
import { Icon } from "./ui";

export type DagNode = {
  id: string; label: string; sub?: string; meta?: string; status?: string; deps: string[];
  icon?: Parameters<typeof Icon>[0]["name"];
};

export const STATUS_COLOR: Record<string, string> = {
  succeeded: "var(--status-success)", success: "var(--status-success)", pass: "var(--status-success)",
  failed: "var(--status-error)", error: "var(--status-error)", fail: "var(--status-error)",
  running: "var(--status-running)", cancelled: "var(--status-warning)", skipped: "var(--status-idle)",
  pending: "var(--border-strong)",
};

const W = 210, H = 64, GX = 64, GY = 20;

/** Layered left-to-right graph: a node sits one column right of its deepest dependency. */
export default function Dag({ nodes, selected, onSelect, empty = "Nothing to draw yet.", height }: {
  nodes: DagNode[]; selected?: string | null; onSelect?: (id: string) => void; empty?: string; height?: number;
}) {
  if (nodes.length === 0) return <div className="dag empty"><div className="caption">{empty}</div></div>;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const level = (n: DagNode, seen = new Set<string>()): number => {
    if (depth.has(n.id)) return depth.get(n.id)!;
    if (seen.has(n.id)) return 0;
    seen.add(n.id);
    const parents = n.deps.map((d) => byId.get(d)).filter(Boolean) as DagNode[];
    const v = parents.length ? Math.max(...parents.map((p) => level(p, seen))) + 1 : 0;
    depth.set(n.id, v);
    return v;
  };
  nodes.forEach((n) => level(n));
  const columns: DagNode[][] = [];
  nodes.forEach((n) => (columns[depth.get(n.id)!] ??= []).push(n));
  const pos = new Map<string, { x: number; y: number }>();
  columns.forEach((col, c) => col?.forEach((n, i) => pos.set(n.id, { x: 20 + c * (W + GX), y: 20 + i * (H + GY) })));
  const width = 40 + columns.length * W + Math.max(columns.length - 1, 0) * GX;
  const tall = 40 + Math.max(...columns.map((c) => c?.length ?? 0)) * (H + GY) - GY;
  return (
    <div className="dag scroll" style={height ? { maxHeight: height } : undefined}>
      <svg width={width} height={tall} role="img" aria-label="Task graph">
        <defs><marker id="dag-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L8 4L0 8z" fill="var(--border-strong)" /></marker></defs>
        {nodes.flatMap((n) => n.deps.filter((d) => byId.has(d)).map((d) => {
          const a = pos.get(d)!, b = pos.get(n.id)!;
          const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
          return <path key={`${d}>${n.id}`} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2 - 3} ${y2}`} fill="none"
            stroke="var(--border-strong)" strokeWidth={1.5} markerEnd="url(#dag-arrow)" />;
        }))}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const color = STATUS_COLOR[n.status ?? ""] ?? "var(--border-strong)";
          const on = selected === n.id;
          return (
            <g key={n.id} transform={`translate(${p.x} ${p.y})`} className={`dag-node${onSelect ? " click" : ""}`}
              onClick={() => onSelect?.(n.id)} tabIndex={onSelect ? 0 : undefined} role={onSelect ? "button" : undefined}
              onKeyDown={(e) => e.key === "Enter" && onSelect?.(n.id)} aria-label={`${n.label}${n.status ? `, ${n.status}` : ""}`}>
              <rect width={W} height={H} rx={10} fill="var(--surface-app)" stroke={on ? "var(--action-primary)" : color} strokeWidth={on ? 2 : 1.4} />
              <rect x={0} y={0} width={5} height={H} rx={2.5} fill={color} />
              <circle cx={W - 16} cy={16} r={4.5} fill={color}>{n.status && <title>{n.status}</title>}</circle>
              <text x={18} y={25} className="dag-t">{n.label.slice(0, 20)}</text>
              <text x={18} y={43} className="dag-s">{(n.sub ?? "").slice(0, 26)}</text>
              {n.meta && <text x={18} y={57} className="dag-m">{n.meta.slice(0, 28)}</text>}
            </g>);
        })}
      </svg>
    </div>
  );
}
