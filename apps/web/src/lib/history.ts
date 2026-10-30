// v0 keeps query history in this browser. The platform API owns history in a later
// milestone (ADR-0002); the screen reads through this module so that swap is local.
export type HistoryEntry = {
  id: string; sql: string; at: string; status: "succeeded" | "failed";
  durationMs: number | null; rows: number | null; error: string | null;
};
const KEY = "windward.history.v1";

export function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function addHistory(entry: Omit<HistoryEntry, "id" | "at">) {
  const all = loadHistory();
  all.unshift({ ...entry, id: crypto.randomUUID(), at: new Date().toISOString() });
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 200)));
  } catch {
    /* storage unavailable: history is a convenience, never a failure */
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
