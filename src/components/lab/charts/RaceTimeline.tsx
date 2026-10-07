"use client";

import type { KeyboardEvent, PointerEvent } from "react";
import type { NeutralisationBand, TimelineIncident } from "@/lib/lab-analytics";
import { useChartCursor } from "./chart-utils";

interface RaceTimelineProps {
  raceLaps: number;
  bands: readonly NeutralisationBand[];
  incidents: readonly TimelineIncident[];
  pitDensity: readonly number[];
  /**
   * Per-row message when that dataset could not be read: an unreachable
   * endpoint is not the same as "nothing happened".
   */
  unavailable?: { neutralised?: string | null; pits?: string | null; incidents?: string | null };
  /** Shares the lap cursor with the lap charts of the same group. */
  syncGroup?: string;
  /** Hide the incident list under the strip (race report card). */
  compact?: boolean;
}

const rowMessage = "absolute inset-0 truncate px-3 text-[12px] leading-[inherit]";
const rowLabel = "flex items-center text-[13px] text-white/[0.70]";

/**
 * One lap axis carrying neutralisations (SC / VSC), pit-stop density and
 * lap-stamped incidents. Built with CSS percentages so it is identical with
 * or without JavaScript; with JavaScript, hovering or arrow-keying the strip
 * moves a lap cursor shared with the lap charts.
 */
