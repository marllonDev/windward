"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ago, uptime } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { starterCells } from "@/lib/starter";
import { Icon, StatusBadge } from "@/components/ui";

const ACTIONS = [
  { label: "New notebook", icon: "notebook", href: "notebook" }, { label: "New SQL query", icon: "terminal", href: "/console" },
  { label: "Create job", icon: "clock", href: "/jobs/new" }, { label: "New dbt 2 project", icon: "dbt", href: "/dbt2" },
  { label: "Upload data", icon: "upload", href: "/catalog" },
] as const;

function List<T>({ title, href, items, render, empty }: { title: string; href: string; items: T[] | null; render: (i: T) => React.ReactNode; empty: string }) {
  return (
    <div className="card pad">
      <div className="row-actions" style={{ marginBottom: 8 }}><h3 style={{ flex: 1 }}>{title}</h3><Link href={href} className="caption">View all</Link></div>
      {items === null ? <div className="caption">Loading…</div> : items.length === 0 ? <div className="caption">{empty}</div>
        : <div className="home-list">{items.slice(0, 5).map(render)}</div>}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const engine = usePoll(api.engineStatus, 5000);
  const nbs = usePoll(api.notebooks, 8000);
  const jobs = usePoll(api.jobs, 5000);
  const runs = usePoll(api.recentRuns, 5000);
  const projects = usePoll(api.dbt2Projects, 10000);
  const queries = usePoll(api.savedQueries, 10000);
  const e = engine.data;
  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div>
        <h1>Welcome to Windward</h1>
        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>Spark SQL on Sail, dbt on Sail and on DuckDB, notebooks and jobs — one workspace, one command.</p>
      </div>
      <div className="row-actions">
        {ACTIONS.map((a) => a.href === "notebook"
          ? <button key={a.label} className="btn primary" onClick={async () => router.push(`/notebooks/${(await api.createNotebook("Untitled notebook", starterCells())).id}`)}><Icon name={a.icon} size={15} /> {a.label}</button>
          : <Link key={a.label} href={a.href} className="btn" style={{ textDecoration: "none" }}><Icon name={a.icon} size={15} /> {a.label}</Link>)}
      </div>
      <div className="grid-cards">
        <div className="card pad stat"><div className="label">Sail engine</div><div className="value">{engine.error ? <StatusBadge status="error" label="offline" /> : e ? <StatusBadge status={e.state} /> : "…"}</div>
          <div className="caption">{e ? `Sail ${e.sail_version} · Spark ${e.spark_version} · up ${uptime(e.uptime_seconds)}` : ""}</div></div>
        <div className="card pad stat"><div className="label">Jobs</div><div className="value">{jobs.data?.length ?? "—"}</div><div className="caption">{jobs.data?.filter((j) => j.schedule?.enabled).length ?? 0} scheduled</div></div>
        <div className="card pad stat"><div className="label">Notebooks</div><div className="value">{nbs.data?.length ?? "—"}</div></div>
        <div className="card pad stat"><div className="label">dbt 2 projects</div><div className="value">{projects.data?.length ?? "—"}</div></div>
      </div>
      <div className="home-grid">
        <List title="Recent job runs" href="/jobs" items={runs.data} empty="No runs yet. Create a job to automate work."
          render={(r) => <Link key={r.id} href={`/jobs/${r.job_id}?tab=runs`} className="home-row"><span>{r.job_name}</span><span><StatusBadge status={r.status} /> <span className="caption">{ago(r.started_at)}</span></span></Link>} />
        <List title="Notebooks" href="/notebooks" items={nbs.data} empty="No notebooks yet."
          render={(n) => <Link key={n.id} href={`/notebooks/${n.id}`} className="home-row"><span>{n.name}</span><span className="caption">{ago(n.updated_at)}</span></Link>} />
        <List title="dbt 2 projects" href="/dbt2" items={projects.data} empty="No dbt 2 projects yet."
          render={(p) => <Link key={p.name} href={`/dbt2/${p.name}`} className="home-row"><span className="mono">{p.name}</span><span className="caption">{p.files} files</span></Link>} />
        <List title="Saved queries" href="/console" items={queries.data} empty="Save a query from the SQL console."
          render={(q) => <Link key={q.id} href="/console" className="home-row"><span>{q.name}</span><span className="caption">{ago(q.updated_at)}</span></Link>} />
      </div>
    </div>
  );
}
