"use client";
import { STATUS_COLOR } from "./Dag";

export type Span = { key: string; label: string; status: string; start: string | null; end: string | null; attempt?: number };

/** A Gantt of one run: where each task sat in wall-clock time and how long it took. */
export default function Timeline({ spans, runStart, runEnd, onSelect, selected }: {
  spans: Span[]; runStart: string; runEnd: string | null;
  onSelect?: (key: string) => void; selected?: string | null;
}) {
  const t0 = new Date(runStart).getTime();
  const t1 = (runEnd ? new Date(runEnd).getTime() : Date.now());
  const total = Math.max(t1 - t0, 1000);
  const ticks = 4;
  return (
    <div className="timeline">
      <div className="tl-axis">
        {Array.from({ length: ticks + 1 }, (_, i) => (
          <span key={i} style={{ left: `${(i / ticks) * 100}%` }}>{((total * i) / ticks / 1000).toFixed(1)}s</span>))}
      </div>
      {spans.map((s) => {
        const start = s.start ? new Date(s.start).getTime() : t0;
        const end = s.end ? new Date(s.end).getTime() : t1;
        const left = Math.max(0, ((start - t0) / total) * 100);
        const width = Math.max(1.2, ((end - start) / total) * 100);
        const seconds = (end - start) / 1000;
        return (
          <button key={s.key} className={`tl-row${selected === s.key ? " on" : ""}`} onClick={() => onSelect?.(s.key)}>
            <span className="tl-name">{s.label}</span>
            <span className="tl-track">
              <span className="tl-bar" style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, background: STATUS_COLOR[s.status] ?? "var(--border-strong)" }}>
                <span className="tl-dur">{s.start ? `${seconds.toFixed(1)}s` : "not started"}{s.attempt && s.attempt > 1 ? ` · try ${s.attempt}` : ""}</span>
              </span>
            </span>
          </button>);
      })}
    </div>
  );
}
