"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type DbtNode, type DbtRun } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import { EmptyState, ErrorState, Icon, PageHead, StatusBadge } from "@/components/ui";

type Tab = "models" | "lineage" | "logs";
const COMMANDS = ["seed", "run", "test", "build"] as const;

export default function Dbt() {
  const project = usePoll(api.dbtProject, 15000);
  const [tab, setTab] = useState<Tab>("models");
  const [run, setRun] = useState<DbtRun | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const offset = useRef(0);
  const logEl = useRef<HTMLDivElement>(null);

  // Resume the latest run after a reload so the logs tab is never blank mid-run.
  useEffect(() => {
    api.dbtRuns().then((runs) => {
      const latest = runs[0];
      if (!latest) return;
      api.dbtRun(latest.run_id).then((full) => {
        setRun(full);
        setLog(full.log);
        offset.current = full.log_total;
      });
    }).catch(() => undefined);
  }, []);

  const running = run?.status === "running";
  useEffect(() => {
    if (!run || !running) return;
    const timer = setInterval(async () => {
      try {
        const next = await api.dbtRun(run.run_id, offset.current);
        offset.current = next.log_total;
        setLog((l) => [...l, ...next.log]);
        setRun(next);
        if (next.status !== "running") project.refresh();
      } catch {
        /* the next tick retries */
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [run, running, project]);

  useEffect(() => {
    logEl.current?.scrollTo({ top: logEl.current.scrollHeight });
  }, [log]);

  const start = useCallback(async (command: string) => {
    setStartError(null);
    setBusy(command);
    try {
      const next = await api.dbtStart(command);
      offset.current = 0;
      setLog([]);
      setRun(next);
      setTab("logs");
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  const nodes = useMemo(
    () => (project.data?.nodes ?? []).filter((n) => n.resource_type !== "test"),
    [project.data],
  );
  const statusOf = (id: string) => run?.nodes.find((n) => n.unique_id === id)?.status;
  const versions = project.data?.dbt;

  return (
    <div className="page">
      <PageHead title="dbt project" subtitle={project.data?.name ? `Project ${project.data.name}` : "Transformations on Sail."}
        actions={COMMANDS.map((c) => (
          <button key={c} className={`btn${c === "build" ? " primary" : ""}`} disabled={running || busy !== null}
            onClick={() => start(c)}>
            <Icon name="play" size={13} /> dbt {c}
          </button>))} />
      {startError && <div className="errblock" role="alert">{startError}</div>}
      <div className="caption">
        Runner: {versions?.runner?.replace(/\s*\|\s*/g, " · ") ?? "—"} · dbt 2: {versions?.dbt2 ?? "—"}
        {run && <> · last run: <StatusBadge status={run.status} label={`${run.command} ${run.status}`} /></>}
      </div>
      <div className="tabs" role="tablist">
        {(["models", "lineage", "logs"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>))}
      </div>
      {project.loading ? <div className="caption">Reading the dbt project…</div>
        : project.error && !project.data
        ? <div className="card"><ErrorState title="Couldn't read the dbt project" error={project.error.message} onRetry={project.refresh} /></div>
        : tab === "models" ? <Models nodes={nodes} statusOf={statusOf} run={run} />
        : tab === "lineage" ? <Lineage nodes={nodes} statusOf={statusOf} />
        : <div className="log" ref={logEl} role="log" aria-live="polite">
            {log.length === 0 ? "No run yet. Start one with a dbt command above." : log.map((l, i) => (
              <div key={i} className={l.startsWith("$") ? "cmd" : /error|fail/i.test(l) ? "err" : /\bPASS\b|OK\b|Completed successfully/.test(l) ? "ok" : ""}>{l || " "}</div>))}
          </div>}
    </div>
  );
}

function Models({ nodes, statusOf, run }: { nodes: DbtNode[]; statusOf: (id: string) => string | undefined; run: DbtRun | null }) {
  if (nodes.length === 0)
    return <div className="card"><EmptyState icon="dbt" title="No dbt models found"
      hint="Make sure dbt_project.yml is at the project root; the API runs dbt parse on first read." /></div>;
  return (
    <div className="card"><table className="tbl">
      <thead><tr><th>Name</th><th>Kind</th><th>Materialization</th><th>Depends on</th><th>Last run</th></tr></thead>
      <tbody>{nodes.map((n) => {
        const s = statusOf(n.unique_id);
        return (
          <tr key={n.unique_id}>
            <td className="mono">{n.name}</td><td>{n.resource_type}</td>
            <td>{n.materialized ?? "—"}</td>
            <td className="mono caption">{n.depends_on.map((d) => d.split(".").pop()).join(", ") || "—"}</td>
            <td>{s ? <StatusBadge status={s} /> : run ? <StatusBadge status="idle" label="not in run" /> : <span className="caption">never</span>}</td>
          </tr>);
      })}</tbody>
    </table></div>
  );
}

function Lineage({ nodes, statusOf }: { nodes: DbtNode[]; statusOf: (id: string) => string | undefined }) {
  const ids = new Set(nodes.map((n) => n.unique_id));
  const depth = new Map<string, number>();
  const level = (n: DbtNode): number => {
    const cached = depth.get(n.unique_id);
    if (cached !== undefined) return cached;
    const parents = n.depends_on.filter((d) => ids.has(d)).map((d) => level(nodes.find((x) => x.unique_id === d)!));
    const v = parents.length ? Math.max(...parents) + 1 : 0;
    depth.set(n.unique_id, v);
    return v;
  };
  nodes.forEach(level);
  if (nodes.length === 0)
    return <div className="card"><EmptyState icon="dbt" title="Nothing to draw yet" hint="No models or seeds were parsed." /></div>;

  const cols = Math.max(...depth.values()) + 1;
  const perCol: Record<number, DbtNode[]> = {};
  nodes.forEach((n) => (perCol[depth.get(n.unique_id)!] ??= []).push(n));
  const W = 190, H = 54, GX = 90, GY = 28;
  const pos = new Map<string, { x: number; y: number }>();
  Object.entries(perCol).forEach(([c, list]) =>
    list.forEach((n, i) => pos.set(n.unique_id, { x: 24 + Number(c) * (W + GX), y: 24 + i * (H + GY) })));
  const width = 48 + cols * W + (cols - 1) * GX;
  const height = 48 + Math.max(...Object.values(perCol).map((l) => l.length)) * (H + GY) - GY;
  const color = (s?: string) =>
    s === "success" || s === "pass" ? "var(--status-success)" : s === "error" || s === "fail" ? "var(--status-error)" : "var(--border-strong)";

  return (
    <div className="card scroll" style={{ padding: 8 }}>
      <svg className="lineage" width={width} height={height} role="img" aria-label="dbt lineage graph">
        {nodes.flatMap((n) => n.depends_on.filter((d) => ids.has(d)).map((d) => {
          const a = pos.get(d)!, b = pos.get(n.unique_id)!;
          const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
          return <path key={`${d}>${n.unique_id}`} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
            fill="none" stroke="var(--border-strong)" strokeWidth={1.5} />;
        }))}
        {nodes.map((n) => {
          const p = pos.get(n.unique_id)!, s = statusOf(n.unique_id);
          return (
            <g key={n.unique_id} transform={`translate(${p.x} ${p.y})`}>
              <rect width={W} height={H} rx={8} fill="var(--surface-app)" stroke={color(s)} strokeWidth={s ? 2 : 1} />
              <text x={12} y={22}>{n.name}</text>
              <text x={12} y={40} className="sub">{n.resource_type}{n.materialized ? ` · ${n.materialized}` : ""}{s ? ` · ${s}` : ""}</text>
            </g>);
        })}
      </svg>
    </div>
  );
}
