"use client";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { api, type Job, type JobDraft, type JobRun, type JobTask, type TaskRun, type TaskType } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import { useCatalogWords } from "@/lib/completions";
import CodeEditor from "@/components/CodeEditor";
import Dag from "@/components/Dag";
import ResultPanel from "@/components/ResultPanel";
import { useToast } from "@/components/Toast";
import { ErrorState, Icon, PageHead, StatusBadge } from "@/components/ui";
import { ago } from "@/lib/format";

const TYPES: { type: TaskType; label: string; hint: string }[] = [
  { type: "sql", label: "SQL", hint: "Statements on Sail" },
  { type: "notebook", label: "Notebook", hint: "Run a notebook top to bottom" },
  { type: "python", label: "Python", hint: "PySpark script on Sail" },
  { type: "dbt_sail", label: "dbt on Sail", hint: "dbt 1.x runner against Sail" },
  { type: "dbt2", label: "dbt 2", hint: "dbt 2 project on DuckDB" },
];
const PRESETS = [
  ["Every 5 minutes", "*/5 * * * *"], ["Hourly", "0 * * * *"], ["Daily at 02:00", "0 2 * * *"], ["Mondays at 06:00", "0 6 * * 1"],
];
const blank = (): JobDraft => ({ name: "Untitled job", description: "", schedule: null, tasks: [] });

function newTask(type: TaskType, taken: string[]): JobTask {
  let n = 1;
  while (taken.includes(`${type}_${n}`)) n += 1;
  const config: Record<string, string> = type === "sql" ? { sql: "select 1;" } : type === "python" ? { code: "spark.sql('select 1').show()" }
    : type === "dbt_sail" ? { command: "build" } : type === "dbt2" ? { project: "", command: "build" } : { notebook_id: "" };
  return { key: `${type}_${n}`, name: "", type, depends_on: [], config, timeout_seconds: 3600 };
}

