"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import { Icon, StatusBadge } from "./ui";

const ITEMS = [
  { href: "/console", label: "SQL console", icon: "terminal" },
  { href: "/notebooks", label: "Notebooks", icon: "notebook" },
  { href: "/catalog", label: "Catalog", icon: "database" },
  { href: "/history", label: "Query history", icon: "history" },
  { href: "/dbt", label: "dbt project", icon: "dbt" },
  { href: "/engine", label: "Engine status", icon: "engine" },
] as const;

export default function Nav() {
  const path = usePathname();
  const { data, error } = usePoll(api.engineStatus, 5000);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("windward.theme");
      if (saved === "light" || saved === "dark") {
        document.documentElement.dataset.theme = saved;
        setTheme(saved);
      }
    } catch {
      /* theme follows the OS when storage is unavailable */
    }
  }, []);

  function toggle() {
    const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem("windward.theme", next);
    } catch {
      /* ignore */
    }
  }

  return (
    <nav className="nav" aria-label="Main">
      <Link href="/" className="brand" style={{ color: "inherit", textDecoration: "none" }}>
        <Icon name="sail" size={24} /> Windward
      </Link>
      {ITEMS.map((item) => (
        <Link key={item.href} href={item.href} className={`item${path === item.href || path.startsWith(item.href + "/") ? " active" : ""}`}
          aria-current={path === item.href ? "page" : undefined}>
          <Icon name={item.icon} /> {item.label}
        </Link>
      ))}
      <div className="spacer" />
      <div className="caption" style={{ padding: "0 10px 6px" }}>Sail engine</div>
      <div style={{ padding: "0 10px 12px" }}>
        {error ? <StatusBadge status="error" label="unreachable" />
          : data ? <StatusBadge status={data.state} /> : <StatusBadge status="idle" label="checking" />}
      </div>
      <button className="btn ghost sm" onClick={toggle} aria-label="Toggle colour theme">
        <Icon name="sun" size={16} /> Theme
      </button>
    </nav>
  );
}
