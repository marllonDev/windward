"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api, type Job, type JobDraft, type JobRun, type JobTask, type TaskRun, type TaskType,
} from "@/lib/api";
import { ago, duration } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useCatalogWords } from "@/lib/completions";
import CodeEditor from "@/components/CodeEditor";
import Dag from "@/components/Dag";
import ResultPanel from "@/components/ResultPanel";
import Timeline from "@/components/Timeline";
import { Breadcrumbs, CopyButton, Field, Modal, Segmented, Skeleton, useConfirm } from "@/components/kit";
import { useToast } from "@/components/Toast";
import { EmptyState, ErrorState, Icon, StatusBadge } from "@/components/ui";

type Tab = "design" | "runs" | "settings";
const TYPES: { type: TaskType; label: string; icon: Parameters<typeof Icon>[0]["name"]; hint: string }[] = [
  { type: "sql", label: "SQL", icon: "terminal", hint: "Statements on the Sail engine" },
  { type: "notebook", label: "Notebook", icon: "notebook", hint: "Run a notebook top to bottom" },
  { type: "python", label: "Python", icon: "terminal", hint: "PySpark script on Sail" },
  { type: "dbt_sail", label: "dbt on Sail", icon: "dbt", hint: "The bundled dbt 1.x project" },
  { type: "dbt2", label: "dbt 2", icon: "dbt", hint: "A dbt 2 project on DuckDB" },
];
const ICON = Object.fromEntries(TYPES.map((t) => [t.type, t.icon])) as Record<TaskType, Parameters<typeof Icon>[0]["name"]>;
const LABEL = Object.fromEntries(TYPES.map((t) => [t.type, t.label])) as Record<TaskType, string>;
const PRESETS: [string, string][] = [
  ["Every 5 min", "*/5 * * * *"], ["Hourly", "0 * * * *"], ["Daily 02:00", "0 2 * * *"],
  ["Weekdays 06:00", "0 6 * * 1-5"], ["Mondays 06:00", "0 6 * * 1"],
];
const blank = (): JobDraft => ({ name: "Untitled job", description: "", schedule: null, parameters: [], tasks: [] });

function defaults(type: TaskType): Record<string, string> {
  return type === "sql" ? { sql: "select 1;" }
    : type === "python" ? { code: "spark.sql('select 1').show()" }
    : type === "dbt_sail" ? { command: "build" }
    : type === "dbt2" ? { project: "", command: "build" } : { notebook_id: "" };
}

function newTask(type: TaskType, taken: string[]): JobTask {
  let n = 1;
  while (taken.includes(`${type}_${n}`)) n += 1;
  return {
    key: `${type}_${n}`, name: "", type, depends_on: [], config: defaults(type),
    timeout_seconds: 3600, retries: 0, retry_delay_seconds: 30, continue_on_failure: false,
  };
}

function summary(task: JobTask): string {
  const c = task.config;
  if (task.type === "sql") return (c.sql ?? "").replace(/\s+/g, " ").slice(0, 40);
  if (task.type === "python") return (c.code ?? "").replace(/\s+/g, " ").slice(0, 40);
  if (task.type === "dbt2") return `${c.project || "no project"} · ${c.command}${c.select ? ` · ${c.select}` : ""}`;
  if (task.type === "dbt_sail") return `dbt ${c.command}`;
  return c.notebook_id ? "notebook" : "no notebook chosen";
}

