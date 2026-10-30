"use client";
import { useRef } from "react";

export default function SqlEditor({ value, onChange, onRun }: {
  value: string; onChange: (v: string) => void; onRun: () => void;
}) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = Math.max(value.split("\n").length, 8);
  return (
    <div className="editor">
      <div className="gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
      </div>
      <textarea
        aria-label="SQL editor"
        spellCheck={false}
        value={value}
        placeholder="select * from range(10);   -- Ctrl/⌘ + Enter to run"
        rows={lines}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onRun();
          }
        }}
      />
    </div>
  );
}
