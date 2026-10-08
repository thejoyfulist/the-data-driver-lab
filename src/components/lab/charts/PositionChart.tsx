"use client";

import type { KeyboardEvent, PointerEvent } from "react";
import type { NeutralisationBand } from "@/lib/lab-analytics";
import { orderAtLap, type PositionDriver } from "@/lib/lab-strategy.mjs";
import { readableTeamColor, teamColor } from "@/lib/team-colors";
import { linearScale, spreadLabels, useChartCursor, useElementWidth } from "./chart-utils";

interface PositionChartProps {
  /** Drivers in finishing order. */
  drivers: readonly (PositionDriver & { dashed: boolean })[];
  maxLap: number;
  maxPosition: number;
  /** Driver codes drawn in full; every other line is dimmed. Empty: all drawn alike. */
  highlighted: ReadonlySet<string>;
  adjustedCodes?: ReadonlySet<string>;
  bands?: readonly NeutralisationBand[];
  /** Shares the lap cursor with the race timeline strip (and the other lap charts). */
  syncGroup?: string;
}

const MARGIN = { top: 24, right: 52, bottom: 40, left: 44 };
const ROW = 18;
const LABEL_GAP = 13;
const DASH = "6 4";

function lapTicks(maxLap: number): number[] {
  const step = maxLap > 50 ? 10 : maxLap > 20 ? 5 : 2;
  const ticks = [0];
  for (let lap = step; lap < maxLap; lap += step) ticks.push(lap);
  if (maxLap - (ticks.at(-1) ?? 0) < step / 2 && ticks.length > 1) ticks.pop();
  ticks.push(maxLap);
  return ticks;
}

/** "Grid" for lap 0 (starting order), "L12" otherwise. */
export function formatPositionLap(lap: number): string {
  return lap === 0 ? "Grid" : `L${lap}`;
}

/**
 * Lap-by-lap running order: P1 at the top, one line per driver in its team
 * colour (second driver of a team dashed), lap 0 = grid. Selected drivers
 * are drawn in full, the others dimmed. A lap without a published position
 * breaks the line: nothing is interpolated.
 */
