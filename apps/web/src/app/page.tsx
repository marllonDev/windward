"use client";
import Link from "next/link";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import { Icon, StatusBadge } from "@/components/ui";

const FEATURES = [
  { icon: "terminal", title: "SQL console", text: "Tabbed editor, saved queries, explain plans, charts and CSV export." },
  { icon: "notebook", title: "Notebooks", text: "Mix SQL, PySpark and notes in one document, with a persistent Python kernel." },
  { icon: "database", title: "Catalog and uploads", text: "Browse tables, preview rows, and turn a CSV, JSON or Parquet file into a table." },
  { icon: "dbt", title: "dbt project", text: "Seed, run and test models; follow streaming logs and the lineage graph." },
  { icon: "engine", title: "Engine status", text: "See exactly what the supervised Sail processes are doing, including when they die." },
] as const;

export default function Landing() {
  const { data, error } = usePoll(api.engineStatus, 5000);
  return (
    <div className="hero">
      <div className="row-actions" style={{ marginBottom: 20 }}>
        <span className="label">Engine</span>
        {error ? <StatusBadge status="error" label="offline" />
          : data ? <StatusBadge status={data.state} label={`online · Sail ${data.sail_version ?? "?"}`} />
          : <StatusBadge status="idle" label="checking" />}
      </div>
      <h1>Your data platform, one command away.</h1>
      <p className="lead">
        Windward is a self-hostable, Rust-native data platform. Sail runs your Spark SQL without a JVM,
        dbt transforms it, and everything lives in containers on your own machine.
      </p>
      <div className="row-actions">
        <Link href="/console" className="btn primary" style={{ textDecoration: "none" }}>
          <Icon name="play" size={14} /> Get started
        </Link>
        <Link href="/dbt" className="btn" style={{ textDecoration: "none" }}>Open the dbt project</Link>
      </div>
      <div className="grid-cards" style={{ marginTop: 40 }}>
        {FEATURES.map((f) => (
          <div key={f.title} className="card pad">
            <div style={{ color: "var(--action-primary)" }}><Icon name={f.icon} size={24} /></div>
            <h3 style={{ margin: "10px 0 4px" }}>{f.title}</h3>
            <div style={{ color: "var(--text-secondary)" }}>{f.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
