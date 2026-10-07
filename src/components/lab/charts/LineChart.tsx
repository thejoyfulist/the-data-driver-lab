"use client";

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { linearScale, niceTicks, spreadLabels, useChartCursor, useElementWidth } from "./chart-utils";

export interface LineSeries {
  id: string;
  /** Short label drawn at the end of the line (driver code). */
  label: string;
  /** Long label used in the legend, the tooltip and the table. */
  name: string;
  /** Stroke colour (team fill). */
  color: string;
  /** Text colour with ≥ 4.5:1 contrast on the page background. */
  textColor: string;
  /** Second driver of a team: dashed, so teammates stay distinguishable. */
  dashed?: boolean;
  points: { x: number; y: number | null }[];
}

export interface ChartBand {
  x0: number;
  x1: number;
  label: string;
}

interface LineChartProps {
  series: readonly LineSeries[];
  ariaLabel: string;
  xLabel: string;
  yLabel: string;
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  /** Lower values drawn higher (lap times). */
  invertY?: boolean;
  bands?: readonly ChartBand[];
  height?: number;
  /**
   * The values behind the curves, as a table in the server HTML (collapsed
   * <details>, so it works without JavaScript). Long series are sampled to
   * at most this many rows; the CSV export carries every value.
   */
  maxTableRows?: number;
  /** Cell text where a series has no value at that x (e.g. an excluded lap). */
  missingLabel?: string;
  /** Full-precision value format for the table and tooltip (defaults to the axis format). */
  formatValue?: (value: number) => string;
  /** Charts with the same group share one cursor (hover and arrow keys). */
  syncGroup?: string;
  /** Tooltip shows the change since the previous x (cumulative points). */
  showDelta?: boolean;
}

const MARGIN = { top: 26, right: 60, bottom: 30, left: 56 };
const LABEL_GAP = 15;
const DASH = "6 4";

function LineSwatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden="true" className="shrink-0">
      <line x1="1" x2="17" y1="4" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} strokeLinecap="round" />
    </svg>
  );
}

