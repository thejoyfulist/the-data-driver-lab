"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface CommandItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: readonly CommandItem[];
}

const MAX_RESULTS = 40;

function matches(item: CommandItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${item.group} ${item.label} ${item.hint ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

/**
 * ⌘K / Ctrl+K palette: jump to a view, a race, a driver or a season.
 * Implements the ARIA combobox + listbox pattern; Escape closes and focus
 * returns to where it was.
 */
export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const results = useMemo(() => items.filter((item) => matches(item, query.trim())).slice(0, MAX_RESULTS), [items, query]);

  // The parent mounts the palette only while it is open, so query and active
  // option start fresh on every opening.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      // Restore focus only if nothing else took it: a command may already
      // have moved focus to its target view.
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) restoreRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  if (!open) return null;

  function choose(item: CommandItem | undefined) {
    if (!item) return;
    onClose();
    // Run after the dialog unmounts so focus/scroll land on the target view.
    window.setTimeout(item.run, 0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === "Tab") {
      // Keep focus inside the modal: the input is its only tab stop.
      event.preventDefault();
    }
  }

  // Rendered at the end of <body>: a transformed ancestor (the page
  // template's entrance animation) would otherwise anchor this fixed layer
  // to the top of the page instead of the screen.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-white/[0.12] bg-surface-1 shadow-glow-depth"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-4">
          <span aria-hidden="true" className="font-mono text-[12px] text-white/[0.62]">⌘K</span>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search views, races, drivers and seasons"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder="Go to a view, race, driver or season…"
            className="h-12 w-full bg-transparent text-body-sm text-light placeholder:text-white/[0.55] focus:outline-hidden"
          />
        </div>
        <ul id={listId} role="listbox" aria-label="Commands" className="max-h-[50vh] overflow-y-auto py-2">
          {results.length === 0 && (
            <li role="presentation" className="px-4 py-6 text-center text-body-sm text-white/[0.66]">No match. Try a driver code, a race or “pace”.</li>
          )}
          {results.map((item, index) => {
            const header = index === 0 || results[index - 1].group !== item.group ? item.group : null;
            return (
              <li key={item.id} role="presentation">
                {header && (
                  <p role="presentation" className="px-4 pb-1 pt-3 text-[12px] font-medium text-white/[0.66]">{header}</p>
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(item)}
                  className={`mx-2 flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 ${index === active ? "bg-white/[0.08] text-light" : "text-white/[0.80]"}`}
                >
                  <span className="truncate text-body-sm">{item.label}</span>
                  {item.hint && <span className="shrink-0 text-[12px] text-white/[0.66]">{item.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.08] px-4 py-2.5 text-[12px] text-white/[0.66]">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span>/ find driver</span>
          <span>[ ] previous / next race</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
