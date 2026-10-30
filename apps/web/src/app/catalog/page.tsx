"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, type QueryResult } from "@/lib/api";
import CatalogTree, { loadColumns, type Selected } from "@/components/CatalogTree";
import ResultPanel from "@/components/ResultPanel";
import { EmptyState, ErrorState, Icon, PageHead } from "@/components/ui";

type Col = { name: string; type: string };
type Detail = "columns" | "preview" | "details";

export default function Catalog() {
  const router = useRouter();
  const [selected, setSelected] = useState<Selected>(null);
  const [filter, setFilter] = useState("");
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Detail>("columns");
  const [cols, setCols] = useState<Col[] | null>(null);
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [info, setInfo] = useState<QueryResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    setCols(null); setPreview(null); setInfo(null); setError(null);
    const name = `${selected.db}.${selected.table}`;
    loadColumns(selected.db, selected.table).then((c) => live && setCols(c)).catch((e) => live && setError(e));
    api.query(`SELECT * FROM ${name}`, 100).then((r) => live && setPreview(r)).catch(() => undefined);
    api.query(`DESCRIBE TABLE EXTENDED ${name}`).then((r) => live && setInfo(r)).catch(() => undefined);
    return () => { live = false; };
  }, [selected, version]);

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    setNotice(null);
    try {
      const up = await api.upload(files[0]);
      setNotice(`Created ${up.table} (${(up.bytes / 1024).toFixed(1)} KB)`);
      setVersion((v) => v + 1);
    } catch (e) {
      setNotice(`Upload failed: ${(e as Error).message}`);
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  const name = selected ? `${selected.db}.${selected.table}` : "";
  return (
    <div className="page">
      <PageHead title="Catalog" subtitle="Databases, tables, and data you upload."
        actions={<>
          <input ref={fileInput} type="file" hidden accept=".csv,.tsv,.json,.jsonl,.parquet"
            onChange={(e) => onUpload(e.target.files)} />
          <button className="btn" onClick={() => fileInput.current?.click()}><Icon name="upload" size={15} /> Upload data</button>
          <button className="btn" onClick={() => { api.syncUploads().catch(() => undefined).then(() => setVersion((v) => v + 1)); }}>
            <Icon name="refresh" size={15} /> Refresh</button>
        </>} />
      {notice && <div className="caption" role="status">{notice} (CSV, TSV, JSON, JSON Lines and Parquet are supported)</div>}
      <div className="split" style={{ gridTemplateColumns: "320px 1fr" }}>
        <div className="card pad">
          <input className="input" placeholder="Filter tables" aria-label="Filter tables" value={filter}
            onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 12 }} />
          <CatalogTree selected={selected} onSelect={setSelected} filter={filter} version={version} />
        </div>
        <div className="card">
          {!selected ? <EmptyState icon="table" title="Select a table or view to see its details"
              hint="Or upload a CSV, JSON or Parquet file to create a table." />
            : error ? <ErrorState title={`Couldn't load metadata for ${name}`} error={error.message}
                onRetry={() => setVersion((v) => v + 1)} />
            : <>
              <div style={{ padding: "16px 16px 0", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}><h2 className="mono">{name}</h2>
                  <div className="caption">{cols ? `${cols.length} columns` : "Loading…"}</div></div>
                <button className="btn primary" onClick={() => {
                  try { sessionStorage.setItem("windward.rerun", `select * from ${name} limit 100;`); } catch { /* ignore */ }
                  router.push("/console");
                }}>Query in console</button>
              </div>
              <div className="tabs" role="tablist" style={{ padding: "0 16px", marginTop: 8 }}>
                {(["columns", "preview", "details"] as Detail[]).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>))}
              </div>
              {tab === "columns" && (!cols ? <div className="caption" style={{ padding: 16 }}>Loading…</div> :
                <table className="tbl"><thead><tr><th>Column</th><th>Type</th></tr></thead>
                  <tbody>{cols.map((c) => <tr key={c.name}><td className="mono">{c.name}</td><td className="mono">{c.type}</td></tr>)}</tbody></table>)}
              {tab === "preview" && (!preview ? <div className="caption" style={{ padding: 16 }}>Loading sample…</div> :
                <div style={{ padding: 12 }}><ResultPanel filename={selected.table} maxHeight="50vh" data={{
                  columns: preview.columns.map((c) => c.name), types: preview.columns.map((c) => c.type), rows: preview.rows,
                  footer: "first 100 rows" }} /></div>)}
              {tab === "details" && (!info ? <div className="caption" style={{ padding: 16 }}>Loading…</div> :
                <table className="tbl"><tbody>{info.rows.filter((r) => r[0]).map((r, i) => (
                  <tr key={i}><td className="mono" style={{ width: 220 }}>{String(r[0])}</td><td className="mono">{String(r[1] ?? "")}</td></tr>))}</tbody></table>)}
            </>}
        </div>
      </div>
    </div>
  );
}
