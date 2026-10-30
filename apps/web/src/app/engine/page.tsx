"use client";
import { api } from "@/lib/api";
import { uptime } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { ErrorState, Icon, PageHead, StatusBadge } from "@/components/ui";
import { useConfirm } from "@/components/kit";
import { useToast } from "@/components/Toast";
import { duration } from "@/lib/format";

export default function Engine() {
  const { data, error, refresh } = usePoll(api.engineStatus, 2000);
  const running = usePoll(api.runningQueries, 2000);
  const recent = usePoll(api.recentQueries, 4000);
  const confirm = useConfirm();
  const toast = useToast();

  if (error && !data)
    return <div className="page"><PageHead title="Engine status" />
      <div className="card"><ErrorState title="Can't reach the Sail engine" error={error.message} onRetry={refresh} /></div></div>;
  if (!data) return <div className="page"><PageHead title="Engine status" /><div className="caption">Loading…</div></div>;

  return (
    <div className="page">
      <PageHead title="Engine status" subtitle="Sail, supervised by the platform API."
        actions={<button className="btn" onClick={async () => {
          if (await confirm({
            title: "Restart the Sail engine?",
            body: "Running queries stop and the in-memory catalog is lost. Uploads and the demo dbt project are rebuilt right after.",
            confirm: "Restart engine", danger: true,
          })) { await api.restartEngine(); toast("Engine restarting — rebuilding the catalog"); refresh(); }
        }}><Icon name="refresh" size={14} /> Restart engine</button>} />
      <div className="grid-cards">
        <div className="card pad stat"><div className="label">State</div>
          <div className="value"><StatusBadge status={data.state} /></div></div>
        <div className="card pad stat"><div className="label">Uptime</div><div className="value">{uptime(data.uptime_seconds)}</div></div>
        <div className="card pad stat"><div className="label">Sail / Spark</div>
          <div className="value">{data.sail_version ?? "—"} / {data.spark_version ?? "—"}</div></div>
        <div className="card pad stat"><div className="label">Restarts</div><div className="value">{data.restart_count}</div></div>
      </div>
      {data.last_error && <div className="errblock">{data.last_error}</div>}
      <div className="card"><table className="tbl">
        <thead><tr><th>Interface</th><th>Address</th><th>PID</th><th>Alive</th><th>Reachable</th><th>Restarts</th></tr></thead>
        <tbody>{data.processes.map((p) => (
          <tr key={p.interface}>
            <td>{p.interface}</td><td className="mono">{p.host}:{p.port}</td><td className="mono">{p.pid ?? "—"}</td>
            <td><StatusBadge status={p.alive ? "success" : "error"} label={p.alive ? "alive" : "dead"} /></td>
            <td><StatusBadge status={p.reachable ? "success" : "error"} label={p.reachable ? "yes" : "no"} /></td>
            <td className="num">{p.restart_count}</td>
          </tr>))}</tbody>
      </table></div>
      <div className="card">
        <div className="detail-head"><h3 style={{ flex: 1 }}>Queries</h3>
          <span className="caption">{running.data?.length ?? 0} running</span></div>
        <table className="tbl"><thead><tr><th>State</th><th>SQL</th><th>Started</th><th>Took</th><th /></tr></thead>
          <tbody>
            {[...(running.data ?? []), ...(recent.data ?? [])].slice(0, 12).map((q) => (
              <tr key={q.query_id}>
                <td><StatusBadge status={q.state} /></td>
                <td className="mono" style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.sql.replace(/\s+/g, " ")}</td>
                <td className="caption">{new Date(q.started_at).toLocaleTimeString()}</td>
                <td className="caption">{duration(q.duration_ms)}</td>
                <td style={{ textAlign: "right" }}>{q.state === "running" &&
                  <button className="btn ghost sm" onClick={() => api.cancelQuery(q.query_id).then(() => running.refresh())}>Cancel</button>}</td>
              </tr>))}
            {(running.data?.length ?? 0) + (recent.data?.length ?? 0) === 0 && (
              <tr><td colSpan={5} className="caption" style={{ padding: 14 }}>No queries yet in this engine session.</td></tr>)}
          </tbody></table>
      </div>
      {data.processes.map((p) => (
        <div key={p.interface}>
          <h3 style={{ margin: "8px 0" }}>{p.interface} log</h3>
          <div className="log">{p.log_tail.length ? p.log_tail.join("\n") : "No output yet."}</div>
        </div>))}
    </div>
  );
}
