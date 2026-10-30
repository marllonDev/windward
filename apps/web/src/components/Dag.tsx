"use client";

export type DagNode = { id: string; label: string; sub?: string; status?: string; deps: string[] };

const STATUS_COLOR: Record<string, string> = {
  succeeded: "var(--status-success)", success: "var(--status-success)", pass: "var(--status-success)",
  failed: "var(--status-error)", error: "var(--status-error)", fail: "var(--status-error)",
  running: "var(--status-running)", cancelled: "var(--status-warning)", skipped: "var(--border-strong)",
};

/** Layered left-to-right graph: a node sits one column right of its deepest dependency. */
export default function Dag({ nodes, selected, onSelect, empty = "Nothing to draw yet." }: {
  nodes: DagNode[]; selected?: string | null; onSelect?: (id: string) => void; empty?: string;
}) {
  if (nodes.length === 0) return <div className="state"><div className="caption">{empty}</div></div>;
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
  const W = 190, H = 52, GX = 70, GY = 22;
  const pos = new Map<string, { x: number; y: number }>();
  columns.forEach((col, c) => col?.forEach((n, i) => pos.set(n.id, { x: 16 + c * (W + GX), y: 16 + i * (H + GY) })));
  const width = 32 + columns.length * W + (columns.length - 1) * GX;
  const height = 32 + Math.max(...columns.map((c) => c?.length ?? 0)) * (H + GY) - GY;
  return (
    <div className="scroll dag">
      <svg width={width} height={height} role="img" aria-label="Task graph">
        <defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L8 4L0 8z" fill="var(--border-strong)" /></marker></defs>
        {nodes.flatMap((n) => n.deps.filter((d) => byId.has(d)).map((d) => {
          const a = pos.get(d)!, b = pos.get(n.id)!;
          const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
          return <path key={`${d}>${n.id}`} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2 - 2} ${y2}`} fill="none"
            stroke="var(--border-strong)" strokeWidth={1.5} markerEnd="url(#arrow)" />;
        }))}
        {nodes.map((n) => {
          const p = pos.get(n.id)!, color = STATUS_COLOR[n.status ?? ""] ?? "var(--border-strong)";
          return (
            <g key={n.id} transform={`translate(${p.x} ${p.y})`} style={{ cursor: onSelect ? "pointer" : "default" }}
              onClick={() => onSelect?.(n.id)} tabIndex={onSelect ? 0 : undefined} role={onSelect ? "button" : undefined}
              onKeyDown={(e) => e.key === "Enter" && onSelect?.(n.id)} aria-label={n.label}>
              <rect width={W} height={H} rx={8} fill="var(--surface-app)" stroke={selected === n.id ? "var(--action-primary)" : color}
                strokeWidth={selected === n.id || n.status ? 2 : 1} />
              <rect x={0} y={0} width={5} height={H} rx={2} fill={color} />
              <text x={16} y={22} className="dag-t">{n.label.slice(0, 22)}</text>
              <text x={16} y={40} className="dag-s">{(n.sub ?? "").slice(0, 28)}{n.status ? ` · ${n.status}` : ""}</text>
            </g>);
        })}
      </svg>
    </div>
  );
}
