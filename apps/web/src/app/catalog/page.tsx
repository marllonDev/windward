"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CatalogHit, type QueryResult, type TableProfile } from "@/lib/api";
import CatalogTree, { type Selected } from "@/components/CatalogTree";
import ResultPanel from "@/components/ResultPanel";
import { CopyButton, Segmented, Skeleton, useConfirm } from "@/components/kit";
import { useToast } from "@/components/Toast";
import { EmptyState, ErrorState, Icon, PageHead } from "@/components/ui";

type Detail = "columns" | "preview" | "ddl";

function Bar({ pct, tone }: { pct: number; tone?: "warn" }) {
  return <span className="bar" aria-hidden="true"><span className={tone === "warn" ? "warn" : ""} style={{ width: `${Math.min(100, pct)}%` }} /></span>;
}

export default function Catalog() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<Selected>(null);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<CatalogHit[] | null>(null);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Detail>("columns");
  const [profile, setProfile] = useState<TableProfile | null>(null);
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [ddl, setDdl] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = usePollUploads(version);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    setProfile(null); setPreview(null); setDdl(null); setError(null);
    const { db, table } = selected;
    api.profile(db, table).then((p) => live && setProfile(p)).catch((e) => live && setError(e));
    api.query(`SELECT * FROM ${db}.${table}`, 200).then((r) => live && setPreview(r)).catch(() => undefined);
    api.ddl(db, table).then((r) => live && setDdl(r.ddl)).catch(() => undefined);
    return () => { live = false; };
  }, [selected, version]);

  const runSearch = useCallback(async (term: string) => {
    setSearch(term);
    if (term.trim().length < 2) { setHits(null); return; }
    try { setHits(await api.catalogSearch(term.trim())); } catch { setHits([]); }
  }, []);

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    try {
      const up = await api.upload(files[0]);
      toast(`Created ${up.table} from ${up.file}`);
      setVersion((v) => v + 1);
      const [db, table] = up.table.split(".");
      setSelected({ db, table });
    } catch (e) {
      toast((e as Error).message, "error");
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  async function drop() {
    if (!selected) return;
    const name = `${selected.db}.${selected.table}`;
    if (!(await confirm({ title: `Drop ${name}?`, body: "The table is removed from the catalog. An uploaded file stays on disk and comes back on the next refresh.", confirm: "Drop table", danger: true }))) return;
    try {
      await api.query(`DROP TABLE IF EXISTS ${name}`, 1);
      toast(`Dropped ${name}`);
      setSelected(null);
      setVersion((v) => v + 1);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const name = selected ? `${selected.db}.${selected.table}` : "";
  return (
    <div className="page">
      <PageHead title="Catalog" subtitle="Databases, tables, their shape and the data you upload."
        actions={<>
          <input ref={fileInput} type="file" hidden accept=".csv,.tsv,.json,.jsonl,.parquet" onChange={(e) => onUpload(e.target.files)} />
          <button className="btn" onClick={() => fileInput.current?.click()}><Icon name="upload" size={15} /> Upload data</button>
          <button className="btn ghost" onClick={() => { api.syncUploads().catch(() => undefined).then(() => setVersion((v) => v + 1)); }}>
            <Icon name="refresh" size={15} /> Refresh</button>
        </>} />
      <div className="card pad" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Icon name="search" size={16} />
        <input className="input" style={{ maxWidth: 420 }} placeholder="Search tables and columns everywhere" aria-label="Search the catalog"
          value={search} onChange={(e) => runSearch(e.target.value)} />
        {hits && <span className="caption">{hits.length} match{hits.length === 1 ? "" : "es"}</span>}
        {hits && <button className="btn ghost sm" onClick={() => { setSearch(""); setHits(null); }}>Clear</button>}
        {uploads.length > 0 && <span className="caption" style={{ marginLeft: "auto" }}>{uploads.length} uploaded file{uploads.length === 1 ? "" : "s"}</span>}
      </div>
      {hits && hits.length > 0 && (
        <div className="card"><table className="tbl"><tbody>{hits.slice(0, 40).map((h, i) => (
          <tr key={i} style={{ cursor: "pointer" }} onClick={() => { setSelected({ db: h.database, table: h.table }); setHits(null); setSearch(""); }}>
            <td style={{ width: 90 }}><span className="chip">{h.kind}</span></td>
            <td className="mono">{h.label}</td><td className="mono caption">{h.type ?? ""}</td>
          </tr>))}</tbody></table></div>)}
      <div className="split" style={{ gridTemplateColumns: "320px minmax(0, 1fr)" }}>
        <div className="card pad side">
          <input className="input" placeholder="Filter tables" aria-label="Filter tables" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="side-body"><CatalogTree selected={selected} onSelect={setSelected} filter={filter} version={version} /></div>
        </div>
        <div className="card" style={{ minWidth: 0 }}>
          {!selected ? <EmptyState icon="table" title="Select a table to inspect it"
              hint="You get its columns with null share and distinct counts, a 200-row preview and its DDL. Or upload a CSV, JSON or Parquet file to create a table." />
            : error ? <ErrorState title={`Couldn't profile ${name}`} error={error.message} onRetry={() => setVersion((v) => v + 1)} />
            : <>
              <div className="detail-head">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h2 className="mono">{name}</h2>
                  <div className="caption">{profile ? `${profile.row_count.toLocaleString()} rows · ${profile.columns.length} columns` : "Profiling…"}</div>
                </div>
                <button className="btn sm" onClick={() => {
                  try { sessionStorage.setItem("windward.rerun", `select * from ${name} limit 100;`); } catch { /* ignore */ }
                  router.push("/console");
                }}><Icon name="terminal" size={13} /> Query</button>
                <button className="btn ghost sm" onClick={drop}>Drop</button>
              </div>
              <div style={{ padding: "0 16px 10px" }}>
                <Segmented size="sm" value={tab} onChange={setTab} options={[
                  { value: "columns", label: "Columns" }, { value: "preview", label: "Preview" }, { value: "ddl", label: "DDL" }]} />
              </div>
              {tab === "columns" && (!profile ? <Skeleton rows={5} height={20} />
                : <div className="scroll"><table className="tbl"><thead><tr><th>Column</th><th>Type</th><th>Nulls</th><th>Distinct</th><th>Min</th><th>Max</th></tr></thead>
                    <tbody>{profile.columns.map((c) => (
                      <tr key={c.name}>
                        <td className="mono">{c.name}</td><td className="mono caption">{c.type}</td>
                        <td style={{ minWidth: 120 }}><Bar pct={c.null_pct} tone={c.null_pct > 50 ? "warn" : undefined} />
                          <span className="caption"> {c.null_pct}%</span></td>
                        <td className="num mono">{c.distinct.toLocaleString()}</td>
                        <td className="mono caption">{c.min ?? "—"}</td><td className="mono caption">{c.max ?? "—"}</td>
                      </tr>))}</tbody></table></div>)}
              {tab === "preview" && (!preview ? <Skeleton rows={6} height={20} />
                : <div style={{ padding: 12 }}><ResultPanel filename={selected.table} maxHeight="52vh" data={{
                    columns: preview.columns.map((c) => c.name), types: preview.columns.map((c) => c.type),
                    rows: preview.rows, footer: "first 200 rows" }} /></div>)}
              {tab === "ddl" && (!ddl ? <Skeleton rows={4} height={18} />
                : <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div><CopyButton small text={ddl} label="Copy DDL" /></div>
                    <pre className="log" style={{ margin: 0 }}>{ddl}</pre></div>)}
            </>}
        </div>
      </div>
    </div>
  );
}

function usePollUploads(version: number) {
  const [items, setItems] = useState<{ file: string; table: string }[]>([]);
  useEffect(() => { api.uploads().then(setItems).catch(() => setItems([])); }, [version]);
  return items;
}
