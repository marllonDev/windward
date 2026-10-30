"use client";
import { api } from "@/lib/api";
import { uptime } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { ErrorState, PageHead, StatusBadge } from "@/components/ui";

export default function Engine() {
  const { data, error, refresh } = usePoll(api.engineStatus, 2000);

  if (error && !data)
    return <div className="page"><PageHead title="Engine status" />
      <div className="card"><ErrorState title="Can't reach the Sail engine" error={error.message} onRetry={refresh} /></div></div>;
  if (!data) return <div className="page"><PageHead title="Engine status" /><div className="caption">Loading…</div></div>;

  return (
    <div className="page">
      <PageHead title="Engine status" subtitle="Sail, supervised by the platform API." />
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
      {data.processes.map((p) => (
        <div key={p.interface}>
          <h3 style={{ margin: "8px 0" }}>{p.interface} log</h3>
          <div className="log">{p.log_tail.length ? p.log_tail.join("\n") : "No output yet."}</div>
        </div>))}
    </div>
  );
}
