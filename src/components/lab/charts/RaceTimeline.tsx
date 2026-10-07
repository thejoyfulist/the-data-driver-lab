import type { NeutralisationBand, TimelineIncident } from "@/lib/lab-analytics";

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
}

const rowMessage = "absolute inset-0 flex items-center px-3 font-mono text-[11px] uppercase tracking-[0.06em]";

/**
 * One lap axis carrying neutralisations (SC / VSC), pit-stop density and
 * lap-stamped incidents. Built with CSS percentages so it is identical with
 * or without JavaScript.
 */
export function RaceTimeline({ raceLaps, bands, incidents, pitDensity, unavailable = {} }: RaceTimelineProps) {
  const pct = (lap: number) => `${(Math.max(0, Math.min(lap, raceLaps)) / raceLaps) * 100}%`;
  const maxPit = Math.max(...pitDensity, 1);
  const lapped = incidents.filter((incident) => incident.lap != null);
  const unlapped = incidents.filter((incident) => incident.lap == null);
  const step = raceLaps > 50 ? 10 : raceLaps > 20 ? 5 : 2;
  const ticks = [1, ...Array.from({ length: Math.floor((raceLaps - 1) / step) }, (_, i) => (i + 1) * step).filter((lap) => lap < raceLaps), raceLaps];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <span className="self-center font-mono text-[11px] uppercase tracking-[0.06em] text-white/[0.66]">Neutralised</span>
        <span className="relative h-7 rounded-sm bg-white/[0.03]" role="img" aria-label={unavailable.neutralised ?? (bands.length ? bands.map((band) => `${band.type} laps ${band.start}${band.endPublished ? `–${band.end}` : " (end not published)"}`).join("; ") : "No safety car or virtual safety car period published")}>
          {unavailable.neutralised ? (
            <span className={`${rowMessage} text-ambre`} data-row-unavailable>{unavailable.neutralised}</span>
          ) : bands.length === 0 && (
            <span className={`${rowMessage} text-white/[0.62]`}>No safety car or VSC published</span>
          )}
          {bands.map((band) => (
            <span
              key={`${band.type}-${band.start}`}
              className={`absolute inset-y-0 flex items-center justify-center rounded-[2px] border font-mono text-[10px] text-ambre ${band.type === "VSC" ? "border-dashed border-ambre/60 bg-ambre/[0.08]" : "border-ambre/70 bg-ambre/[0.18]"}`}
              style={{ left: pct(band.start - 1), width: `max(${pct(band.end - band.start + 1)}, 18px)` }}
              title={`${band.type} · laps ${band.start}${band.endPublished ? `–${band.end}` : " · end lap not published"}`}
            >
              {band.type}
            </span>
          ))}
        </span>

        <span className="self-center font-mono text-[11px] uppercase tracking-[0.06em] text-white/[0.66]">Pit stops</span>
        <span className="relative flex h-10 items-end rounded-sm bg-white/[0.03]" role="img" aria-label={unavailable.pits ?? `Pit stops per lap, peak ${maxPit} on one lap`}>
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
              title={count ? `Lap ${index + 1}: ${count} ${count === 1 ? "stop" : "stops"}` : undefined}
            />
          ))}
        </span>

        <span className="self-center font-mono text-[11px] uppercase tracking-[0.06em] text-white/[0.66]">Incidents</span>
        <span className="relative h-6 rounded-sm bg-white/[0.03]" role="img" aria-label={unavailable.incidents ?? (lapped.length ? lapped.map((incident) => `Lap ${incident.lap}: ${incident.label}`).join("; ") : "No lap-stamped incident published")}>
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
              title={`Lap ${incident.lap} · ${incident.label}`}
            />
          ))}
        </span>

        <span className="font-mono text-[11px] uppercase text-white/[0.62]" aria-hidden="true">Lap</span>
        <span className="relative h-4" aria-hidden="true">
          {ticks.map((lap) => (
            <span key={lap} className="absolute -translate-x-1/2 font-mono text-[11px] tabular-nums text-white/[0.62]" style={{ left: pct(lap - 0.5) }}>
              {lap}
            </span>
          ))}
        </span>
      </div>

      {(lapped.length > 0 || unlapped.length > 0) && (
        <ul className="grid gap-x-6 gap-y-1 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
          {[...lapped, ...unlapped].map((incident, index) => (
            <li key={`${incident.label}-${index}`} className="flex gap-3 font-mono text-[11px] uppercase tracking-[0.04em] text-white/[0.72]">
              <span className="w-12 shrink-0 tabular-nums text-white/[0.62]">{incident.lap != null ? `L${incident.lap}` : "No lap"}</span>
              <span>{incident.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