/* ------------------------------------------------------------------ editor */
function TaskEditor({ task, others, onChange, onRemove, onDuplicate }: {
  task: JobTask; others: JobTask[]; onChange: (t: JobTask) => void; onRemove: () => void; onDuplicate: () => void;
}) {
  const notebooks = usePoll(api.notebooks, 30000).data ?? [];
  const projects = usePoll(api.dbt2Projects, 30000).data ?? [];
  const words = useCatalogWords();
  const set = (patch: Partial<JobTask>) => onChange({ ...task, ...patch });
  const cfg = (k: string, v: string) => set({ config: { ...task.config, [k]: v } });
  return (
    <div className="card pad task-editor">
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <Icon name={ICON[task.type]} size={16} /><h3 style={{ flex: 1 }}>{task.key}</h3>
        <button className="btn ghost sm" onClick={onDuplicate}>Duplicate</button>
        <button className="btn ghost sm" onClick={onRemove}>Remove</button>
      </div>
      <div className="form-row">
        <Field label="Task key"><input className="input mono" value={task.key}
          onChange={(e) => set({ key: e.target.value.replace(/[^\w-]/g, "") })} /></Field>
        <Field label="Type"><select className="input" value={task.type}
          onChange={(e) => { const type = e.target.value as TaskType; onChange({ ...task, type, config: defaults(type) }); }}>
          {TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</select></Field>
        <Field label="Display name (optional)"><input className="input" value={task.name} placeholder={task.key}
          onChange={(e) => set({ name: e.target.value })} /></Field>
      </div>
      {task.type === "sql" && <Field label="SQL" hint="Several statements separated by ; — the last result is kept. Use {{ parameter }} for job parameters.">
        <CodeEditor language="sql" value={task.config.sql ?? ""} completions={words} minLines={7} onChange={(v) => cfg("sql", v)} ariaLabel="Task SQL" /></Field>}
      {task.type === "python" && <Field label="Python" hint="`spark` is a Spark Connect session on Sail. Each run gets a fresh kernel.">
        <CodeEditor language="python" value={task.config.code ?? ""} minLines={7} onChange={(v) => cfg("code", v)} ariaLabel="Task Python" /></Field>}
      {task.type === "notebook" && <Field label="Notebook" hint="SQL and Python cells run in order; text cells are skipped.">
        <select className="input" value={task.config.notebook_id ?? ""} onChange={(e) => cfg("notebook_id", e.target.value)}>
          <option value="">Choose a notebook…</option>{notebooks.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></Field>}
      {task.type === "dbt_sail" && <Field label="Command" hint="Runs the bundled dbt project against Sail (dbt-core 1.x + dbt-sail).">
        <select className="input" value={task.config.command} onChange={(e) => cfg("command", e.target.value)}>
          {["seed", "run", "test", "build"].map((c) => <option key={c}>{c}</option>)}</select></Field>}
      {task.type === "dbt2" && <div className="form-row">
        <Field label="Project"><select className="input" value={task.config.project ?? ""} onChange={(e) => cfg("project", e.target.value)}>
          <option value="">Choose a dbt 2 project…</option>{projects.map((p) => <option key={p.name}>{p.name}</option>)}</select></Field>
        <Field label="Command"><select className="input" value={task.config.command} onChange={(e) => cfg("command", e.target.value)}>
          {["seed", "run", "test", "build", "compile", "parse"].map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Select" hint="dbt selector, optional"><input className="input mono" placeholder="stg_orders+"
          value={task.config.select ?? ""} onChange={(e) => cfg("select", e.target.value)} /></Field>
      </div>}
      <fieldset className="deps"><legend className="field-label">Runs after</legend>
        {others.length === 0 ? <span className="caption">Nothing else to wait for — this task starts the job.</span>
          : others.map((o) => (
            <label key={o.key} className="chk"><input type="checkbox" checked={task.depends_on.includes(o.key)}
              onChange={(e) => set({ depends_on: e.target.checked ? [...task.depends_on, o.key] : task.depends_on.filter((k) => k !== o.key) })} />
              <Icon name={ICON[o.type]} size={13} /> {o.key}</label>))}
      </fieldset>
      <details className="advanced"><summary>Retries and failure handling</summary>
        <div className="form-row" style={{ marginTop: 10 }}>
          <Field label="Timeout (s)"><input className="input" type="number" min={1} value={task.timeout_seconds}
            onChange={(e) => set({ timeout_seconds: Number(e.target.value) || 3600 })} /></Field>
          <Field label="Retries" hint="0–5 extra attempts"><input className="input" type="number" min={0} max={5} value={task.retries}
            onChange={(e) => set({ retries: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })} /></Field>
          <Field label="Retry delay (s)"><input className="input" type="number" min={0} value={task.retry_delay_seconds}
            onChange={(e) => set({ retry_delay_seconds: Math.max(0, Number(e.target.value) || 0) })} /></Field>
        </div>
        <label className="chk" style={{ marginTop: 10 }}><input type="checkbox" checked={task.continue_on_failure}
          onChange={(e) => set({ continue_on_failure: e.target.checked })} />
          Let downstream tasks run even if this one fails (the run is still marked failed)</label>
      </details>
    </div>
  );
}

/* --------------------------------------------------------------- run detail */
function RunView({ runId, onRunFrom }: { runId: string; onRunFrom: (key: string) => void }) {
  const toast = useToast();
  const { data: run, refresh } = usePoll(() => api.jobRun(runId), 1500);
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<"timeline" | "graph">("timeline");
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setSel(null); }, [runId]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [run]);
  if (!run) return <Skeleton rows={5} height={22} />;
  const task: TaskRun | undefined =
    run.tasks.find((t) => t.key === sel) ?? run.tasks.find((t) => t.status === "failed") ?? run.tasks[0];
  const took = run.finished_at ? +new Date(run.finished_at) - +new Date(run.started_at) : null;
  const counts = run.tasks.reduce<Record<string, number>>((a, t) => ({ ...a, [t.status]: (a[t.status] ?? 0) + 1 }), {});
  return (
    <div className="runview">
      <div className="row-actions">
        <StatusBadge status={run.status} />
        <span className="caption">{run.trigger} · started {ago(run.started_at)}{took !== null ? ` · ${duration(took)}` : ""}</span>
        <span className="chips">{Object.entries(counts).map(([k, v]) => <span key={k} className="chip">{v} {k}</span>)}</span>
        <div style={{ flex: 1 }} />
        <Segmented size="sm" value={view} onChange={setView}
          options={[{ value: "timeline", label: "Timeline" }, { value: "graph", label: "Graph" }]} />
        {run.status === "running" && <button className="btn sm" onClick={() => api.cancelRun(run.id).then(() => { toast("Cancelling the run…"); refresh(); })}>Cancel</button>}
      </div>
      {run.parameters && Object.keys(run.parameters).length > 0 && (
        <div className="caption">Parameters: {Object.entries(run.parameters).map(([k, v]) => `${k}=${v}`).join(", ")}</div>)}
      {view === "timeline"
        ? <Timeline runStart={run.started_at} runEnd={run.finished_at} selected={task?.key} onSelect={setSel}
            spans={run.tasks.map((t) => ({ key: t.key, label: t.key, status: t.status, start: t.started_at, end: t.finished_at, attempt: t.attempt }))} />
        : <Dag height={360} selected={task?.key} onSelect={setSel}
            nodes={run.tasks.map((t) => ({
              id: t.key, label: t.key, sub: LABEL[t.type] ?? t.type, status: t.status, deps: t.depends_on,
              meta: t.started_at && t.finished_at ? duration(+new Date(t.finished_at) - +new Date(t.started_at)) : undefined,
            }))} />}
      {task && (
        <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div className="row-actions">
            <Icon name={ICON[task.type] ?? "terminal"} size={15} /><h3>{task.key}</h3>
            <StatusBadge status={task.status} />
            {task.attempt && task.attempt > 1 ? <span className="caption">attempt {task.attempt}</span> : null}
            <div style={{ flex: 1 }} />
            <CopyButton small label="Copy log" text={() => (task.log ?? []).join("\n")} />
            <button className="btn sm" onClick={() => onRunFrom(task.key)}>Run from here</button>
          </div>
          {task.error && <pre className="errblock">{task.error}</pre>}
          <div className="log" ref={logRef} role="log">{task.log?.length ? task.log.join("\n") : "No output."}</div>
          {task.output && <ResultPanel maxHeight="240px" filename={task.key} data={{ columns: task.output.columns, rows: task.output.rows, footer: "last result of this task" }} />}
        </div>)}
    </div>
  );
}

/* -------------------------------------------------------------- the builder */
function Builder() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = id === "new";
  const [draft, setDraft] = useState<JobDraft | null>(isNew ? blank() : null);
  const [error, setError] = useState<Error | null>(null);
  const [tab, setTab] = useState<Tab>((search.get("tab") as Tab) ?? "design");
  const [selKey, setSelKey] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [askRun, setAskRun] = useState<{ only: string[] } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const runs = usePoll<JobRun[]>(() => (isNew ? Promise.resolve([]) : api.jobRuns(id)), 3000);

  useEffect(() => {
    if (isNew) return;
    api.job(id).then((j: Job) => {
      setDraft({ ...j, parameters: j.parameters ?? [] });
      setSelKey(j.tasks[0]?.key ?? null);
      setValues(Object.fromEntries((j.parameters ?? []).map((p) => [p.name, p.default])));
    }).catch(setError);
  }, [id, isNew]);
  useEffect(() => { if (tab === "runs" && !runId && runs.data?.[0]) setRunId(runs.data[0].id); }, [tab, runId, runs.data]);

  const edit = useCallback((fn: (d: JobDraft) => JobDraft) => { setDraft((d) => (d ? fn(d) : d)); setDirty(true); }, []);

  const save = useCallback(async (): Promise<string | null> => {
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
  }, [draft, id, isNew, router, toast]);

  const launch = useCallback(async (only: string[] = []) => {
    const jobId = dirty || isNew ? await save() : id;
    if (!jobId) return;
    try {
      const run = await api.runJob(jobId, values, only);
      toast(only.length ? `Running from ${only[0]}` : "Run started");
      setTab("runs");
      setRunId(run.id);
      runs.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [dirty, id, isNew, save, toast, values, runs]);

  function startRun(only: string[] = []) {
    if ((draft?.parameters.length ?? 0) > 0) setAskRun({ only });
    else launch(only);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const dag = useMemo(() => (draft?.tasks ?? []).map((t) => ({
    id: t.key, label: t.key, sub: LABEL[t.type], meta: summary(t), deps: t.depends_on,
  })), [draft]);

  if (error) return <div className="page"><div className="card"><ErrorState title="Couldn't open this job" error={error.message} /></div></div>;
  if (!draft) return <div className="page"><Skeleton rows={6} height={24} /></div>;

  const sel = draft.tasks.find((t) => t.key === selKey) ?? null;
  const rename = (from: string, to: JobTask) => edit((d) => ({
    ...d,
    tasks: d.tasks.map((x) => x.key === from ? to : { ...x, depends_on: x.depends_on.map((k) => (k === from ? to.key : k)) }),
  }));
  const addTask = (type: TaskType) => {
    const task = newTask(type, draft.tasks.map((x) => x.key));
    if (selKey) task.depends_on = [selKey];
    edit((d) => ({ ...d, tasks: [...d.tasks, task] }));
    setSelKey(task.key);
  };
  const lastRun = runs.data?.[0];

  return (
    <div className="page jobpage" style={{ maxWidth: 1280 }}>
      <div className="jobhead">
        <div style={{ minWidth: 0 }}>
          <Breadcrumbs items={[{ label: "Jobs", href: "/jobs" }, { label: draft.name || "Untitled job" }]} />
          <input className="nbtitle" aria-label="Job name" value={draft.name}
            onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))} />
          <div className="caption">{draft.tasks.length} task{draft.tasks.length === 1 ? "" : "s"}
            {draft.schedule ? ` · ${draft.schedule.enabled ? draft.schedule.cron : `${draft.schedule.cron} (paused)`}` : " · manual"}
            {lastRun ? ` · last run ${lastRun.status} ${ago(lastRun.started_at)}` : ""}</div>
        </div>
        <div className="row-actions">
          {dirty && <span className="caption">Unsaved</span>}
          <button className="btn" onClick={save} disabled={saving || !draft.tasks.length}>{saving ? "Saving…" : "Save"}</button>
          {!isNew && <button className="btn ghost" onClick={async () => {
            if (await confirm({ title: `Delete “${draft.name}”?`, body: "The job and its run history are removed.", confirm: "Delete", danger: true })) {
              await api.deleteJob(id); router.push("/jobs");
            }
          }}>Delete</button>}
          <button className="btn primary" onClick={() => startRun()} disabled={!draft.tasks.length}>
            <Icon name="play" size={13} /> Run now</button>
        </div>
      </div>
      <Segmented value={tab} onChange={setTab} options={[
        { value: "design", label: "Design" }, { value: "runs", label: `Runs${runs.data?.length ? ` (${runs.data.length})` : ""}` },
        { value: "settings", label: "Settings" }]} />

      {tab === "design" && (
        <div className="jobgrid">
          <aside className="card tasklist">
            <div className="tl-head"><span className="label">Tasks</span></div>
            {draft.tasks.length === 0 && <div className="caption" style={{ padding: 12 }}>No tasks yet. Add one below.</div>}
            {draft.tasks.map((t) => (
              <button key={t.key} className={`row task-row${selKey === t.key ? " selected" : ""}`} onClick={() => setSelKey(t.key)}>
                <Icon name={ICON[t.type]} size={15} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="mono clip">{t.key}</span>
                  <span className="caption clip">{summary(t)}</span>
                </span>
                {t.retries > 0 && <span className="chip">↻{t.retries}</span>}
              </button>))}
            <div className="tl-add">
              <span className="label">Add</span>
              <div className="addgrid">{TYPES.map((t) => (
                <button key={t.type} className="btn sm" title={t.hint} onClick={() => addTask(t.type)}>
                  <Icon name={t.icon} size={13} /> {t.label}</button>))}</div>
            </div>
          </aside>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <Dag nodes={dag} selected={selKey} onSelect={setSelKey} height={320}
              empty="Add a task on the left to start building the graph." />
            {sel ? <TaskEditor task={sel} others={draft.tasks.filter((t) => t.key !== sel.key)}
              onChange={(t) => { rename(sel.key, t); setSelKey(t.key); }}
              onDuplicate={() => {
                const copy = { ...sel, key: newTask(sel.type, draft.tasks.map((x) => x.key)).key };
                edit((d) => ({ ...d, tasks: [...d.tasks, copy] })); setSelKey(copy.key);
              }}
              onRemove={() => {
                edit((d) => ({ ...d, tasks: d.tasks.filter((x) => x.key !== sel.key).map((x) => ({ ...x, depends_on: x.depends_on.filter((k) => k !== sel.key) })) }));
                setSelKey(null);
              }} />
              : <div className="card"><EmptyState icon="clock" title="Select a task to edit it" hint="Or add one from the list on the left." /></div>}
          </div>
        </div>)}

      {tab === "runs" && (isNew ? <div className="caption">Save the job to see its runs.</div>
        : <div className="jobgrid">
            <aside className="card tasklist">
              <div className="tl-head"><span className="label">Run history</span>
                <button className="btn ghost sm" onClick={runs.refresh}><Icon name="refresh" size={13} /></button></div>
              {!runs.data ? <Skeleton rows={4} /> : runs.data.length === 0
                ? <div className="caption" style={{ padding: 12 }}>No runs yet. Press Run now.</div>
                : runs.data.map((r) => (
                  <button key={r.id} className={`row run-row${runId === r.id ? " selected" : ""}`} onClick={() => setRunId(r.id)}>
                    <StatusBadge status={r.status} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="caption clip">{ago(r.started_at)} · {r.trigger}</span>
                      <span className="caption clip">{r.finished_at ? duration(+new Date(r.finished_at) - +new Date(r.started_at)) : "running"}</span>
                    </span>
                  </button>))}
            </aside>
            <div style={{ minWidth: 0 }}>{runId ? <RunView runId={runId} onRunFrom={(k) => startRun([k])} />
              : <div className="card"><EmptyState icon="clock" title="Select a run" /></div>}</div>
          </div>)}

      {tab === "settings" && (
        <div className="settings-grid">
          <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h3>Schedule</h3>
            <label className="chk"><input type="checkbox" checked={!!draft.schedule}
              onChange={(e) => edit((d) => ({ ...d, schedule: e.target.checked ? { cron: "0 2 * * *", enabled: true } : null }))} />
              Run on a schedule</label>
            {draft.schedule && <>
              <Field label="Cron expression (UTC)" hint="minute hour day-of-month month day-of-week">
                <input className="input mono" value={draft.schedule.cron}
                  onChange={(e) => edit((d) => ({ ...d, schedule: { ...d.schedule!, cron: e.target.value } }))} /></Field>
              <div className="row-actions">{PRESETS.map(([l, c]) => (
                <button key={c} className={`btn sm${draft.schedule!.cron === c ? " primary" : ""}`}
                  onClick={() => edit((d) => ({ ...d, schedule: { ...d.schedule!, cron: c } }))}>{l}</button>))}</div>
              <label className="chk"><input type="checkbox" checked={draft.schedule.enabled}
                onChange={(e) => edit((d) => ({ ...d, schedule: { ...d.schedule!, enabled: e.target.checked } }))} />
                Enabled — uncheck to pause without losing the schedule</label>
              <span className="caption">A scheduled run is skipped while the previous one is still going, and ticks missed while the API was down are not replayed.</span>
            </>}
          </div>
          <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h3>Parameters</h3>
            <span className="caption">Write <code>{"{{ name }}"}</code> in a task&apos;s SQL, Python or dbt selector; the run substitutes the value.</span>
            {draft.parameters.map((p, i) => (
              <div key={i} className="form-row">
                <Field label="Name"><input className="input mono" value={p.name}
                  onChange={(e) => edit((d) => ({ ...d, parameters: d.parameters.map((x, j) => j === i ? { ...x, name: e.target.value.replace(/[^\w]/g, "") } : x) }))} /></Field>
                <Field label="Default"><input className="input" value={p.default}
                  onChange={(e) => edit((d) => ({ ...d, parameters: d.parameters.map((x, j) => j === i ? { ...x, default: e.target.value } : x) }))} /></Field>
                <button className="btn ghost sm" style={{ alignSelf: "end" }}
                  onClick={() => edit((d) => ({ ...d, parameters: d.parameters.filter((_, j) => j !== i) }))}>Remove</button>
              </div>))}
            <div><button className="btn sm" onClick={() => edit((d) => ({ ...d, parameters: [...d.parameters, { name: `param_${d.parameters.length + 1}`, default: "", description: "" }] }))}>+ Add parameter</button></div>
          </div>
          <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h3>About</h3>
            <Field label="Description"><input className="input" value={draft.description}
              onChange={(e) => edit((d) => ({ ...d, description: e.target.value }))} /></Field>
            {!isNew && <div className="caption">Job id <span className="mono">{id}</span></div>}
            <div><Link href="/jobs" className="caption">← Back to all jobs</Link></div>
          </div>
        </div>)}

      {askRun && (
        <Modal title="Run with parameters" onClose={() => setAskRun(null)}
          footer={<>
            <button className="btn" onClick={() => setAskRun(null)}>Cancel</button>
            <button className="btn primary" onClick={() => { const only = askRun.only; setAskRun(null); launch(only); }}>Run</button>
          </>}>
          {draft.parameters.map((p) => (
            <Field key={p.name} label={p.name} hint={p.description || undefined}>
              <input className="input" value={values[p.name] ?? p.default}
                onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))} /></Field>))}
          {askRun.only.length > 0 && <span className="caption">Running from <span className="mono">{askRun.only[0]}</span> and everything downstream.</span>}
        </Modal>)}
    </div>
  );
}

export default function JobPage() {
  return <Suspense fallback={<div className="page"><Skeleton rows={6} height={24} /></div>}><Builder /></Suspense>;
}
