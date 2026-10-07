"use client";

import { motion, useReducedMotion } from "framer-motion";

export interface TeamBarRow {
  id: string | number;
  rank?: number | null;
  label: string;
  /** Secondary line (team name). */
  sub?: string | null;
  color: string;
  /** Text-safe variant of `color` (≥ 4.5:1). */
  textColor: string;
  value: number;
  display: string;
  /** Extra mono annotation on the right (e.g. "+0.369s"). */
  note?: string | null;
  selected?: boolean;
}

interface TeamBarsProps {
  rows: readonly TeamBarRow[];
  /** Smaller values are better and drawn longer (finishing or grid positions). */
  lowerIsBetter?: boolean;
  onToggle?: (id: TeamBarRow["id"]) => void;
  toggleLabel?: (row: TeamBarRow) => string;
}

/**
 * Horizontal bars in team colours. Labels sit outside the bar so text never
 * depends on the fill colour for contrast.
 */
export function TeamBars({ rows, lowerIsBetter = false, onToggle, toggleLabel }: TeamBarsProps) {
  const reducedMotion = useReducedMotion();
  const values = rows.map((row) => row.value);
  const max = Math.max(...values, lowerIsBetter ? 1 : 0);

  return (
    <ol className="space-y-1">
      {rows.map((row, index) => {
        // Positions: P1 draws the longest bar; other metrics scale from zero.
        const ratio = lowerIsBetter ? (max + 1 - row.value) / max : max > 0 ? row.value / max : 0;
        const width = Math.max(ratio * 100, 1.5);
        const content = (
          <>
            <span className="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-white/[0.62]">
              {String(row.rank ?? index + 1).padStart(2, "0")}
            </span>
            <span className="w-[7.5rem] shrink-0 sm:w-40">
              <span className={`block truncate font-mono text-[12px] uppercase tracking-[0.04em] ${row.selected ? "text-light" : "text-white/[0.84]"}`}>
                {row.label}
              </span>
              {row.sub && (
                <span className="flex items-center gap-1.5 truncate text-[11px] leading-4 text-white/[0.66]">
                  <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                  <span className="truncate">{row.sub}</span>
                </span>
              )}
            </span>
            <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-sm bg-white/[0.04]" aria-hidden="true">
              <motion.span
                initial={false}
                animate={{ scaleX: width / 100 }}
                transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 32 }}
                className="absolute inset-y-0 left-0 w-full origin-left rounded-sm"
                style={{ backgroundColor: row.color, opacity: row.selected === false ? 0.55 : 0.9 }}
              />
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-[12px] tabular-nums text-light">{row.display}</span>
            {row.note !== undefined && (
              <span className="hidden w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-white/[0.66] sm:inline">{row.note ?? ""}</span>
            )}
          </>
        );
        return (
          <li key={row.id}>
            {onToggle ? (
              <button
                type="button"
                onClick={() => onToggle(row.id)}
                aria-pressed={Boolean(row.selected)}
                aria-label={toggleLabel?.(row)}
                className={`flex w-full items-center gap-3 rounded-md px-1.5 py-1.5 text-left transition-colors duration-fast hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 ${row.selected ? "bg-white/[0.05] ring-1 ring-inset ring-white/[0.10]" : ""}`}
                style={row.selected ? { boxShadow: `inset 2px 0 0 ${row.color}` } : undefined}
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-1.5 py-1.5">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