export function PositionChart({ drivers, maxLap, maxPosition, highlighted, adjustedCodes = new Set(), bands = [], syncGroup }: PositionChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [cursor, setCursor] = useChartCursor(syncGroup);
  const rows = Math.max(maxPosition, 2);
  const height = MARGIN.top + MARGIN.bottom + (rows - 1) * ROW;
  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 40);
  const x = linearScale([0, maxLap], [MARGIN.left, MARGIN.left + innerW]);
  const y = linearScale([1, rows], [MARGIN.top, MARGIN.top + (rows - 1) * ROW]);
  const focus = highlighted.size > 0;
  const isOn = (driver: PositionDriver) => !focus || highlighted.has(driver.code);
  const lap = cursor != null && cursor >= 0 && cursor <= maxLap ? Math.round(cursor) : null;

  const lines = drivers.map((driver) => {
    let d = "";
    let previous: number | null = null;
    for (const point of driver.points) {
      const continues = previous != null && point.lap === previous + 1;
      d += `${continues ? "L" : "M"}${x(point.lap).toFixed(1)},${y(point.position).toFixed(1)}`;
      previous = point.lap;
    }
    // A lone point (gap on both sides) still needs a visible mark.
    const lonely = driver.points.filter((point, index, list) => list[index - 1]?.lap !== point.lap - 1 && list[index + 1]?.lap !== point.lap + 1);
    return { driver, d, lonely, on: isOn(driver) };
  });
  // Dimmed lines first, selected lines on top.
  const ordered = [...lines.filter((line) => !line.on), ...lines.filter((line) => line.on)];

  const endLabels = spreadLabels(
    drivers.flatMap((driver) => {
      const last = driver.points.at(-1);
      return last ? [{ id: driver.code, label: driver.code, on: isOn(driver), color: readableTeamColor(driver.team), y: y(last.position) }] : [];
    }),
    LABEL_GAP,
    MARGIN.top - 4,
    height - MARGIN.bottom + 4,
  );

  const order = lap == null ? [] : orderAtLap({ drivers: [...drivers] }, lap);
  const shownInTooltip = focus
    ? order.filter((entry) => highlighted.has(entry.driver.code) || entry.position <= 3)
    : order.slice(0, 10);

  function lapAt(clientX: number, rect: DOMRect) {
    const px = ((clientX - rect.left) / rect.width) * width;
    return Math.max(0, Math.min(maxLap, Math.round(((px - MARGIN.left) / innerW) * maxLap)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") return setCursor(null);
    if (event.key === "Home") return setCursor(0);
    if (event.key === "End") return setCursor(maxLap);
    const next = lap == null ? (event.key === "ArrowLeft" ? maxLap : 0) : lap + (event.key === "ArrowLeft" ? -1 : 1);
    setCursor(Math.max(0, Math.min(maxLap, next)));
  }

  const cursorX = lap == null ? 0 : x(lap);
  const tooltipOnLeft = cursorX > width * 0.6;
  const yTicks = Array.from({ length: rows }, (_, index) => index + 1).filter((position) => rows <= 24 || position === 1 || position % 5 === 0);

  return (
    <div className="w-full" data-position-chart>
      <div
        ref={containerRef}
        className="relative w-full rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-teal/60"
        tabIndex={0}
        role="group"
        aria-label="Positions by lap. Use the left and right arrow keys to read the running order at a lap."
        onKeyDown={onKeyDown}
        onBlur={() => setCursor(null)}
      >
        <svg
          role="img"
          aria-label={`Running order by lap for ${drivers.length} drivers, from the grid (lap 0) to lap ${maxLap}${focus ? `; highlighted: ${[...highlighted].join(", ")}` : ""}`}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto max-w-full touch-pan-y"
          onPointerMove={(event: PointerEvent<SVGSVGElement>) => setCursor(lapAt(event.clientX, event.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setCursor(null)}
        >
          {bands.map((band) => (
            <g key={`${band.type}-${band.start}`} data-position-band={band.type}>
              <rect x={x(band.start - 1)} y={MARGIN.top - 8} width={Math.max(x(band.end) - x(band.start - 1), 2)} height={(rows - 1) * ROW + 16} fill="rgba(212,167,45,0.08)" />
              <text x={x(band.start - 1) + 3} y={MARGIN.top - 12} fontSize="12" fill="#D4A72D" className="font-mono">{band.type}</text>
            </g>
          ))}
          {yTicks.map((position) => (
            <g key={`y-${position}`}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(position)} y2={y(position)} stroke="rgba(255,255,255,0.05)" />
              <text x={MARGIN.left - 8} y={y(position) + 4} textAnchor="end" fontSize="12" fill="rgba(255,255,255,0.66)" className="font-mono tabular-nums">
                P{position}
              </text>
            </g>
          ))}
          {lapTicks(maxLap).map((tick) => (
            <text key={`x-${tick}`} x={x(tick)} y={height - MARGIN.bottom + 18} textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.66)" className="font-mono tabular-nums">
              {tick === 0 ? "Grid" : tick}
            </text>
          ))}
          <text x={width - MARGIN.right} y={height - 6} textAnchor="end" fontSize="12" fill="rgba(255,255,255,0.62)" data-axis-label="x">Lap</text>
          <text x={4} y={12} fontSize="12" fill="rgba(255,255,255,0.62)" data-axis-label="y">Position</text>
          {lap != null && (
            <line x1={cursorX} x2={cursorX} y1={MARGIN.top - 8} y2={height - MARGIN.bottom + 6} stroke="rgba(215,222,232,0.35)" data-chart-cursor={lap} />
          )}
          {ordered.map(({ driver, d, lonely, on }) => (
            <g key={driver.code} data-position-line={driver.code} data-highlighted={focus ? String(on) : undefined}>
              <path
                d={d}
                fill="none"
                stroke={teamColor(driver.team)}
                strokeOpacity={on ? 1 : 0.22}
                strokeWidth={on ? (focus ? 2.5 : 1.75) : 1.25}
                strokeDasharray={driver.dashed ? DASH : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {lonely.map((point) => (
                <circle key={point.lap} cx={x(point.lap)} cy={y(point.position)} r={2.5} fill={teamColor(driver.team)} fillOpacity={on ? 1 : 0.3} />
              ))}
              {adjustedCodes.has(driver.code) && driver.points.length > 0 && (
                <circle cx={x(driver.points.at(-1)!.lap)} cy={y(driver.points.at(-1)!.position)} r={4.5} fill="#080A0D" stroke="#D4A72D" strokeWidth={1.5} data-adjusted-finish={driver.code}>
                  <title>{driver.code}: official classification changed after the finish</title>
                </circle>
              )}
            </g>
          ))}
          {lap != null && order.filter((entry) => isOn(entry.driver)).map(({ driver, position }) => (
            <circle key={`dot-${driver.code}`} cx={cursorX} cy={y(position)} r={3.5} fill="#080A0D" stroke={teamColor(driver.team)} strokeWidth={2} />
          ))}
          {endLabels.map((label) => (
            <text key={`end-${label.id}`} x={width - MARGIN.right + 6} y={label.y + 4} fontSize="12" fill={label.on ? label.color : "rgba(255,255,255,0.62)"} className="font-mono" data-end-label>
              {label.label}
            </text>
          ))}
        </svg>
        {lap != null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-lg border border-white/[0.12] bg-surface-2/95 px-3 py-2 shadow-glow-depth"
            style={tooltipOnLeft ? { right: width - cursorX + 12 } : { left: cursorX + 12 }}
            data-chart-tooltip
          >
            <p className="mb-1 text-[12px] text-white/[0.70]">{formatPositionLap(lap)}</p>
            {shownInTooltip.length === 0 && <p className="text-[12px] text-white/[0.66]">No position published</p>}
            {shownInTooltip.map(({ driver, position }) => (
              <p key={driver.code} className="flex items-center justify-between gap-4 font-mono text-[12px] tabular-nums leading-5">
                <span className="text-white/[0.70]">P{position}</span>
                <span style={{ color: readableTeamColor(driver.team) }} className={focus && highlighted.has(driver.code) ? "font-semibold" : undefined}>{driver.code}</span>
              </p>
            ))}
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {lap == null ? "" : `${formatPositionLap(lap)}: ${shownInTooltip.map(({ driver, position }) => `P${position} ${driver.code}`).join(", ") || "no position published"}`}
        </span>
      </div>
    </div>
  );
}

/** Text alternative: every published position, one row per driver. */
export function PositionsTable({ drivers, maxLap }: { drivers: readonly PositionDriver[]; maxLap: number }) {
  const laps = Array.from({ length: maxLap + 1 }, (_, index) => index);
  return (
    <div className="max-h-[32rem] overflow-auto" tabIndex={0} aria-label="Positions by lap, table" data-positions-table>
      <table className="border-collapse text-left">
        <caption className="pb-2 text-left text-[12px] text-white/[0.66]">
          Position of each driver at the end of each lap; Grid is the starting order. “n/p”: no position published for that lap (never interpolated).
        </caption>
        <thead>
          <tr className="border-b border-white/[0.08] text-[12px] text-white/[0.70]">
            <th scope="col" className="sticky left-0 bg-surface-1 px-2 py-1.5 font-medium">Driver</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Finish</th>
            {laps.map((lap) => <th key={lap} scope="col" className="px-2 py-1.5 font-mono font-medium">{formatPositionLap(lap)}</th>)}
          </tr>
        </thead>
        <tbody>
          {drivers.map((driver) => {
            const byLap = new Map(driver.points.map((point) => [point.lap, point.position]));
            return (
              <tr key={driver.code} className="border-b border-white/[0.04]">
                <th scope="row" className="sticky left-0 bg-surface-1 px-2 py-1 text-left text-[12px] font-normal text-white/[0.84]">
                  <span className="font-mono" style={{ color: readableTeamColor(driver.team) }}>{driver.code}</span> <span className="sr-only">{driver.name}</span>
                </th>
                <td className="px-2 py-1 font-mono text-[12px] tabular-nums text-white/[0.84]">{driver.finish != null ? `P${driver.finish}` : "NC"}</td>
                {laps.map((lap) => (
                  <td key={lap} className="px-2 py-1 font-mono text-[12px] tabular-nums text-white/[0.84]">{byLap.has(lap) ? byLap.get(lap) : "n/p"}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
