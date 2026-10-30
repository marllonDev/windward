import type { ReactNode } from "react";

type IconName =
  | "terminal" | "database" | "history" | "dbt" | "engine" | "table" | "search" | "x" | "play"
  | "check" | "alert" | "chevron" | "folder" | "sail" | "clock" | "refresh" | "sun" | "notebook" | "upload";

const PATHS: Record<IconName, ReactNode> = {
  terminal: <><path d="M4 6l5 5-5 5" /><path d="M12 17h8" /></>,
  database: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 8v5l3 2" /></>,
  dbt: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="12" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8.3 7l7.4 4M8.3 17l7.4-4" /></>,
  engine: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 9h6v6H9zM9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  x: <><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>,
  play: <path d="M7 4l13 8-13 8z" />,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.01" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  sail: <><path d="M12 3v15" /><path d="M12 4c4 3 6 7 6 12h-6" /><path d="M12 8c-3 2-5 5-5 8h5" /><path d="M4 20h16" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14-4L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14 4l2-2" /><path d="M20 20v-5h-5" /></>,
  notebook: <><path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6z" /><path d="M6 3v18M10 8h5M10 12h5" /></>,
  upload: <><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></>,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

const STATUS_KIND: Record<string, "running" | "success" | "warning" | "error" | "idle" | "queued"> = {
  running: "running", succeeded: "success", success: "success", pass: "success", failed: "error",
  error: "error", fail: "error", stopped: "error", starting: "warning", restarting: "warning",
  warn: "warning", skipped: "idle", idle: "idle", queued: "queued",
};

/** Never colour-only: dot + icon-weight shape + the text label (design system §2.6). */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const kind = STATUS_KIND[status.toLowerCase()] ?? "idle";
  return (
    <span className={`badge ${kind}`}>
      <span className="dot" aria-hidden="true" />
      {label ?? status}
    </span>
  );
}

export function EmptyState({ icon, title, hint, action }: {
  icon: IconName; title: string; hint?: string; action?: ReactNode;
}) {
  return (
    <div className="state">
      <Icon name={icon} size={44} />
      <div className="primary">{title}</div>
      {hint && <div className="caption" style={{ maxWidth: 420 }}>{hint}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ title, error, onRetry }: { title: string; error: string; onRetry?: () => void }) {
  return (
    <div className="state err" role="alert">
      <Icon name="x" size={44} />
      <div className="primary">{title}</div>
      <pre className="errblock">{error}</pre>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          <Icon name="refresh" size={16} /> Retry
        </button>
      )}
    </div>
  );
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row-actions">{actions}</div>}
    </div>
  );
}
