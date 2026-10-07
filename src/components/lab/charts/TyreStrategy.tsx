import { useId } from "react";
import { formatLapMs } from "@/lib/lab-client";
import { COMPOUND_ORDER, compoundSequence, describeStint, officialStops, stintChangesOutsideSummary, TYRE_COMPOUNDS, type TyreCompound, type TyreCompoundId, type TyreStrategyRow } from "@/lib/lab-strategy.mjs";
import { readableTeamColor, teamColor } from "@/lib/team-colors";

function lapTicks(maxLap: number): number[] {
  const step = maxLap > 50 ? 10 : maxLap > 20 ? 5 : 2;
  const ticks = [1];
  for (let lap = step; lap < maxLap; lap += step) ticks.push(lap);
  if (ticks.at(-1) !== maxLap) ticks.push(maxLap);
  return ticks;
}

/**
 * Fill patterns drawn over the compound colour so compounds stay apart
 * without colour (colour-blind readers, greyscale print). Defined once per
 * chart; segments reference them by id.
 */
function PatternDefs({ prefix }: { prefix: string }) {
  return (
    <svg aria-hidden="true" width="0" height="0" className="absolute">
      <defs>
        {COMPOUND_ORDER.map((id) => {
          const compound = TYRE_COMPOUNDS[id];
          const stroke = compound.text;
          return (
            <pattern key={id} id={`${prefix}-${id}`} width="6" height="6" patternUnits="userSpaceOnUse">
              {compound.pattern === "diagonal" && <path d="M-1,1 L1,-1 M0,6 L6,0 M5,7 L7,5" stroke={stroke} strokeOpacity="0.35" strokeWidth="1.2" />}
              {compound.pattern === "crosshatch" && <path d="M0,6 L6,0 M0,0 L6,6" stroke={stroke} strokeOpacity="0.3" strokeWidth="1" />}
              {compound.pattern === "horizontal" && <path d="M0,3 L6,3" stroke={stroke} strokeOpacity="0.35" strokeWidth="1.2" />}
              {compound.pattern === "vertical" && <path d="M3,0 L3,6" stroke={stroke} strokeOpacity="0.4" strokeWidth="1.2" />}
              {compound.pattern === "dotted" && <circle cx="3" cy="3" r="1" fill={stroke} fillOpacity="0.45" />}
            </pattern>
          );
        })}
      </defs>
    </svg>
  );
}

function CompoundSwatch({ compound, prefix }: { compound: TyreCompound; prefix: string }) {
  return (
    <span aria-hidden="true" className="relative inline-flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[3px]" style={{ backgroundColor: compound.fill }}>
      <svg className="absolute inset-0 h-full w-full"><rect width="100%" height="100%" fill={`url(#${prefix}-${compound.id})`} /></svg>
      <span className="relative rounded-[2px] px-0.5 font-mono text-[12px] font-semibold leading-4" style={{ color: compound.text, backgroundColor: compound.fill }}>{compound.letter}</span>
    </span>
  );
}

/** Compounds in use, plus the two stop markers. */
export function TyreLegend({ compounds, prefix, showDerived }: { compounds: readonly TyreCompoundId[]; prefix: string; showDerived: boolean }) {
  const shown = COMPOUND_ORDER.filter((id) => compounds.includes(id));
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-white/[0.78]" aria-label="Legend" data-tyre-legend>
      {shown.map((id) => (
        <li key={id} className="flex items-center gap-1.5" data-compound={id}>
          <CompoundSwatch compound={TYRE_COMPOUNDS[id]} prefix={prefix} />
          {TYRE_COMPOUNDS[id].label}
        </li>
      ))}
      <li className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-4 w-[2px] bg-light" />Pit stop</li>
      {showDerived && <li className="flex items-center gap-1.5" data-legend-derived><span aria-hidden="true" className="inline-block h-4 border-l-2 border-dashed border-light" />Stint change not in the official pit summary</li>}
      <li className="text-white/[0.70]"><span className="font-mono text-[12px]">M(3)</span> tyre already 3 laps old when the stint began</li>
    </ul>
  );
}

function rowLabel(row: TyreStrategyRow): string {
  const place = row.finish != null ? `P${row.finish}` : "Not classified";
  if (row.missing) return `${place} ${row.name}: stints not published`;
  const official = officialStops(row);
  const changes = stintChangesOutsideSummary(row);
  const stops = !row.pitSummaryPublished ? "official pit summary not published" : official.length
    ? `${official.length} official ${official.length === 1 ? "pit stop" : "pit stops"} on lap ${official.map((stop) => stop.lap).join(", ")}`
    : "no official pit stop";
  const extra = changes.length
    ? `; ${changes.length} ${changes.length === 1 ? "stint change" : "stint changes"} after lap ${changes.map((stop) => stop.lap).join(", ")} not in the official pit summary`
    : "";
  return `${place} ${row.name}: ${row.stints.map(describeStint).join("; ")}; ${stops}${extra}`;
}

/** The official count stays unknown when the summary is not published. */
function stopCount(row: TyreStrategyRow): string {
  if (!row.pitSummaryPublished) return "—";
  const count = officialStops(row).length;
  return `${count} ${count === 1 ? "stop" : "stops"}`;
}

interface TyreStrategyChartProps {
  rows: readonly TyreStrategyRow[];
  maxLap: number;
  /** Race report card: no legend or lap axis title, shorter rows. */
  compact?: boolean;
}

