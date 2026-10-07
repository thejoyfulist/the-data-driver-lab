import type { StintPlan } from "@/lib/lab-analytics";
import { formatLapMs } from "@/lib/lab-client";

export interface StintRow extends StintPlan {
  color: string;
  textColor: string;
}

function lapTicks(maxLap: number): number[] {
  const step = maxLap > 50 ? 10 : maxLap > 20 ? 5 : 2;
  const ticks = [1];
  for (let lap = step; lap < maxLap; lap += step) ticks.push(lap);
  if (ticks.at(-1) !== maxLap) ticks.push(maxLap);
  return ticks;
}

/**
 * Pit-stop strategy as stints on a shared lap axis (CSS percentages, so it
 * renders identically on the server and at any width). Tyre compounds are
 * not published by the pit-stop endpoint, so stints are numbered, not coloured
 * by compound.
 */
export function StintTimeline({ rows, maxLap }: { rows: readonly StintRow[]; maxLap: number }) {
  const pct = (lap: number) => `${(Math.max(0, Math.min(lap, maxLap)) / maxLap) * 100}%`;
  return (
    <div className="space-y-1" role="list" aria-label="Pit stop strategy by driver">
      {rows.map((row) => (
        <div key={row.key} role="listitem" className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_4.5rem]">
          <span className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
            <span className="font-mono text-[12px] tabular-nums text-white/[0.62]">{row.finish != null ? `P${row.finish}` : "—"}</span>
            <span className="truncate font-mono text-[12px]" style={{ color: row.textColor }}>{row.code}</span>
          </span>
          <span className="relative h-5 rounded-sm bg-white/[0.03]" aria-label={`${row.name}: ${row.stops.length} ${row.stops.length === 1 ? "stop" : "stops"}${row.stops.length ? ` on lap ${row.stops.map((stop) => stop.lap).join(", ")}` : ""}`} role="img">
            {row.stints.map((stint) => (
              <span
                key={stint.index}
                className="absolute inset-y-0.5 rounded-[2px]"
                style={{
                  left: pct(stint.start - 1),
                  width: `calc(${pct(stint.end - stint.start + 1)} - 2px)`,
                  backgroundColor: row.color,
                  opacity: stint.index % 2 ? 0.85 : 0.45,
                }}
                title={`Stint ${stint.index}: laps ${stint.start}–${stint.end}`}
              />
            ))}
            {row.stops.map((stop) => (
              <span
                key={`${stop.stop}-${stop.lap}`}
                className="absolute -top-0.5 h-6 w-[2px] bg-light"
                style={{ left: pct(stop.lap) }}
                title={`Stop ${stop.stop} · lap ${stop.lap}${stop.durationMs != null ? ` · ${formatLapMs(stop.durationMs)} pit lane` : ""}`}
              />
            ))}
          </span>
          <span className="text-right font-mono text-[12px] tabular-nums text-white/[0.66]">
            {row.stops.length} {row.stops.length === 1 ? "stop" : "stops"}
          </span>
        </div>
      ))}
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] gap-3 pt-2 sm:grid-cols-[8rem_minmax(0,1fr)_4.5rem]" aria-hidden="true">
        <span className="text-[12px] text-white/[0.62]">Lap</span>
        <span className="relative h-4">
          {lapTicks(maxLap).map((lap) => (
            <span key={lap} className="absolute -translate-x-1/2 font-mono text-[12px] tabular-nums text-white/[0.62]" style={{ left: pct(lap) }}>
              {lap}
            </span>
          ))}
        </span>
        <span />
      </div>
    </div>
  );
}
