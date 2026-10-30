"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useToast } from "@/components/Toast";
import { EmptyState, ErrorState, Icon, PageHead } from "@/components/ui";

export default function Dbt2Projects() {
  const router = useRouter();
  const toast = useToast();
  const { data, error, refresh } = usePoll(api.dbt2Projects, 8000);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function create() {
    setCreating(true);
    try {
      const p = await api.dbt2Create(name.trim());
      toast(`Created ${p.name} with a starter project`);
      router.push(`/dbt2/${p.name}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <PageHead title="dbt 2 projects" subtitle="Write and run dbt 2 projects. They build into DuckDB, independent from Sail." />
      <div className="card pad row-actions">
        <input className="input" style={{ maxWidth: 280 }} placeholder="project_name" aria-label="New project name" value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} onKeyDown={(e) => e.key === "Enter" && name && create()} />
        <button className="btn primary" disabled={!name || creating} onClick={create}><Icon name="play" size={13} /> Create project</button>
        <span className="caption">Starts with a seed, a staging view, a mart table and tests.</span>
      </div>
      <div className="card">
        {error && !data ? <ErrorState title="Couldn't load projects" error={error.message} onRetry={refresh} />
          : data && data.length === 0 ? <EmptyState icon="dbt" title="No dbt 2 projects yet" hint="Create one above to get a working starter project you can edit and run." />
          : <table className="tbl"><thead><tr><th>Project</th><th>Files</th><th>Warehouse</th><th>Updated</th><th /></tr></thead>
              <tbody>{(data ?? []).map((p) => (
                <tr key={p.name}>
                  <td><Link href={`/dbt2/${p.name}`}><strong className="mono">{p.name}</strong></Link></td><td>{p.files}</td>
                  <td>{p.has_warehouse ? <span className="badge success"><span className="dot" />built</span> : <span className="caption">not built yet</span>}</td>
                  <td className="caption">{ago(p.updated_at)}</td>
                  <td style={{ textAlign: "right" }}><button className="btn ghost sm" onClick={() => confirm(`Delete ${p.name} and its DuckDB file?`) && api.dbt2Delete(p.name).then(refresh)}>Delete</button></td>
                </tr>))}</tbody></table>}
      </div>
    </div>
  );
}