function TaskForm({ task, others, onChange }: { task: JobTask; others: JobTask[]; onChange: (t: JobTask) => void }) {
  const notebooks = usePoll(api.notebooks, 30000).data ?? [];
  const projects = usePoll(api.dbt2Projects, 30000).data ?? [];
  const words = useCatalogWords();
  const set = (patch: Partial<JobTask>) => onChange({ ...task, ...patch });
  const cfg = (k: string, v: string) => set({ config: { ...task.config, [k]: v } });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="form-row">
        <label>Task key<input className="input mono" value={task.key} onChange={(e) => set({ key: e.target.value.replace(/[^\w-]/g, "") })} /></label>
        <label>Type<select className="input" value={task.type} onChange={(e) => onChange({ ...newTask(e.target.value as TaskType, []), key: task.key, name: task.name, depends_on: task.depends_on })}>
          {TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</select></label>
        <label>Timeout (s)<input className="input" type="number" min={1} value={task.timeout_seconds} onChange={(e) => set({ timeout_seconds: Number(e.target.value) || 3600 })} /></label>
      </div>
      {task.type === "sql" && <label>SQL (statements separated by ;)<CodeEditor language="sql" value={task.config.sql ?? ""} completions={words} minLines={6} onChange={(v) => cfg("sql", v)} ariaLabel="Task SQL" /></label>}
      {task.type === "python" && <label>Python (spark is ready)<CodeEditor language="python" value={task.config.code ?? ""} minLines={6} onChange={(v) => cfg("code", v)} ariaLabel="Task Python" /></label>}
      {task.type === "notebook" && <label>Notebook<select className="input" value={task.config.notebook_id ?? ""} onChange={(e) => cfg("notebook_id", e.target.value)}>
        <option value="">Choose a notebook…</option>{notebooks.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>}
      {task.type === "dbt_sail" && <label>Command<select className="input" value={task.config.command} onChange={(e) => cfg("command", e.target.value)}>
        {["seed", "run", "test", "build"].map((c) => <option key={c}>{c}</option>)}</select>
        <span className="caption">Runs the bundled dbt project on Sail (dbt 1.x + dbt-sail).</span></label>}
      {task.type === "dbt2" && <div className="form-row">
        <label>Project<select className="input" value={task.config.project ?? ""} onChange={(e) => cfg("project", e.target.value)}>
          <option value="">Choose a dbt 2 project…</option>{projects.map((p) => <option key={p.name}>{p.name}</option>)}</select></label>
        <label>Command<select className="input" value={task.config.command} onChange={(e) => cfg("command", e.target.value)}>
          {["seed", "run", "test", "build", "compile", "parse"].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Select (optional)<input className="input mono" placeholder="tag:daily" value={task.config.select ?? ""} onChange={(e) => cfg("select", e.target.value)} /></label></div>}
      <fieldset className="deps"><legend className="label">Depends on</legend>
        {others.length === 0 ? <span className="caption">No other tasks yet.</span> : others.map((o) => (
          <label key={o.key} className="chk"><input type="checkbox" checked={task.depends_on.includes(o.key)}
            onChange={(e) => set({ depends_on: e.target.checked ? [...task.depends_on, o.key] : task.depends_on.filter((k) => k !== o.key) })} /> {o.key}</label>))}
      </fieldset>
    </div>
  );
}

function RunDetail({ runId }: { runId: string }) {
  const toast = useToast();
  const { data: run, refresh } = usePoll(() => api.jobRun(runId), 2000);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { setSel(null); }, [runId]);
  if (!run) return <div className="caption">Loading run…</div>;
  const task: TaskRun | undefined = run.tasks.find((t) => t.key === sel) ?? run.tasks.find((t) => t.status === "failed") ?? run.tasks[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="row-actions">
        <StatusBadge status={run.status} /> <span className="caption">{run.trigger} · started {ago(run.started_at)}{run.finished_at ? ` · took ${((+new Date(run.finished_at) - +new Date(run.started_at)) / 1000).toFixed(1)} s` : ""}</span>
        <div style={{ flex: 1 }} />
        {run.status === "running" && <button className="btn sm" onClick={() => api.cancelRun(run.id).then(() => { toast("Cancelling…"); refresh(); })}>Cancel run</button>}
      </div>
      <Dag nodes={run.tasks.map((t) => ({ id: t.key, label: t.key, sub: t.type, status: t.status, deps: t.depends_on }))} selected={task?.key} onSelect={setSel} />
      {task && <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="row-actions"><h3>{task.key}</h3><StatusBadge status={task.status} /></div>
        {task.error && <pre className="errblock">{task.error}</pre>}
        <div className="log" role="log">{task.log?.length ? task.log.join("\n") : "No output yet."}</div>
        {task.output && <ResultPanel maxHeight="260px" data={{ columns: task.output.columns, rows: task.output.rows, footer: "last result of this task" }} />}
      </div>}
    </div>
  );
}

function Builder() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const isNew = id === "new";
  const [draft, setDraft] = useState<JobDraft | null>(isNew ? blank() : null);
  const [error, setError] = useState<Error | null>(null);
  const [tab, setTab] = useState<"tasks" | "schedule" | "runs">((search.get("tab") as "runs") ?? "tasks");
  const [selKey, setSelKey] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const runs = usePoll<JobRun[]>(() => (isNew ? Promise.resolve([]) : api.jobRuns(id)), 3000);

  useEffect(() => { if (!isNew) api.job(id).then((j: Job) => { setDraft(j); setSelKey(j.tasks[0]?.key ?? null); }).catch(setError); }, [id, isNew]);
  useEffect(() => { if (tab === "runs" && !runId && runs.data?.[0]) setRunId(runs.data[0].id); }, [tab, runId, runs.data]);

  const edit = useCallback((fn: (d: JobDraft) => JobDraft) => { setDraft((d) => (d ? fn(d) : d)); setDirty(true); }, []);
  const dag = useMemo(() => (draft?.tasks ?? []).map((t) => ({ id: t.key, label: t.key, sub: t.type, deps: t.depends_on })), [draft]);

  async function save(): Promise<string | null> {
    if (!draft) return null;
    setSaving(true);
    try {
      const saved = isNew ? await api.createJob(draft) : await api.saveJob(id, draft);
      setDirty(false);
      toast("Job saved");
      if (isNew) router.replace(`/jobs/${saved.id}`);
      return saved.id;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    const jobId = dirty || isNew ? await save() : id;
    if (!jobId) return;
    const run = await api.runJob(jobId);
    toast("Run started");
    setTab("runs");
    setRunId(run.id);
    runs.refresh();
  }

  if (error) return <div className="page"><div className="card"><ErrorState title="Couldn't open this job" error={error.message} /></div></div>;
  if (!draft) return <div className="page"><div className="caption">Loading…</div></div>;
  const sel = draft.tasks.find((t) => t.key === selKey) ?? null;
  const updateTask = (key: string, t: JobTask) => edit((d) => ({
    ...d, tasks: d.tasks.map((x) => (x.key === key ? t : x.depends_on.includes(key) && t.key !== key ? { ...x, depends_on: x.depends_on.map((k) => (k === key ? t.key : k)) } : x)),
  }));

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <PageHead title={draft.name || "Untitled job"} subtitle={isNew ? "Define tasks, wire their dependencies, then run." : `${draft.tasks.length} task(s)`}
        actions={<>
          {dirty && <span className="caption">Unsaved changes</span>}
          <button className="btn" onClick={save} disabled={saving || !draft.tasks.length}>{saving ? "Saving…" : "Save"}</button>
          <button className="btn primary" onClick={runNow} disabled={!draft.tasks.length}><Icon name="play" size={13} /> Run now</button>
        </>} />
      <div className="form-row">
        <label>Name<input className="input" value={draft.name} onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))} /></label>
        <label style={{ flex: 2 }}>Description<input className="input" value={draft.description} onChange={(e) => edit((d) => ({ ...d, description: e.target.value }))} /></label>
      </div>
      <div className="tabs" role="tablist">
        {(["tasks", "schedule", "runs"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab === "tasks" && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Dag nodes={dag} selected={selKey} onSelect={setSelKey} empty="Add a task to start building the graph." />
        <div className="row-actions">
          <span className="label">Add task</span>
          {TYPES.map((t) => <button key={t.type} className="btn sm" title={t.hint} onClick={() => {
            const task = newTask(t.type, draft.tasks.map((x) => x.key));
            if (selKey && draft.tasks.length) task.depends_on = [selKey];
            edit((d) => ({ ...d, tasks: [...d.tasks, task] })); setSelKey(task.key);
          }}>+ {t.label}</button>)}
        </div>
        {sel && <div className="card pad">
          <div className="row-actions" style={{ marginBottom: 10 }}><h3>Task: {sel.key}</h3><div style={{ flex: 1 }} />
            <button className="btn ghost sm" onClick={() => { edit((d) => ({ ...d, tasks: d.tasks.filter((x) => x.key !== sel.key).map((x) => ({ ...x, depends_on: x.depends_on.filter((k) => k !== sel.key) })) })); setSelKey(null); }}>Remove task</button></div>
          <TaskForm task={sel} others={draft.tasks.filter((t) => t.key !== sel.key)} onChange={(t) => { updateTask(sel.key, t); setSelKey(t.key); }} />
        </div>}
      </div>}
      {tab === "schedule" && <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
        <label className="chk"><input type="checkbox" checked={!!draft.schedule} onChange={(e) => edit((d) => ({ ...d, schedule: e.target.checked ? { cron: "0 2 * * *", enabled: true } : null }))} /> Run on a schedule</label>
        {draft.schedule && <>
          <label>Cron expression (UTC)<input className="input mono" value={draft.schedule.cron} onChange={(e) => edit((d) => ({ ...d, schedule: { ...d.schedule!, cron: e.target.value } }))} /></label>
          <div className="row-actions">{PRESETS.map(([l, c]) => <button key={c} className="btn sm" onClick={() => edit((d) => ({ ...d, schedule: { ...d.schedule!, cron: c } }))}>{l}</button>)}</div>
          <label className="chk"><input type="checkbox" checked={draft.schedule.enabled} onChange={(e) => edit((d) => ({ ...d, schedule: { ...d.schedule!, enabled: e.target.checked } }))} /> Enabled (uncheck to pause)</label>
          <span className="caption">Five fields: minute hour day-of-month month day-of-week. A run is skipped while the previous one is still going.</span>
        </>}
      </div>}
      {tab === "runs" && (isNew ? <div className="caption">Save the job to see runs.</div> : <div className="split" style={{ gridTemplateColumns: "300px 1fr" }}>
        <div className="card" style={{ overflow: "auto" }}>
          {(runs.data ?? []).length === 0 ? <div className="state"><div className="caption">No runs yet. Press Run now.</div></div> :
            (runs.data ?? []).map((r) => (
              <button key={r.id} className={`row run-row${runId === r.id ? " selected" : ""}`} onClick={() => setRunId(r.id)}>
                <StatusBadge status={r.status} /><span className="caption">{r.trigger} · {ago(r.started_at)}</span></button>))}
        </div>
        <div>{runId ? <RunDetail runId={runId} /> : <div className="caption">Select a run.</div>}</div>
      </div>)}
    </div>
  );
}

export default function JobPage() {
  return <Suspense fallback={<div className="page"><div className="caption">Loading…</div></div>}><Builder /></Suspense>;
}
