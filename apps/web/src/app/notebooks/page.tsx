"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { starterCells } from "@/lib/starter";
import { usePoll } from "@/lib/hooks";
import { EmptyState, ErrorState, Icon, PageHead } from "@/components/ui";

export default function Notebooks() {
  const router = useRouter();
  const { data, error, refresh } = usePoll(api.notebooks, 10000);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const nb = await api.createNotebook("Untitled notebook", starterCells());
      router.push(`/notebooks/${nb.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <PageHead title="Notebooks" subtitle="SQL, Python and Markdown cells on the Sail engine."
        actions={<button className="btn primary" onClick={create} disabled={busy}><Icon name="play" size={13} /> New notebook</button>} />
      <div className="card">
        {error && !data ? <ErrorState title="Couldn't load notebooks" error={error.message} onRetry={refresh} />
          : data && data.length === 0 ? <EmptyState icon="terminal" title="No notebooks yet"
              hint="Create one to mix SQL, PySpark and notes in a single document."
              action={<button className="btn primary" onClick={create}>New notebook</button>} />
          : <table className="tbl"><thead><tr><th>Name</th><th>Cells</th><th>Updated</th><th /></tr></thead>
              <tbody>{(data ?? []).map((n) => (
                <tr key={n.id}>
                  <td><Link href={`/notebooks/${n.id}`}>{n.name}</Link></td>
                  <td>{n.cell_count}</td>
                  <td className="caption">{new Date(n.updated_at).toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}><button className="btn ghost sm"
                    onClick={() => confirm(`Delete "${n.name}"?`) && api.deleteNotebook(n.id).then(refresh)}>Delete</button></td>
                </tr>))}</tbody></table>}
      </div>
    </div>
  );
}
