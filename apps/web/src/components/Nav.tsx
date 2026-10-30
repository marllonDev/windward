"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import { Icon, StatusBadge } from "./ui";

type IconName = Parameters<typeof Icon>[0]["name"];
const GROUPS: { label: string; items: { href: string; label: string; icon: IconName }[] }[] = [
  { label: "Workspace", items: [
    { href: "/", label: "Home", icon: "sail" },
    { href: "/notebooks", label: "Notebooks", icon: "notebook" },
    { href: "/console", label: "SQL console", icon: "terminal" },
  ] },
  { label: "Data", items: [
    { href: "/catalog", label: "Catalog", icon: "database" },
    { href: "/history", label: "Query history", icon: "history" },
  ] },
  { label: "Workflows", items: [
    { href: "/jobs", label: "Jobs", icon: "clock" },
    { href: "/dbt2", label: "dbt 2 projects", icon: "dbt" },
    { href: "/dbt", label: "dbt on Sail", icon: "dbt" },
  ] },
  { label: "Platform", items: [{ href: "/engine", label: "Engine status", icon: "engine" }] },
];

export default function Nav() {
  const path = usePathname();
  const { data, error } = usePoll(api.engineStatus, 5000);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("windward.theme");
      if (saved === "light" || saved === "dark") { document.documentElement.dataset.theme = saved; setTheme(saved); }
      setCollapsed(localStorage.getItem("windward.nav") === "collapsed");
    } catch { /* theme follows the OS when storage is unavailable */ }
  }, []);

  useEffect(() => { document.documentElement.dataset.nav = collapsed ? "collapsed" : "open"; }, [collapsed]);

  function toggleTheme() {
    const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem("windward.theme", next); } catch { /* ignore */ }
  }

  function toggleNav() {
    setCollapsed((c) => {
      try { localStorage.setItem("windward.nav", c ? "open" : "collapsed"); } catch { /* ignore */ }
      return !c;
    });
  }

  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  return (
    <nav className="nav" aria-label="Main">
      <div className="brand"><Icon name="sail" size={24} /><span className="nav-text">Windward</span></div>
      <button className="search-btn" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))} title="Search and commands (⌘K)">
        <Icon name="search" size={15} /><span className="nav-text">Search</span><kbd className="nav-text">⌘K</kbd></button>
      {GROUPS.map((g) => (
        <div key={g.label} className="nav-group">
          <div className="nav-label nav-text">{g.label}</div>
          {g.items.map((item) => (
            <Link key={item.href} href={item.href} className={`item${active(item.href) ? " active" : ""}`} title={item.label}
              aria-current={active(item.href) ? "page" : undefined}><Icon name={item.icon} /><span className="nav-text">{item.label}</span></Link>))}
        </div>))}
      <div className="spacer" />
      <div className="nav-engine" title="Sail engine">
        {error ? <StatusBadge status="error" label="engine offline" /> : data ? <StatusBadge status={data.state} label={`Sail ${data.sail_version ?? ""}`} /> : <StatusBadge status="idle" label="checking" />}
      </div>
      <div className="row-actions" style={{ padding: "4px 6px" }}>
        <button className="btn ghost sm" onClick={toggleTheme} aria-label="Toggle colour theme"><Icon name="sun" size={16} /></button>
        <button className="btn ghost sm" onClick={toggleNav} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? "»" : "«"}</button>
      </div>
    </nav>
  );
}
