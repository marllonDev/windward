"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { starterCells } from "@/lib/starter";
import { Icon } from "./ui";

type Item = { id: string; label: string; hint: string; run: () => void };

/** ⌘K / Ctrl+K: jump to any page, open any notebook, job, query or project, or create something. */
export default function Palette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const [dynamic, setDynamic] = useState<Item[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const go = useCallback((href: string) => { setOpen(false); router.push(href); }, [router]);

  const base: Item[] = useMemo(() => [
    ...([["Home", "/"], ["SQL console", "/console"], ["Notebooks", "/notebooks"], ["Catalog", "/catalog"], ["Query history", "/history"],
      ["Jobs", "/jobs"], ["dbt 2 projects", "/dbt2"], ["dbt on Sail", "/dbt"], ["Engine status", "/engine"]] as const)
      .map(([label, href]) => ({ id: href, label, hint: "Go to", run: () => go(href) })),
    { id: "new-notebook", label: "New notebook", hint: "Create", run: async () => { const n = await api.createNotebook("Untitled notebook", starterCells()); go(`/notebooks/${n.id}`); } },
    { id: "new-job", label: "New job", hint: "Create", run: () => go("/jobs/new") },
    { id: "new-dbt2", label: "New dbt 2 project", hint: "Create", run: () => go("/dbt2") },
    { id: "new-query", label: "New SQL query", hint: "Create", run: () => go("/console") },
    { id: "upload", label: "Upload data", hint: "Create", run: () => go("/catalog") },
  ], [go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); setQ(""); setIndex(0); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    Promise.allSettled([api.notebooks(), api.jobs(), api.savedQueries(), api.dbt2Projects()]).then(([nbs, jobs, qs, ps]) => {
      const out: Item[] = [];
      if (nbs.status === "fulfilled") nbs.value.forEach((n) => out.push({ id: `nb-${n.id}`, label: n.name, hint: "Notebook", run: () => go(`/notebooks/${n.id}`) }));
      if (jobs.status === "fulfilled") jobs.value.forEach((j) => out.push({ id: `job-${j.id}`, label: j.name, hint: "Job", run: () => go(`/jobs/${j.id}`) }));
      if (qs.status === "fulfilled") qs.value.forEach((s) => out.push({ id: `q-${s.id}`, label: s.name, hint: "Saved query", run: () => { try { sessionStorage.setItem("windward.rerun", s.sql); } catch { /* ignore */ } go("/console"); } }));
      if (ps.status === "fulfilled") ps.value.forEach((p) => out.push({ id: `p-${p.name}`, label: p.name, hint: "dbt 2 project", run: () => go(`/dbt2/${p.name}`) }));
      setDynamic(out);
    });
  }, [open, go]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...base, ...dynamic].filter((i) => !needle || i.label.toLowerCase().includes(needle) || i.hint.toLowerCase().includes(needle)).slice(0, 12);
  }, [base, dynamic, q]);

  if (!open) return null;
  return (
    <div className="palette-scrim" onMouseDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input"><Icon name="search" size={16} />
          <input ref={input} placeholder="Search pages, notebooks, jobs, queries — or type an action" value={q}
            onChange={(e) => { setQ(e.target.value); setIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && items[index]) { e.preventDefault(); items[index].run(); setOpen(false); }
            }} /></div>
        <ul role="listbox">
          {items.length === 0 && <li className="caption" style={{ padding: 12 }}>Nothing matches “{q}”.</li>}
          {items.map((it, i) => (
            <li key={it.id} role="option" aria-selected={i === index} className={i === index ? "on" : ""}
              onMouseEnter={() => setIndex(i)} onClick={() => { it.run(); setOpen(false); }}>
              <span>{it.label}</span><span className="caption">{it.hint}</span></li>))}
        </ul>
        <div className="caption palette-foot">↑↓ navigate · Enter open · Esc close</div>
      </div>
    </div>
  );
}
