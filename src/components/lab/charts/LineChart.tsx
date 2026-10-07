"use client";

import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { linearScale, niceTicks, spreadLabels, useElementWidth } from "./chart-utils";

export interface LineSeries {
  id: string;
  /** Short label drawn at the end of the line (driver code). */
  label: string;
  /** Long label used in the tooltip. */
  name: string;
  /** Stroke colour (team fill). */
  color: string;
  /** Text colour with ≥ 4.5:1 contrast on the page background. */
  textColor: string;
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
  /** Full-precision value format for the table (defaults to the axis format). */
  formatValue?: (value: number) => string;
}

const MARGIN = { top: 26, right: 56, bottom: 34, left: 56 };

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
}: LineChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [activeX, setActiveX] = useState<number | null>(null);

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
    const tickEvery = Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor(innerW / 56))));
    const regular = xs.filter((_, index) => index % tickEvery === 0);
    const lastX = xs[xs.length - 1];
    // Always label the last value, dropping a regular tick that would collide with it.
    const xTicks = regular.at(-1) === lastX
      ? regular
      : [...regular.filter((tick) => x(lastX) - x(tick) >= 44), lastX];
    return { xs, x, y, yTicks: yTicks.filter((t) => t >= domainY[0] && t <= domainY[1]), xTicks, innerW, innerH };
  }, [height, invertY, series, width]);

  if (!geometry) return null;
  const { xs, x, y, yTicks, xTicks } = geometry;

  const paths = series.map((line) => {
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
    series.flatMap((line) => {
      const last = [...line.points].reverse().find((p) => p.y != null);
      return last ? [{ id: line.id, label: line.label, color: line.textColor, y: y(last.y as number) }] : [];
    }),
    12,
    MARGIN.top,
    height - MARGIN.bottom,
  );

  const activeValues = activeX == null
    ? []
    : series
        .map((line) => ({ line, value: line.points.find((p) => p.x === activeX)?.y ?? null }))
        .filter((entry): entry is { line: LineSeries; value: number } => entry.value != null)
        .sort((a, b) => (invertY ? a.value - b.value : b.value - a.value));

  function nearestX(clientX: number, rect: DOMRect) {
    const px = ((clientX - rect.left) / rect.width) * width;
    return xs.reduce((best, candidate) => (Math.abs(x(candidate) - px) < Math.abs(x(best) - px) ? candidate : best), xs[0]);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    setActiveX(nearestX(event.clientX, event.currentTarget.getBoundingClientRect()));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Escape") return;
    event.preventDefault();
    if (event.key === "Escape") {
      setActiveX(null);
      return;
    }
    const index = activeX == null ? (event.key === "ArrowLeft" ? xs.length - 1 : 0) : xs.indexOf(activeX) + (event.key === "ArrowLeft" ? -1 : 1);
    setActiveX(xs[Math.max(0, Math.min(xs.length - 1, index))]);
  }

  const tooltipLeft = activeX == null ? 0 : x(activeX);
  const tooltipOnLeft = tooltipLeft > width * 0.6;

  return (
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
            <text x={x(band.x0 - 0.5) + 3} y={MARGIN.top + 11} fontSize="10" fill="#D4A72D" fontFamily="var(--font-mono, monospace)">
              {band.label}
            </text>
          </g>
        ))}
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke="rgba(255,255,255,0.06)" />
            <text x={MARGIN.left - 8} y={y(tick) + 3.5} textAnchor="end" fontSize="11" fill="rgba(255,255,255,0.66)" className="font-mono tabular-nums">
              {formatY(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={`x-${tick}`} x={x(tick)} y={height - MARGIN.bottom + 16} textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.66)" className="font-mono tabular-nums">
            {formatX(tick)}
          </text>
        ))}
        <text x={MARGIN.left} y={height - 4} fontSize="10" fill="rgba(255,255,255,0.62)" className="font-mono uppercase" letterSpacing="0.08em">
          {xLabel}
        </text>
        <text x={8} y={12} fontSize="10" fill="rgba(255,255,255,0.62)" className="font-mono uppercase" letterSpacing="0.08em">
          {yLabel}
        </text>
        {activeX != null && (
          <line x1={x(activeX)} x2={x(activeX)} y1={MARGIN.top} y2={height - MARGIN.bottom} stroke="rgba(255,255,255,0.22)" />
        )}
        {paths.map(({ line, d }) => (
          <path
            key={line.id}
            d={d}
            fill="none"
            stroke={line.color}
            strokeWidth={activeValues.length && !activeValues.some((v) => v.line.id === line.id) ? 1.25 : 2}
            strokeDasharray={line.dashed ? "5 4" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {xs.length <= 30 && series.map((line) => line.points.filter((point) => point.y != null).map((point) => (
          <circle key={`pt-${line.id}-${point.x}`} cx={x(point.x)} cy={y(point.y as number)} r={2.5} fill={line.color} />
        )))}
        {activeValues.map(({ line, value }) => (
          <circle key={`dot-${line.id}`} cx={x(activeX as number)} cy={y(value)} r={3.5} fill={line.color} stroke="#080A0D" strokeWidth={1.5} />
        ))}
        {endLabels.map((label) => (
          <text key={`end-${label.id}`} x={width - MARGIN.right + 6} y={label.y + 3.5} fontSize="11" fill={label.color} className="font-mono">
            {label.label}
          </text>
        ))}
      </svg>
      {activeX != null && activeValues.length > 0 && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-[160px] rounded-lg border border-white/[0.12] bg-surface-2/95 px-3 py-2 shadow-glow-depth"
          style={tooltipOnLeft ? { right: width - tooltipLeft + 12 } : { left: tooltipLeft + 12 }}
          aria-live="polite"
        >
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-white/[0.66]">{formatX(activeX)}</p>
          {activeValues.slice(0, 10).map(({ line, value }) => (
            <p key={line.id} className="flex items-center justify-between gap-4 font-mono text-[11px] tabular-nums">
              <span className="flex items-center gap-1.5" style={{ color: line.textColor }}>
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: line.color }} />
                {line.label}
              </span>
              <span className="text-light">{formatY(value)}</span>
            </p>
          ))}
        </div>
      )}
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
    <details className="mt-3 rounded-md border border-white/[0.06] px-3 py-2" data-chart-values>
      <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.08em] text-white/[0.70] hover:text-light">
        Values table · {series.length} series · {rows.length} rows
      </summary>
      <div className="mt-2 max-h-80 overflow-auto">
        <table className="w-full border-collapse text-left">
          <caption className="pb-2 text-left font-mono text-[11px] text-white/[0.66]">
            {caption}
            {step > 1 ? ` · every ${step}th ${xLabel.toLowerCase()} of ${xs.length} shown; the CSV export has all values` : ""}
          </caption>
          <thead>
            <tr className="border-b border-white/[0.08] font-mono text-[11px] uppercase tracking-[0.06em] text-white/[0.66]">
              <th scope="col" className="px-2 py-1.5">{xLabel}</th>
              {series.map((line) => (
                <th key={line.id} scope="col" className="px-2 py-1.5" style={{ color: line.textColor }}>
                  {line.label} <span className="sr-only">{line.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((xValue) => (
              <tr key={xValue} className="border-b border-white/[0.04]">
                <th scope="row" className="px-2 py-1 text-left font-mono text-[11px] font-normal tabular-nums text-white/[0.72]">{formatX(xValue)}</th>
                {values.map((byX, index) => {
                  const value = byX.get(xValue);
                  return (
                    <td key={series[index].id} className="px-2 py-1 font-mono text-[11px] tabular-nums text-white/[0.84]">
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
