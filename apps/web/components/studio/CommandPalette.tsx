"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { Kbd } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
  disabled?: boolean;
}

export function CommandPalette({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CommandAction[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return actions;
    return actions.filter(
      (action) =>
        action.label.toLowerCase().includes(clean) ||
        (action.hint?.toLowerCase().includes(clean) ?? false),
    );
  }, [actions, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((value) => Math.min(filtered.length - 1, value + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((value) => Math.max(0, value - 1));
      } else if (event.key === "Enter") {
        const action = filtered[selected];
        if (action && !action.disabled) {
          event.preventDefault();
          onOpenChange(false);
          action.run();
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [open, filtered, selected, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[16vh]">
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        aria-label="Close command palette"
      />
      <div className="panel relative w-full max-w-[520px] overflow-hidden shadow-[0_30px_120px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search className="h-4 w-4 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search studio actions…"
            className="h-6 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="scroll-thin max-h-[340px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-faint">No matching actions.</div>
          ) : (
            filtered.map((action, index) => (
              <button
                key={action.id}
                type="button"
                onMouseEnter={() => setSelected(index)}
                onClick={() => {
                  if (action.disabled) return;
                  onOpenChange(false);
                  action.run();
                }}
                disabled={action.disabled}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-35",
                  index === selected ? "bg-white/[0.06]" : "hover:bg-white/[0.035]",
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line bg-[#0A0C10] text-muted">
                  {action.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{action.label}</span>
                  {action.hint ? (
                    <span className="mt-0.5 block truncate text-[10px] text-faint">{action.hint}</span>
                  ) : null}
                </span>
                {index === selected ? (
                  <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-faint" />
                ) : null}
              </button>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            navigate
            <Kbd>↵</Kbd>
            run
          </div>
          <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint/70">
            studio commands
          </span>
        </div>
      </div>
    </div>
  );
}
