"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./ui";

/** A focus-trapped dialog. Esc and the scrim close it. */
export function Modal({ title, children, onClose, footer, wide }: {
  title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && box.current) {
        const focusable = box.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [href]");
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    box.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}
        ref={box} onMouseDown={(e) => e.stopPropagation()}>
        <header><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

type Ask = { title: string; body?: ReactNode; confirm?: string; danger?: boolean };
const ConfirmCtx = createContext<(ask: Ask) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

/** Replaces window.confirm so destructive actions read like the rest of the product. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<(Ask & { resolve: (v: boolean) => void }) | null>(null);
  const request = useCallback((a: Ask) => new Promise<boolean>((resolve) => setAsk({ ...a, resolve })), []);
  const answer = (value: boolean) => { ask?.resolve(value); setAsk(null); };
  return (
    <ConfirmCtx.Provider value={request}>
      {children}
      {ask && (
        <Modal title={ask.title} onClose={() => answer(false)}
          footer={<>
            <button className="btn" onClick={() => answer(false)}>Cancel</button>
            <button className={`btn ${ask.danger ? "danger" : "primary"}`} onClick={() => answer(true)}>{ask.confirm ?? "Confirm"}</button>
          </>}>
          {ask.body ?? "This cannot be undone."}
        </Modal>)}
    </ConfirmCtx.Provider>
  );
}

export function Skeleton({ rows = 3, height = 16 }: { rows?: number; height?: number }) {
  return (
    <div className="skel-wrap" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel" style={{ height, width: `${90 - (i % 3) * 18}%` }} />))}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size }: {
  value: T; options: { value: T; label: string; icon?: Parameters<typeof Icon>[0]["name"] }[];
  onChange: (v: T) => void; size?: "sm";
}) {
  return (
    <div className={`segmented${size === "sm" ? " sm" : ""}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={14} />}{o.label}
        </button>))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field"><span className="field-label">{label}</span>{children}
      {hint && <span className="caption">{hint}</span>}</label>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((item, i) => (
        <span key={item.label}>
          {i > 0 && <span className="sep" aria-hidden="true">/</span>}
          {item.href ? <a href={item.href}>{item.label}</a> : <span>{item.label}</span>}
        </span>))}
    </nav>
  );
}

/** Copies text and tells the user it happened. */
export function CopyButton({ text, label = "Copy", small }: { text: string | (() => string); label?: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button className={`btn ghost${small ? " sm" : ""}`} onClick={async () => {
      const value = typeof text === "function" ? text() : text;
      try { await navigator.clipboard.writeText(value); } catch { /* clipboard may be blocked */ }
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    }}>{done ? "Copied" : label}</button>
  );
}
