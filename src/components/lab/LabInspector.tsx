"use client";

import { asArray, type LabConstructorStanding, type LabRaceResult } from "@/lib/lab-client";
import { comparisonInsights, constructorInsights, raceInsights, standingsInsights } from "@/lib/lab-insights.mjs";
import { labViewDef, type LabViewId } from "@/lib/lab-workspace.mjs";
import { teamColor } from "@/lib/team-colors";
import { useLabResource } from "./useLabResource";
import type { LabViewContext } from "./view-shared";

export interface InspectorShortcut {
  id: string;
  label: string;
  run: () => void;
}

interface LabInspectorProps {
  view: LabViewId;
  context: LabViewContext;
  onAsk: () => void;
  shortcuts: readonly InspectorShortcut[];
}

const RACE_VIEWS = new Set<LabViewId>(["report", "pace", "fastest", "strategy", "timeline", "sessions"]);
const heading = "text-[14px] font-medium text-white/[0.86]";
const cell = "py-2 font-mono text-[13px] tabular-nums";

function Swatch({ team }: { team: string | null | undefined }) {
  return <span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: teamColor(team ?? "") }} />;
}

/** Race classification with the grid-to-finish change, for the race views. */
function Classification({ results }: { results: readonly LabRaceResult[] }) {
  const rows = [...results].filter((row) => row.position != null).sort((a, b) => (a.position as number) - (b.position as number)).slice(0, 10);
  if (rows.length === 0) return <p className="mt-2 text-[13px] text-white/[0.70]">No race classification is published for this race yet.</p>;
  return (
    <table className="mt-2 w-full border-collapse text-left" aria-label="Race classification, top ten">
      <thead className="sr-only"><tr><th scope="col">Position</th><th scope="col">Driver</th><th scope="col">Places gained from the grid</th></tr></thead>
      <tbody>
        {rows.map((row) => {
          const change = row.grid && row.grid > 0 && row.position ? row.grid - row.position : null;
          return (
            <tr key={`${row.driver_code}-${row.position}`} className="border-b border-white/[0.04]">
              <td className={`${cell} w-8 text-white/[0.62]`}>{row.position}</td>
              <td className="py-2 text-[14px] text-white/[0.86]"><Swatch team={row.team_name} />{row.last_name ?? row.driver_code}</td>
              <td className={`${cell} text-right ${change ? "text-white/[0.78]" : "text-white/[0.62]"}`}>
                {change == null ? "—" : change > 0 ? `+${change}` : change < 0 ? `−${Math.abs(change)}` : "="}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Driver standings with the gap to the leader, for the season and compare views. */
function Standings({ standings }: { standings: LabViewContext["standings"] }) {
  const rows = [...standings].filter((row) => row.points != null).sort((a, b) => (a.position ?? 999) - (b.position ?? 999)).slice(0, 8);
  if (rows.length === 0) return <p className="mt-2 text-[13px] text-white/[0.70]">No driver standings are published for this season.</p>;
  const leader = rows[0].points as number;
  return (
    <table className="mt-2 w-full border-collapse text-left" aria-label="Driver standings, top eight">
      <thead className="sr-only"><tr><th scope="col">Position</th><th scope="col">Driver</th><th scope="col">Points</th><th scope="col">Gap to the leader</th></tr></thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.driver_id} className="border-b border-white/[0.04]">
            <td className={`${cell} w-7 text-white/[0.62]`}>{row.position ?? index + 1}</td>
            <td className="py-2 text-[14px] text-white/[0.86]"><Swatch team={row.team_name} />{row.last_name}</td>
            <td className={`${cell} text-right text-light`}>{row.points}</td>
            <td className={`${cell} w-12 text-right text-white/[0.62]`}>{index === 0 ? "—" : `−${Math.round(((leader - (row.points as number)) + Number.EPSILON) * 10) / 10}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Right-hand panel: the values behind the view, "What stands out" computed
 * from those same API rows (a fixed rule per sentence, never generated
 * text), and shortcuts to ready-made analyses.
 */
export function LabInspector({ view, context, onAsk, shortcuts }: LabInspectorProps) {
  const constructors = useLabResource<LabConstructorStanding[]>(view === "constructors" ? `/v1/f1/standings/constructors/${context.season}` : null);
  const raceView = RACE_VIEWS.has(view);
  const selectedStandings = context.selectedDrivers.flatMap((driver) => {
    const row = context.standings.find((standing) => standing.driver_id === driver.id);
    return row ? [row] : [];
  });
  const insights = view === "constructors"
    ? constructorInsights(asArray<LabConstructorStanding>(constructors.data))
    : view === "h2h"
      ? comparisonInsights(selectedStandings)
      : raceView
        ? raceInsights(context.results)
        : standingsInsights(context.standings);
  const refusal = view === "constructors" && constructors.status === "loading"
    ? "Reading the constructors' standings…"
    : view === "h2h" && selectedStandings.length < 2
      ? "Select two drivers with published standings to compare them."
      : raceView && context.raceIsLoading
        ? "Reading the race classification…"
        : raceView
          ? "No classified result is published for this race, so nothing is computed."
          : "The standings published for this season are not enough to compute a comparison.";

  return (
    <aside aria-label="Inspector" className="flex min-w-0 flex-col gap-6" data-inspector>
      <section aria-label={raceView ? "Race classification" : "Standings"}>
        <h2 className={heading}>{raceView ? `Classification${context.raceLabel ? ` · ${context.raceLabel}` : ""}` : `Standings · ${context.season}`}</h2>
        {raceView ? <Classification results={context.results} /> : <Standings standings={context.standings} />}
      </section>

      <section aria-label="What stands out" className="border-t border-white/[0.06] pt-5" data-insights>
        <h2 className={heading}>What stands out</h2>
        {insights.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {insights.map((sentence) => <li key={sentence} className="text-[14px] leading-6 text-white/[0.84]">{sentence}</li>)}
          </ul>
        ) : (
          <p className="mt-2 text-[14px] leading-6 text-white/[0.70]" data-insights-refusal>{refusal}</p>
        )}
        <p className="mt-2 text-[12px] leading-5 text-white/[0.62]">Computed from the {labViewDef(view).label.toLowerCase()} rows by fixed rules; nothing here is generated.</p>
        <button type="button" onClick={onAsk} className="mt-3 inline-flex min-h-11 items-center text-[14px] lg:min-h-9 text-light underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70">
          Ask a question about this view →
        </button>
      </section>

      {shortcuts.length > 0 && (
        <section aria-label="Ready-made analyses" className="border-t border-white/[0.06] pt-5">
          <h2 className={heading}>Try</h2>
          <ul className="mt-2 space-y-1.5">
            {shortcuts.map((shortcut) => (
              <li key={shortcut.id}>
                <button type="button" onClick={shortcut.run} className="flex min-h-11 w-full items-center rounded-lg border lg:min-h-10 border-white/[0.08] px-3 text-left text-[14px] text-white/[0.78] hover:border-white/[0.18] hover:text-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/70">
                  {shortcut.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
