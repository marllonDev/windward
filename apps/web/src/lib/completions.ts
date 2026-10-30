"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

/** Database, table and column names from the live catalog, for editor autocomplete. */
export function useCatalogWords(version = 0): string[] {
  const [words, setWords] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      const out = new Set<string>();
      try {
        const dbs = (await api.query("SHOW DATABASES")).rows.map((r) => String(r[0]));
        const tables: string[] = [];
        for (const db of dbs) {
          out.add(db);
          const r = await api.query(`SHOW TABLES IN ${db}`);
          const col = Math.max(r.columns.findIndex((c) => c.name.toLowerCase() === "tablename"), 0) || 1;
          for (const row of r.rows) {
            const t = String(row[col]);
            out.add(t);
            out.add(`${db}.${t}`);
            tables.push(`${db}.${t}`);
          }
        }
        for (const t of tables.slice(0, 25)) {
          try {
            (await api.query(`SELECT * FROM ${t} LIMIT 0`, 1)).columns.forEach((c) => out.add(c.name));
          } catch {
            /* a table that cannot be read just contributes no columns */
          }
        }
      } catch {
        /* completions are a convenience; the editor works without them */
      }
      if (live) setWords([...out]);
    })();
    return () => { live = false; };
  }, [version]);
  return words;
}
