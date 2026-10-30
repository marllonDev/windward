export type Column = { name: string; type: string; nullable: boolean };
export type QueryResult = {
  query_id: string;
  columns: Column[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  max_rows: number;
  duration_ms: number;
  warnings: string[];
};
export type EngineProcess = {
  interface: string; host: string; port: number; pid: number | null; alive: boolean;
  reachable: boolean; restart_count: number; last_exit_code: number | null; log_tail: string[];
};
export type EngineStatus = {
  state: string; generation: number; sail_version: string | null; spark_version: string | null;
  started_at: string | null; uptime_seconds: number | null; restart_count: number;
  last_error: string | null; processes: EngineProcess[];
};
export type DbtNode = {
  unique_id: string; name: string; resource_type: "model" | "seed" | "test";
  materialized: string | null; depends_on: string[];
};
export type DbtProject = {
  name: string | null; parsed: boolean; nodes: DbtNode[];
  dbt: { runner: string | null; dbt2: string | null };
};
export type DbtRun = {
  run_id: string; command: string; status: "running" | "succeeded" | "failed";
  started_at: string; finished_at: string | null; exit_code: number | null;
  nodes: { unique_id: string; status: string; execution_time: number | null; message: string | null }[];
  log: string[]; log_total: number;
};

export type SavedQuery = { id: string; name: string; sql: string; created_at: string; updated_at: string };
export type NotebookCell = {
  id: string; type: "sql" | "python" | "markdown"; source: string;
  output?: CellOutput | null;
};
export type CellOutput = {
  stdout?: string; error?: string | null; durationMs?: number | null;
  result?: { type: "table"; columns: string[]; rows: unknown[][]; truncated?: boolean }
    | { type: "text"; text: string } | null;
};
export type NotebookSummary = { id: string; name: string; updated_at: string; cell_count: number };
export type Notebook = NotebookSummary & { cells: NotebookCell[] };
export type Upload = { file: string; table: string; bytes: number };

export type TaskType = "sql" | "notebook" | "python" | "dbt_sail" | "dbt2";
export type JobTask = {
  key: string; name: string; type: TaskType; depends_on: string[];
  config: Record<string, string>; timeout_seconds: number;
};
export type Schedule = { cron: string; enabled: boolean };
export type TaskRun = {
  key: string; name: string; type: TaskType; depends_on: string[]; status: string;
  started_at: string | null; finished_at: string | null; log?: string[];
  output?: { columns: string[]; rows: unknown[][] } | null; error: string | null;
};
export type JobRun = {
  id: string; job_id: string; job_name: string; status: string; trigger: string;
  started_at: string; finished_at: string | null; tasks: TaskRun[];
};
export type Job = {
  id: string; name: string; description: string; schedule: Schedule | null; tasks: JobTask[];
  updated_at: string; last_run?: JobRun | null; running?: boolean;
};
export type JobDraft = Pick<Job, "name" | "description" | "schedule" | "tasks">;
export type Dbt2Project = { name: string; files: number; updated_at: string; has_warehouse: boolean };
export type Dbt2Run = {
  run_id: string; project: string; command: string; select: string | null; status: "running" | "succeeded" | "failed";
  started_at: string; finished_at: string | null; exit_code: number | null;
  nodes: { unique_id: string; status: string; execution_time: number | null; message: string | null }[];
  log: string[]; log_total: number;
};
export type GraphNode = {
  unique_id: string; name: string; resource_type: string; materialized: string | null; depends_on: string[];
};

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: { "content-type": "application/json" },
    });
  } catch (cause) {
    throw new ApiError("NETWORK", `Cannot reach the Windward API: ${String(cause)}`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      body?.error?.code ?? `HTTP_${response.status}`,
      body?.error?.message ?? response.statusText,
    );
  }
  return body as T;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method, cache: "no-store",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiError("NETWORK", `Cannot reach the Windward API: ${String(cause)}`);
  }
  if (response.status === 204) return undefined as T;
  const parsed = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(parsed?.error?.code ?? `HTTP_${response.status}`, parsed?.error?.message ?? response.statusText);
  return parsed as T;
}