/**
 * Tyre strategy on a shared lap axis: one row per driver (finishing order),
 * one segment per stint coloured by compound, with a pattern and the
 * compound letter so it reads without colour; pit stops drawn over it.
 * CSS percentages, so it renders identically on the server and at any width.
 */
export function TyreStrategyChart({ rows, maxLap, compact = false }: TyreStrategyChartProps) {
  const prefix = `tyre${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const pct = (lap: number) => `${(Math.max(0, Math.min(lap, maxLap)) / maxLap) * 100}%`;
  const compounds = Array.from(new Set(rows.flatMap((row) => row.stints.map((stint) => stint.compound))));
  const showDerived = rows.some((row) => row.stops.some((stop) => stop.derived));
  const grid = compact
    ? "grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[4.75rem_minmax(0,1fr)_3.5rem]"
    : "grid grid-cols-[4.5rem_minmax(0,1fr)_3.75rem] items-center gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_5.5rem]";

  return (
    <div className="relative space-y-3" data-tyre-strategy>
      <PatternDefs prefix={prefix} />
      {!compact && <TyreLegend compounds={compounds} prefix={prefix} showDerived={showDerived} />}
      <ol className="space-y-1" aria-label="Tyre strategy by driver, in finishing order">
        {rows.map((row) => (
          <li key={`${row.finish ?? "nc"}-${row.code}`} className={grid} aria-label={rowLabel(row)} data-strategy-row={row.code}>
            <span className="flex min-w-0 items-center gap-1.5" aria-hidden="true">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: teamColor(row.team) }} />
              <span className="font-mono text-[12px] tabular-nums text-white/[0.66]">{row.finish != null ? `P${row.finish}` : "NC"}</span>
              <span className="truncate font-mono text-[12px]" style={{ color: readableTeamColor(row.team) }}>{row.code}</span>
            </span>
            <span className={`relative block ${compact ? "h-5" : "h-6"} rounded-sm bg-white/[0.03]`} aria-hidden="true">
              {row.missing && (
                <span className="absolute inset-0 flex items-center rounded-sm border border-dashed border-white/[0.16] px-2 text-[12px] text-white/[0.70]" data-stints-missing>
                  Stints not published
                </span>
              )}
              {row.stints.map((stint) => {
                const compound = TYRE_COMPOUNDS[stint.compound];
                return (
                  <span
                    key={`${stint.number}-${stint.start}`}
                    className="absolute inset-y-0.5 flex items-center overflow-hidden rounded-[2px] pl-1"
                    style={{ left: pct(stint.start - 1), width: `calc(${pct(stint.end - stint.start + 1)} - 2px)`, backgroundColor: compound.fill }}
                    title={describeStint(stint)}
                    data-stint={stint.compound}
                    data-stint-pattern={compound.pattern}
                  >
                    <svg className="absolute inset-0 h-full w-full"><rect width="100%" height="100%" fill={`url(#${prefix}-${compound.id})`} /></svg>
                    <span className="relative whitespace-nowrap rounded-[2px] px-0.5 font-mono text-[12px] font-semibold leading-4" style={{ color: compound.text, backgroundColor: compound.fill }} data-stint-letter>
                      {compound.letter}{stint.ageAtStart ? `(${stint.ageAtStart})` : ""}
                    </span>
                  </span>
                );
              })}
              {row.stops.map((stop) => (
                <span
                  key={`${stop.derived ? "change" : "stop"}-${stop.lap}`}
                  className={`absolute -top-0.5 h-[calc(100%+4px)] -translate-x-px ${stop.derived ? "border-l-2 border-dashed border-light" : "w-[2px] bg-light"}`}
                  style={{ left: pct(stop.lap) }}
                  title={stop.derived ? `Stint change after lap ${stop.lap}, not in the official pit summary` : `Pit stop · lap ${stop.lap}${stop.durationMs != null ? ` · ${formatLapMs(stop.durationMs)} pit lane` : ""}`}
                  data-stop={stop.derived ? "derived" : "official"}
                />
              ))}
            </span>
            <span className={`${compact ? "hidden sm:block" : ""} text-right font-mono text-[12px] tabular-nums text-white/[0.70]`}>
              <span title={!row.pitSummaryPublished ? "Official pit summary not published" : undefined} data-stop-count>{row.missing ? "—" : compact ? compoundSequence(row) : stopCount(row)}</span>
              {!compact && !row.missing && !row.pitSummaryPublished && <span className="block text-[12px] text-white/[0.62]" data-stint-change-count>{Math.max(0, row.stints.length - 1)} stint changes</span>}
            </span>
          </li>
        ))}
      </ol>
      <div className={`${grid} pt-1`} aria-hidden="true">
        <span className="text-[12px] text-white/[0.62]">Lap</span>
        <span className="relative h-4">
          {lapTicks(maxLap).map((lap) => (
            <span key={lap} className="absolute -translate-x-1/2 font-mono text-[12px] tabular-nums text-white/[0.62]" style={{ left: pct(lap - 0.5) }}>
              {lap}
            </span>
          ))}
        </span>
        {!compact && <span />}
      </div>
      {compact && showDerived && (
        <p className="flex items-center gap-1.5 text-[12px] text-white/[0.70]" data-legend-derived>
          <span aria-hidden="true" className="inline-block h-3.5 border-l-2 border-dashed border-light" />
          Stint change not in the official pit summary
        </p>
      )}
    </div>
  );
}
