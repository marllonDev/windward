"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, type Job, type JobRun } from "@/lib/api";
import { ago, duration } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useConfirm } from "@/components/kit";
import { useToast } from "@/components/Toast";
import { EmptyState, ErrorState, Icon, PageHead, StatusBadge } from "@/components/ui";
import { Skeleton } from "@/components/kit";

const TYPE_LABEL: Record<string, string> = {
  sql: "SQL", notebook: "Notebook", python: "Python", dbt_sail: "dbt on Sail", dbt2: "dbt 2",
};

/** Last runs as a strip of coloured ticks, newest on the right. */
function History({ runs }: { runs: JobRun[] }) {
  if (runs.length === 0) return <span className="caption">no runs</span>;
  return (
    <span className="spark" title={`${runs.length} recent runs`}>
      {runs.slice(0, 8).reverse().map((r) => (
        <i key={r.id} className={`tick ${r.status}`} title={`${r.status} · ${ago(r.started_at)}`} />))}
    </span>
  );
}

export default function Jobs() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const jobs = usePoll(api.jobs, 4000);
  const runs = usePoll(api.recentRuns, 4000);
  const [q, setQ] = useState("");

  const byJob = useMemo(() => {
    const map = new Map<string, JobRun[]>();
    (runs.data ?? []).forEach((r) => map.set(r.job_id, [...(map.get(r.job_id) ?? []), r]));
    return map;
  }, [runs.data]);

  const list = (jobs.data ?? []).filter((j) => !q || j.name.toLowerCase().includes(q.toLowerCase()));
  const scheduled = (jobs.data ?? []).filter((j) => j.schedule?.enabled).length;
  const failing = (runs.data ?? []).slice(0, 20).filter((r) => r.status === "failed").length;

  async function run(job: Job) {
    try {
      await api.runJob(job.id);
      toast(`Started “${job.name}”`);
      router.push(`/jobs/${job.id}?tab=runs`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <PageHead title="Jobs" subtitle="Pipelines of tasks across Sail, notebooks, Python and both dbt engines."
        actions={<Link href="/jobs/new" className="btn primary" style={{ textDecoration: "none" }}><Icon name="play" size={13} /> Create job</Link>} />
      <div className="grid-cards">
        <div className="card pad stat"><div className="label">Jobs</div><div className="value">{jobs.data?.length ?? "—"}</div></div>
        <div className="card pad stat"><div className="label">Scheduled</div><div className="value">{scheduled}</div><div className="caption">cron, UTC</div></div>
        <div className="card pad stat"><div className="label">Runs (recent)</div><div className="value">{runs.data?.length ?? "—"}</div></div>
        <div className="card pad stat"><div className="label">Failed lately</div><div className="value" style={{ color: failing ? "var(--text-danger)" : undefined }}>{failing}</div><div className="caption">of the last 20</div></div>
      </div>
      <div className="row-actions">
        <input className="input" style={{ maxWidth: 260 }} placeholder="Filter jobs" aria-label="Filter jobs" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card">
        {jobs.error && !jobs.data ? <ErrorState title="Couldn't load jobs" error={jobs.error.message} onRetry={jobs.refresh} />
          : !jobs.data ? <Skeleton rows={4} height={28} />
          : list.length === 0 ? <EmptyState icon="clock" title={q ? "No jobs match that filter" : "No jobs yet"}
              hint={q ? undefined : "A job is a graph of tasks. Mix engines freely: a SQL task on Sail can run beside a dbt 2 task on DuckDB."}
              action={q ? <button className="btn" onClick={() => setQ("")}>Clear filter</button>
                : <Link href="/jobs/new" className="btn primary" style={{ textDecoration: "none" }}>Create your first job</Link>} />
          : <table className="tbl"><thead><tr><th>Job</th><th>Tasks</th><th>Schedule</th><th>History</th><th>Last run</th><th /></tr></thead>
              <tbody>{list.map((j) => {
                const last = j.last_run ?? byJob.get(j.id)?.[0];
                return (
                  <tr key={j.id}>
                    <td><Link href={`/jobs/${j.id}`}><strong>{j.name}</strong></Link>
                      {j.description && <div className="caption">{j.description}</div>}</td>
                    <td><span className="chips">{[...new Set(j.tasks.map((t) => t.type))].map((t) => <span key={t} className="chip">{TYPE_LABEL[t] ?? t}</span>)}</span></td>
                    <td className="mono caption">{j.schedule ? (j.schedule.enabled ? j.schedule.cron : `${j.schedule.cron} (paused)`) : "Manual"}</td>
                    <td><History runs={byJob.get(j.id) ?? []} /></td>
                    <td>{j.running ? <StatusBadge status="running" />
                      : last ? <><StatusBadge status={last.status} /><div className="caption">{ago(last.started_at)}
                        {last.finished_at && ` · ${duration(+new Date(last.finished_at) - +new Date(last.started_at))}`}</div></>
                      : <span className="caption">never</span>}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn sm" disabled={j.running} onClick={() => run(j)}>Run</button>{" "}
                      <button className="btn ghost sm" onClick={async () => {
                        if (await confirm({ title: `Delete “${j.name}”?`, body: "The job and its run history are removed.", confirm: "Delete", danger: true })) {
                          await api.deleteJob(j.id); jobs.refresh(); toast("Job deleted");
                        }
                      }}>Delete</button>
                    </td>
                  </tr>);
              })}</tbody></table>}
      </div>
    </div>
  );
}
