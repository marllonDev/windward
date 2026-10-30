"use client";
import { useEffect, useState } from "react";
import { Modal } from "./kit";

const GROUPS: [string, [string, string][]][] = [
  ["Everywhere", [["⌘K / Ctrl+K", "Command palette: pages, notebooks, jobs, queries"], ["?", "This list"], ["Esc", "Close a dialog"]]],
  ["SQL console", [["⌘↵ / Ctrl+↵", "Run (only the selection, if any)"], ["⌘S / Ctrl+S", "Save the query"], ["Tab / Shift+Tab", "Indent or outdent"], ["⌘/ / Ctrl+/", "Comment the line or selection"]]],
  ["Notebooks", [["Shift+↵", "Run the cell and move to the next"], ["⌘↵ / Ctrl+↵", "Run the cell"], ["Double-click", "Edit a text cell"]]],
  ["Results", [["Double-click a cell", "Expand the full value"], ["Click a column", "Sort; click again to reverse"], ["ⓘ on a column", "Null share, distinct count, range"]]],
  ["Jobs", [["⌘S / Ctrl+S", "Save the job"]]],
];

/** The `?` cheat sheet. Typing in a field never opens it. */
export default function Shortcuts() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable || el.tagName === "SELECT");
      if (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!open) return null;
  return (
    <Modal title="Keyboard shortcuts" onClose={() => setOpen(false)}>
      {GROUPS.map(([group, rows]) => (
        <div key={group}>
          <div className="label" style={{ marginBottom: 4 }}>{group}</div>
          <table className="tbl"><tbody>{rows.map(([k, what]) => (
            <tr key={k}><td style={{ width: 150 }}><kbd>{k}</kbd></td><td>{what}</td></tr>))}</tbody></table>
        </div>))}
    </Modal>
  );
}