export function RaceTimeline({ raceLaps, bands, incidents, pitDensity, unavailable = {}, syncGroup, compact = false }: RaceTimelineProps) {
  const [cursor, setCursor] = useChartCursor(syncGroup);
  const pct = (lap: number) => `${(Math.max(0, Math.min(lap, raceLaps)) / raceLaps) * 100}%`;
  const maxPit = Math.max(...pitDensity, 1);
  const lapped = incidents.filter((incident) => incident.lap != null);
  const unlapped = incidents.filter((incident) => incident.lap == null);
  const step = raceLaps > 50 ? 10 : raceLaps > 20 ? 5 : 2;
  const ticks = [1, ...Array.from({ length: Math.floor((raceLaps - 1) / step) }, (_, i) => (i + 1) * step).filter((lap) => lap < raceLaps), raceLaps];
  const lap = cursor != null && cursor >= 1 && cursor <= raceLaps ? Math.round(cursor) : null;

  function lapAt(clientX: number, rect: DOMRect) {
    return Math.max(1, Math.min(raceLaps, Math.ceil(((clientX - rect.left) / rect.width) * raceLaps)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") return setCursor(null);
    if (event.key === "Home") return setCursor(1);
    if (event.key === "End") return setCursor(raceLaps);
    const next = lap == null ? (event.key === "ArrowLeft" ? raceLaps : 1) : lap + (event.key === "ArrowLeft" ? -1 : 1);
    setCursor(Math.max(1, Math.min(raceLaps, next)));
  }

  const readout = lap == null
    ? null
    : [
        `Lap ${lap}`,
        ...bands.filter((band) => lap >= band.start && lap <= band.end).map((band) => band.type),
        pitDensity[lap - 1] ? `${pitDensity[lap - 1]} pit ${pitDensity[lap - 1] === 1 ? "stop" : "stops"}` : null,
        ...lapped.filter((incident) => incident.lap === lap).map((incident) => incident.label),
      ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
        <div className="grid grid-rows-[28px_40px_24px_16px] gap-y-2" aria-hidden="true">
          <span className={rowLabel}>Neutralised</span>
          <span className={rowLabel}>Pit stops</span>
          <span className={rowLabel}>Incidents</span>
          <span className="flex items-center text-[12px] text-white/[0.62]">Lap</span>
        </div>
        <div
          className="relative grid touch-pan-y grid-rows-[28px_40px_24px_16px] gap-y-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/60"
          tabIndex={0}
          role="group"
          aria-label="Race timeline by lap. Use the left and right arrow keys to read a lap."
          onPointerMove={(event: PointerEvent<HTMLDivElement>) => setCursor(lapAt(event.clientX, event.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setCursor(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setCursor(null)}
          data-cursor-lap={lap ?? undefined}
        >
          <span className="relative rounded-sm bg-white/[0.03] leading-7" role="img" aria-label={unavailable.neutralised ?? (bands.length ? bands.map((band) => `${band.type} laps ${band.start}${band.endPublished ? `–${band.end}` : " (end not published)"}`).join("; ") : "No safety car or virtual safety car period published")}>
            {unavailable.neutralised ? (
              <span className={`${rowMessage} text-ambre`} data-row-unavailable>{unavailable.neutralised}</span>
            ) : bands.length === 0 && (
              <span className={`${rowMessage} text-white/[0.62]`}>No safety car or VSC published</span>
            )}
            {bands.map((band) => (
              <span
                key={`${band.type}-${band.start}`}
                className={`lab-neutralisation-band absolute inset-y-0 flex items-center justify-center rounded-[2px] border font-mono text-[12px] text-ambre ${band.type === "VSC" ? "border-dashed border-ambre/60 bg-ambre/[0.08]" : "border-ambre/70 bg-ambre/[0.18]"}`}
                style={{ left: pct(band.start - 1), width: pct(band.end - band.start + 1) }}
                title={`${band.type} · laps ${band.start}${band.endPublished ? `–${band.end}` : " · end lap not published"}`}
                data-neutralisation-band
              >
                <span className="lab-neutralisation-label">{band.type}</span>
              </span>
            ))}
          </span>

          <span className="relative flex items-end rounded-sm bg-white/[0.03] leading-10" role="img" aria-label={unavailable.pits ?? `Pit stops per lap, peak ${maxPit} on one lap`}>
            {unavailable.pits ? (
              <span className={`${rowMessage} text-ambre`} data-row-unavailable>{unavailable.pits}</span>
            ) : pitDensity.every((count) => count === 0) && (
              <span className={`${rowMessage} text-white/[0.62]`}>No pit stop published for this race</span>
            )}
            {pitDensity.map((count, index) => (
              <span
                key={index}
                className="absolute bottom-0 rounded-t-[1px] bg-white/[0.55]"
                style={{ left: pct(index), width: `max(calc(${100 / raceLaps}% - 1px), 1px)`, height: count ? `${(count / maxPit) * 100}%` : 0 }}
              />
            ))}
          </span>

          <span className="relative rounded-sm bg-white/[0.03] leading-6" role="img" aria-label={unavailable.incidents ?? (lapped.length ? lapped.map((incident) => `Lap ${incident.lap}: ${incident.label}`).join("; ") : "No lap-stamped incident published")}>
            {unavailable.incidents ? (
              <span className={`${rowMessage} text-ambre`} data-row-unavailable>{unavailable.incidents}</span>
            ) : lapped.length === 0 && (
              <span className={`${rowMessage} text-white/[0.62]`}>No lap-stamped incident published</span>
            )}
            {lapped.map((incident, index) => (
              <span
                key={`${incident.label}-${index}`}
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-dark bg-light"
                style={{ left: pct((incident.lap as number) - 0.5) }}
              />
            ))}
          </span>

          <span className="relative" aria-hidden="true">
            {ticks.map((tick) => (
              <span key={tick} className="absolute -translate-x-1/2 font-mono text-[12px] leading-4 tabular-nums text-white/[0.62]" style={{ left: pct(tick - 0.5) }}>
                {tick}
              </span>
            ))}
          </span>

          {lap != null && (
            <span aria-hidden="true" className="pointer-events-none absolute bottom-5 top-0 w-px bg-teal/50" style={{ left: pct(lap - 0.5) }} data-timeline-cursor />
          )}
        </div>
      </div>
      <p className="min-h-5 text-[13px] text-white/[0.78]" aria-live="polite" data-timeline-readout>
        {readout ?? <span className="text-white/[0.62]">Hover or use the arrow keys on the strip to read a lap.</span>}
      </p>

      {!compact && (lapped.length > 0 || unlapped.length > 0) && (
        <ul className="grid gap-x-6 gap-y-1 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
          {[...lapped, ...unlapped].map((incident, index) => (
            <li key={`${incident.label}-${index}`} className="flex gap-3 text-[13px] text-white/[0.72]">
              <span className="w-14 shrink-0 font-mono text-[12px] tabular-nums text-white/[0.62]">{incident.lap != null ? `L${incident.lap}` : "No lap"}</span>
              <span>{incident.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