export function LineChart({
  series,
  ariaLabel,
  xLabel,
  yLabel,
  formatX = (value) => String(value),
  formatY = (value) => String(value),
  invertY = false,
  bands = [],
  height = 320,
  maxTableRows = 80,
  missingLabel = "no value",
  formatValue,
  syncGroup,
  showDelta = false,
}: LineChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [activeX, setActiveX] = useChartCursor(syncGroup);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const formatTooltip = formatValue ?? formatY;

  // The domain covers every series, hidden or not: toggling a line in the
  // legend never rescales the others under the reader's eyes.
  const geometry = useMemo(() => {
    const xs = Array.from(new Set(series.flatMap((line) => line.points.filter((p) => p.y != null).map((p) => p.x)))).sort((a, b) => a - b);
    const ys = series.flatMap((line) => line.points.map((p) => p.y).filter((y): y is number => y != null));
    if (xs.length === 0 || ys.length === 0) return null;
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const pad = (yMax - yMin || Math.abs(yMax) || 1) * 0.06;
    const yTicks = niceTicks(invertY ? yMin - pad : Math.min(0, yMin), yMax + pad, 5);
    const domainY: [number, number] = [Math.min(yTicks[0] ?? yMin, yMin), Math.max(yTicks.at(-1) ?? yMax, yMax)];
    const innerW = Math.max(width - MARGIN.left - MARGIN.right, 40);
    const innerH = height - MARGIN.top - MARGIN.bottom;
    // A single x value (one completed round) still needs a visible domain.
    const xDomain: [number, number] = xs.length > 1 ? [xs[0], xs[xs.length - 1]] : [xs[0] - 1, xs[0] + 1];
    const x = linearScale(xDomain, [MARGIN.left, MARGIN.left + innerW]);
    const y = linearScale(domainY, invertY ? [MARGIN.top, MARGIN.top + innerH] : [MARGIN.top + innerH, MARGIN.top]);
    const tickEvery = Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor(innerW / 60))));
    const regular = xs.filter((_, index) => index % tickEvery === 0);
    const lastX = xs[xs.length - 1];
    // Always label the last value, dropping a regular tick that would collide with it.
    const xTicks = regular.at(-1) === lastX
      ? regular
      : [...regular.filter((tick) => x(lastX) - x(tick) >= 48), lastX];
    return { xs, xDomain, x, y, yTicks: yTicks.filter((t) => t >= domainY[0] && t <= domainY[1]), xTicks };
  }, [height, invertY, series, width]);

  if (!geometry) return null;
  const { xs, xDomain, x, y, yTicks, xTicks } = geometry;
  const visible = series.filter((line) => !hidden.has(line.id));

  const paths = visible.map((line) => {
    let d = "";
    let pen = false;
    for (const point of line.points) {
      if (point.y == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`;
      pen = true;
    }
    return { line, d };
  });

  const endLabels = spreadLabels(
    visible.flatMap((line) => {
      const last = [...line.points].reverse().find((p) => p.y != null);
      return last ? [{ id: line.id, label: line.label, color: line.textColor, y: y(last.y as number) }] : [];
    }),
    LABEL_GAP,
    MARGIN.top + 4,
    height - MARGIN.bottom - 2,
  );

  const cursorInDomain = activeX != null && activeX >= xDomain[0] && activeX <= xDomain[1];
  const activeValues = !cursorInDomain
    ? []
    : visible
        .map((line) => {
          const index = line.points.findIndex((p) => p.x === activeX);
          const value = index >= 0 ? line.points[index].y : null;
          const previous = index > 0 ? line.points[index - 1].y : null;
          return { line, value, delta: value != null && previous != null ? value - previous : null };
        })
        .filter((entry): entry is { line: LineSeries; value: number; delta: number | null } => entry.value != null)
        .sort((a, b) => (invertY ? a.value - b.value : b.value - a.value));

  function nearestX(clientX: number, rect: DOMRect) {
    const px = ((clientX - rect.left) / rect.width) * width;
    return xs.reduce((best, candidate) => (Math.abs(x(candidate) - px) < Math.abs(x(best) - px) ? candidate : best), xs[0]);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    setActiveX(nearestX(event.clientX, event.currentTarget.getBoundingClientRect()));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") return setActiveX(null);
    if (event.key === "Home") return setActiveX(xs[0]);
    if (event.key === "End") return setActiveX(xs[xs.length - 1]);
    const current = activeX == null ? -1 : xs.findIndex((value) => value >= activeX);
    const index = current < 0 ? (event.key === "ArrowLeft" ? xs.length - 1 : 0) : current + (event.key === "ArrowLeft" ? -1 : 1);
    setActiveX(xs[Math.max(0, Math.min(xs.length - 1, index))]);
  }

  function toggle(id: string) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const cursorLeft = cursorInDomain ? x(activeX as number) : 0;
  const tooltipOnLeft = cursorLeft > width * 0.6;

  return (
    <div className="w-full" data-line-chart>
      <div
        ref={containerRef}
        className="relative w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/60"
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel}. Use the left and right arrow keys to read values.`}
        onKeyDown={onKeyDown}
        onBlur={() => setActiveX(null)}
      >
        <svg
          role="img"
          aria-label={ariaLabel}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto max-w-full touch-pan-y"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActiveX(null)}
        >
          {bands.map((band) => (
            <g key={`${band.label}-${band.x0}`}>
              <rect
                x={x(band.x0 - 0.5)}
                y={MARGIN.top}
                width={Math.max(x(band.x1 + 0.5) - x(band.x0 - 0.5), 2)}
                height={height - MARGIN.top - MARGIN.bottom}
                fill="rgba(212,167,45,0.10)"
              />
              <text x={x(band.x0 - 0.5) + 3} y={MARGIN.top + 12} fontSize="12" fill="#D4A72D" className="font-mono">
                {band.label}
              </text>
            </g>
          ))}
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke="rgba(255,255,255,0.06)" />
              <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="12" fill="rgba(255,255,255,0.66)" className="font-mono tabular-nums">
                {formatY(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text key={`x-${tick}`} x={x(tick)} y={height - MARGIN.bottom + 18} textAnchor="middle" fontSize="12" fill="rgba(255,255,255,0.66)" className="font-mono tabular-nums">
              {formatX(tick)}
            </text>
          ))}
          <text x={4} y={12} fontSize="12" fill="rgba(255,255,255,0.62)">{yLabel}</text>
          {cursorInDomain && (
            <line x1={cursorLeft} x2={cursorLeft} y1={MARGIN.top} y2={height - MARGIN.bottom} stroke="rgba(215,222,232,0.35)" data-chart-cursor={activeX ?? undefined} />
          )}
          {paths.map(({ line, d }) => (
            <path
              key={line.id}
              d={d}
              fill="none"
              stroke={line.color}
              strokeWidth={activeValues.length && !activeValues.some((v) => v.line.id === line.id) ? 1.25 : 2}
              strokeDasharray={line.dashed ? DASH : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {xs.length <= 30 && visible.map((line) => line.points.filter((point) => point.y != null).map((point) => (
            <circle key={`pt-${line.id}-${point.x}`} cx={x(point.x)} cy={y(point.y as number)} r={2.25} fill={line.color} />
          )))}
          {activeValues.map(({ line, value }) => (
            <circle key={`dot-${line.id}`} cx={cursorLeft} cy={y(value)} r={3.5} fill="#080A0D" stroke={line.color} strokeWidth={2} />
          ))}
          {endLabels.map((label) => (
            <text key={`end-${label.id}`} x={width - MARGIN.right + 6} y={label.y + 4} fontSize="12" fill={label.color} className="font-mono" data-end-label>
              {label.label}
            </text>
          ))}
        </svg>
        {cursorInDomain && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[168px] rounded-lg border border-white/[0.12] bg-surface-2/95 px-3 py-2 shadow-glow-depth"
            style={tooltipOnLeft ? { right: width - cursorLeft + 12 } : { left: cursorLeft + 12 }}
            data-chart-tooltip
          >
            <p className="mb-1 text-[12px] text-white/[0.70]">{formatX(activeX as number)}</p>
            {activeValues.length === 0 && <p className="text-[12px] text-white/[0.66]">{missingLabel}</p>}
            {activeValues.slice(0, 10).map(({ line, value, delta }) => (
              <p key={line.id} className="flex items-center justify-between gap-4 font-mono text-[12px] tabular-nums leading-5">
                <span className="flex items-center gap-1.5" style={{ color: line.textColor }}>
                  <LineSwatch color={line.color} dashed={line.dashed} />
                  {line.label}
                </span>
                <span className="text-light">
                  {formatTooltip(value)}
                  {showDelta && delta != null && <span className="ml-2 text-white/[0.66]">{delta >= 0 ? "+" : "−"}{formatY(Math.abs(delta))}</span>}
                </span>
              </p>
            ))}
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {cursorInDomain ? `${formatX(activeX as number)}: ${activeValues.map(({ line, value }) => `${line.label} ${formatTooltip(value)}`).join(", ") || missingLabel}` : ""}
        </span>
      </div>
      <div role="group" aria-label="Lines shown" className="mt-2 flex flex-wrap gap-1" data-chart-legend>
        {series.map((line) => {
          const shown = !hidden.has(line.id);
          return (
            <button
              key={line.id}
              type="button"
              aria-pressed={shown}
              onClick={() => toggle(line.id)}
              title={shown ? `Hide ${line.name}` : `Show ${line.name}`}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 lg:min-h-8 text-[13px] transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70 ${shown ? "text-white/[0.84]" : "text-white/[0.62] line-through"}`}
            >
              <LineSwatch color={shown ? line.color : "rgba(255,255,255,0.35)"} dashed={line.dashed} />
              {line.name}
            </button>
          );
        })}
      </div>
      <ChartValuesTable
        series={series}
        xs={xs}
        caption={ariaLabel}
        xLabel={xLabel}
        formatX={formatX}
        formatY={formatValue ?? formatY}
        maxRows={maxTableRows}
        missingLabel={missingLabel}
      />
    </div>
  );
}

interface ChartValuesTableProps {
  series: readonly LineSeries[];
  xs: readonly number[];
  caption: string;
  xLabel: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  maxRows: number;
  missingLabel: string;
}

/** Text alternative of a line chart: every series and its values, readable without JavaScript. */
function ChartValuesTable({ series, xs, caption, xLabel, formatX, formatY, maxRows, missingLabel }: ChartValuesTableProps) {
  const step = Math.max(1, Math.ceil(xs.length / Math.max(maxRows, 1)));
  const rows = xs.filter((_, index) => index % step === 0 || index === xs.length - 1);
  const values = series.map((line) => new Map(line.points.map((point) => [point.x, point.y])));
  return (
    <details className="mt-2 rounded-md border border-white/[0.06] px-3 py-2" data-chart-values>
      <summary className="cursor-pointer text-[13px] text-white/[0.70] hover:text-light">
        Values table · {series.length} series · {rows.length} {rows.length === 1 ? "row" : "rows"}
      </summary>
      <div className="mt-2 max-h-80 overflow-auto" tabIndex={0} aria-label={`${caption}, values`}>
        <table className="w-full border-collapse text-left">
          <caption className="pb-2 text-left text-[12px] text-white/[0.66]">
            {caption}
            {step > 1 ? ` · every ${step}th ${xLabel.toLowerCase()} of ${xs.length} shown; the CSV export has all values` : ""}
          </caption>
          <thead>
            <tr className="border-b border-white/[0.08] text-[12px] text-white/[0.66]">
              <th scope="col" className="px-2 py-1.5 font-medium">{xLabel}</th>
              {series.map((line) => (
                <th key={line.id} scope="col" className="px-2 py-1.5 font-mono font-medium" style={{ color: line.textColor }}>
                  {line.label} <span className="sr-only">{line.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((xValue) => (
              <tr key={xValue} className="border-b border-white/[0.04]">
                <th scope="row" className="px-2 py-1 text-left font-mono text-[12px] font-normal tabular-nums text-white/[0.72]">{formatX(xValue)}</th>
                {values.map((byX, index) => {
                  const value = byX.get(xValue);
                  return (
                    <td key={series[index].id} className="px-2 py-1 font-mono text-[12px] tabular-nums text-white/[0.84]">
                      {value == null ? missingLabel : formatY(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
