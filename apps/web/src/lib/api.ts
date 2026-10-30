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
