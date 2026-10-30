"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useToast } from "@/components/Toast";
import { EmptyState, ErrorState, Icon, PageHead, StatusBadge } from "@/components/ui";

export default function Jobs() {
  const router = useRouter();
  const toast = useToast();
  const { data, error, refresh } = usePoll(api.jobs, 4000);
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHead title="Jobs" subtitle="Workflows that chain SQL, notebooks, Python, dbt on Sail and dbt 2 — on demand or on a schedule."
        actions={<Link href="/jobs/new" className="btn primary" style={{ textDecoration: "none" }}><Icon name="play" size={13} /> Create job</Link>} />
      <div className="card">
        {error && !data ? <ErrorState title="Couldn't load jobs" error={error.message} onRetry={refresh} />
          : data && data.length === 0 ? <EmptyState icon="clock" title="No jobs yet"
              hint="A job is a graph of tasks. Mix engines freely: a SQL task on Sail can feed a dbt 2 task on DuckDB."
              action={<Link href="/jobs/new" className="btn primary" style={{ textDecoration: "none" }}>Create your first job</Link>} />
          : <table className="tbl"><thead><tr><th>Job</th><th>Tasks</th><th>Schedule</th><th>Last run</th><th /></tr></thead>
              <tbody>{(data ?? []).map((j) => (
                <tr key={j.id}>
                  <td><Link href={`/jobs/${j.id}`}><strong>{j.name}</strong></Link><div className="caption">{j.description}</div></td>
                  <td>{j.tasks.length} <span className="caption">({[...new Set(j.tasks.map((t) => t.type))].join(", ")})</span></td>
                  <td className="mono caption">{j.schedule ? `${j.schedule.cron}${j.schedule.enabled ? "" : " (paused)"}` : "Manual"}</td>
                  <td>{j.running ? <StatusBadge status="running" /> : j.last_run ? <><StatusBadge status={j.last_run.status} /> <span className="caption">{ago(j.last_run.started_at)}</span></> : <span className="caption">never</span>}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn sm" disabled={j.running} onClick={async () => { await api.runJob(j.id); toast(`Started “${j.name}”`); router.push(`/jobs/${j.id}?tab=runs`); }}>Run now</button>{" "}
                    <button className="btn ghost sm" onClick={() => confirm(`Delete “${j.name}” and its history?`) && api.deleteJob(j.id).then(refresh)}>Delete</button>
                  </td>
                </tr>))}</tbody></table>}
      </div>
    </div>
  );
}