export const api = {
  jobs: () => send<Job[]>("/api/v1/jobs", "GET"),
  job: (id: string) => send<Job>(`/api/v1/jobs/${id}`, "GET"),
  createJob: (job: JobDraft) => send<Job>("/api/v1/jobs", "POST", job),
  saveJob: (id: string, job: JobDraft) => send<Job>(`/api/v1/jobs/${id}`, "PUT", job),
  deleteJob: (id: string) => send<void>(`/api/v1/jobs/${id}`, "DELETE"),
  runJob: (id: string) => send<JobRun>(`/api/v1/jobs/${id}/run`, "POST"),
  jobRuns: (id: string) => send<JobRun[]>(`/api/v1/jobs/${id}/runs`, "GET"),
  recentRuns: () => send<JobRun[]>("/api/v1/job-runs", "GET"),
  jobRun: (id: string) => send<JobRun>(`/api/v1/job-runs/${id}`, "GET"),
  cancelRun: (id: string) => send<{ cancelled: boolean }>(`/api/v1/job-runs/${id}/cancel`, "POST"),
  dbt2Projects: () => send<Dbt2Project[]>("/api/v1/dbt2/projects", "GET"),
  dbt2Create: (name: string) => send<Dbt2Project>("/api/v1/dbt2/projects", "POST", { name }),
  dbt2Delete: (name: string) => send<void>(`/api/v1/dbt2/projects/${name}`, "DELETE"),
  dbt2Files: (name: string) => send<{ path: string; size: number }[]>(`/api/v1/dbt2/projects/${name}/files`, "GET"),
  dbt2Read: (name: string, path: string) =>
    send<{ content: string }>(`/api/v1/dbt2/projects/${name}/file?path=${encodeURIComponent(path)}`, "GET"),
  dbt2Write: (name: string, path: string, content: string) =>
    send<{ path: string }>(`/api/v1/dbt2/projects/${name}/file?path=${encodeURIComponent(path)}`, "PUT", { content }),
  dbt2DeleteFile: (name: string, path: string) =>
    send<void>(`/api/v1/dbt2/projects/${name}/file?path=${encodeURIComponent(path)}`, "DELETE"),
  dbt2Start: (name: string, command: string, select?: string) =>
    send<Dbt2Run>(`/api/v1/dbt2/projects/${name}/runs`, "POST", { command, select: select || null }),
  dbt2Runs: (name: string) => send<Dbt2Run[]>(`/api/v1/dbt2/projects/${name}/runs`, "GET"),
  dbt2Run: (id: string, after = 0) => send<Dbt2Run>(`/api/v1/dbt2/runs/${id}?after=${after}`, "GET"),
  dbt2Graph: (name: string) => send<{ parsed: boolean; nodes: GraphNode[] }>(`/api/v1/dbt2/projects/${name}/graph`, "GET"),
  dbt2Tables: (name: string) => send<{ schema: string; name: string; type: string }[]>(`/api/v1/dbt2/projects/${name}/tables`, "GET"),
  dbt2Query: (name: string, sql: string, limit = 500) =>
    send<{ columns: string[]; rows: unknown[][]; truncated: boolean }>(`/api/v1/dbt2/projects/${name}/query`, "POST", { sql, limit }),
  savedQueries: () => send<SavedQuery[]>("/api/v1/saved-queries", "GET"),
  saveQuery: (name: string, sql: string, id?: string) =>
    send<SavedQuery>("/api/v1/saved-queries", "POST", { name, sql, id }),
  deleteQuery: (id: string) => send<void>(`/api/v1/saved-queries/${id}`, "DELETE"),
  notebooks: () => send<NotebookSummary[]>("/api/v1/notebooks", "GET"),
  notebook: (id: string) => send<Notebook>(`/api/v1/notebooks/${id}`, "GET"),
  createNotebook: (name: string, cells: NotebookCell[]) =>
    send<Notebook>("/api/v1/notebooks", "POST", { name, cells }),
  saveNotebook: (id: string, name: string, cells: NotebookCell[]) =>
    send<Notebook>(`/api/v1/notebooks/${id}`, "PUT", { name, cells }),
  deleteNotebook: (id: string) => send<void>(`/api/v1/notebooks/${id}`, "DELETE"),
  runPython: (id: string, code: string) =>
    send<{ stdout: string; stderr: string; error: string | null; duration_ms: number | null;
      result: CellOutput["result"] }>(`/api/v1/notebooks/${id}/python`, "POST", { code }),
  restartKernel: (id: string) => send<void>(`/api/v1/notebooks/${id}/kernel/restart`, "POST"),
  uploads: () => send<Upload[]>("/api/v1/uploads", "GET"),
  syncUploads: () => send<{ registered: number }>("/api/v1/uploads/sync", "POST"),
  upload: async (file: File): Promise<Upload> => {
    let response: Response;
    try {
      response = await fetch(`/api/v1/uploads?name=${encodeURIComponent(file.name)}`, {
        method: "POST", body: file, headers: { "content-type": "application/octet-stream" },
      });
    } catch (cause) {
      throw new ApiError("NETWORK", `Cannot reach the Windward API: ${String(cause)}`);
    }
    const parsed = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(parsed?.error?.code ?? `HTTP_${response.status}`, parsed?.error?.message ?? response.statusText);
    return parsed as Upload;
  },
  engineStatus: () => request<EngineStatus>("/api/v1/engine/status"),
  query: (sql: string, maxRows?: number) =>
    request<QueryResult>("/api/v1/queries", {
      method: "POST",
      body: JSON.stringify({ sql, max_rows: maxRows }),
    }),
  dbtProject: () => request<DbtProject>("/api/v1/dbt/project"),
  dbtStart: (command: string) =>
    request<DbtRun>("/api/v1/dbt/runs", { method: "POST", body: JSON.stringify({ command }) }),
  dbtRun: (id: string, after = 0) => request<DbtRun>(`/api/v1/dbt/runs/${id}?after=${after}`),
  dbtRuns: () => request<DbtRun[]>("/api/v1/dbt/runs"),
};
