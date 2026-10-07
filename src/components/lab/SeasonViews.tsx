"use client";

import { useMemo } from "react";
import { buildChampionshipProgression, driverKey, type ProgressionRound } from "@/lib/lab-analytics";
import {
  asArray,
  exportBasename,
  isFiniteNumber,
  sampleSpeed,
  unavailableDetail,
  type LabConstructorStanding,
  type LabHeadToHead,
  type LabRaceResult,
  type LabTelemetry,
} from "@/lib/lab-client";
import { readableTeamColor, teamColor } from "@/lib/team-colors";
import { LineChart, type LineSeries } from "./charts/LineChart";
import { TeamBars } from "./charts/TeamBars";
import { useLabResource, useLabResources } from "./useLabResource";
import { NotPublished, ViewCard, ViewSkeleton } from "./ViewCard";
import { dashTeammates, scopeLine, tableCell, tableHead, type LabViewContext } from "./view-shared";

/**
 * Season-wide views (championship progression, constructors, head-to-head
 * record) and the telemetry tab. They need many requests or large payloads,
 * so the Lab loads them in the browser when they are about to be seen,
 * keeping the server render (and its ISR regeneration) to the selected race.
 */

// ── Championship progression ───────────────────────────────────────────

export function ChampionshipView({ context, variant, uptoRound }: { context: LabViewContext; variant?: "view" | "card"; uptoRound?: number | null }) {
  // Calendar order: in the race report, stop at the race on screen.
  const lastIndex = uptoRound == null ? -1 : context.races.findIndex((race) => race.round === uptoRound);
  const completed = (lastIndex >= 0 ? context.races.slice(0, lastIndex + 1) : context.races).filter((race) => race.completed);
  const endpoints = completed.map((race) => `/v1/f1/races/${context.season}/${race.round}/results`);
  const resources = useLabResources<LabRaceResult[]>(endpoints);
  const loading = endpoints.some((endpoint) => resources[endpoint]?.status === "loading");

  const progression = useMemo(() => {
    const rounds: ProgressionRound[] = completed.map((race) => ({ round: race.round, label: race.label, sprintWeekend: race.sprintWeekend }));
    const resultsByRound: Record<number, LabRaceResult[] | undefined> = {};
    completed.forEach((race, index) => {
      const resource = resources[endpoints[index]];
      if (resource?.status === "ready" || resource?.status === "empty") resultsByRound[race.round] = asArray<LabRaceResult>(resource.data);
    });
    return buildChampionshipProgression(rounds, resultsByRound, context.standings);
    // resources is rebuilt every render; its statuses are the meaningful input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.standings, context.season, endpoints.map((endpoint) => resources[endpoint]?.status).join(",")]);

  const selectedKeys = new Set(context.selectedDrivers.map((driver) => driverKey(driver.code)));
  const shown = dashTeammates(
    [
      ...progression.drivers.filter((driver) => selectedKeys.has(driver.key)),
      ...progression.drivers.slice(0, 6),
    ].filter((driver, index, all) => all.findIndex((other) => other.key === driver.key) === index).slice(0, 8),
  );
  const series: LineSeries[] = shown.map((driver) => ({
    id: driver.key,
    label: driver.code,
    name: driver.name,
    color: teamColor(driver.team),
    textColor: readableTeamColor(driver.team),
    dashed: driver.dashed,
    points: driver.cumulative.map((value, index) => ({ x: index + 1, y: value })),
  }));
  const roundLabels = progression.rounds.map((round) => round.label);
  const sprintRounds = progression.rounds.filter((round) => round.sprintWeekend).length;
  const exportRows = progression.drivers.flatMap((driver) =>
    progression.rounds.map((round, index) => ({
      season: context.season,
      round: round.label,
      sprint_weekend: round.sprintWeekend,
      driver_code: driver.code,
      driver: driver.name,
      team: driver.team,
      cumulative_grand_prix_points: driver.cumulative[index],
      official_season_total: driver.officialTotal,
    })),
  );

  return (
    <ViewCard
      id={variant === "card" ? "lab-report-progression" : "lab-championship"}
      variant={variant}
      title="Championship progression"
      scope={scopeLine([
        variant === "card" ? null : `${context.season}`,
        `Grand Prix points, ${progression.rounds.length > 1 ? `rounds ${progression.rounds[0]?.label}–${progression.rounds.at(-1)?.label}` : `${progression.rounds.length} of ${completed.length} ${completed.length === 1 ? "round" : "rounds"}`}`,
        `${shown.length} drivers (selected + leaders)`,
      ])}
      endpoints={endpoints}
      source={resources[endpoints.at(-1) ?? ""]?.payload?.meta}
      exportRows={exportRows}
      exportName={exportBasename("championship-progression", context.season, null)}
      footnote={
        sprintRounds > 0
          ? `Race results publish Grand Prix points only. ${sprintRounds} sprint ${sprintRounds === 1 ? "weekend adds" : "weekends add"} points that appear in the official total (right column of the table) but not on these curves.`
          : "Curves sum the points published with each race result."
      }
      table={
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className={tableHead}>
                <th scope="col" className="px-3 py-2">Driver</th>
                <th scope="col" className="px-3 py-2">Team</th>
                <th scope="col" className="px-3 py-2">GP points</th>
                <th scope="col" className="px-3 py-2">Official total</th>
              </tr>
            </thead>
            <tbody>
              {progression.drivers.map((driver) => (
                <tr key={driver.key} className="border-b border-white/[0.04]">
                  <th scope="row" className="px-3 py-2 text-left text-[13px] font-normal"><span className="font-mono text-[12px]" style={{ color: readableTeamColor(driver.team) }}>{driver.code}</span> <span className="text-white/[0.84]">{driver.name}</span></th>
                  <td className="px-3 py-2 text-body-sm text-white/[0.70]">{driver.team || "Not published"}</td>
                  <td className={tableCell}>{driver.gpTotal}</td>
                  <td className={tableCell}>{driver.officialTotal ?? "Not published"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    >
      {completed.length === 0 ? (
        <NotPublished title="No completed round yet" detail={`The ${context.season} calendar has no completed round, so there is no progression to draw.`} source="calendar" />
      ) : loading && progression.rounds.length === 0 ? (
        <ViewSkeleton label="Loading championship progression" rows={7} />
      ) : series.length === 0 ? (
        <NotPublished detail="The API returned no race results for this season." source="race results" tone="amber" />
      ) : (
        <>
          <LineChart
            series={series}
            ariaLabel={`Cumulative Grand Prix points by round, ${context.season}`}
            xLabel="Round"
            yLabel="Points"
            formatX={(value) => roundLabels[value - 1] ?? String(value)}
            formatY={(value) => String(Math.round(value))}
            height={variant === "card" ? 240 : 340}
            syncGroup="round"
            showDelta
          />
          {progression.missingRounds.length > 0 && !loading && (
            <p className="mt-3 text-[13px] text-ambre">
              Results not published for {progression.missingRounds.map((round) => round.label).join(", ")}: those rounds are left out, not estimated.
            </p>
          )}
        </>
      )}
    </ViewCard>
  );
}

// ── Constructors ────────────────────────────────────────────────────────

export function ConstructorsView({ context, variant }: { context: LabViewContext; variant?: "view" | "card" }) {
  const endpoint = `/v1/f1/standings/constructors/${context.season}`;
  const resource = useLabResource<LabConstructorStanding[]>(endpoint);
  const rows = asArray<LabConstructorStanding>(resource.data)
    .filter((team) => team.team_name)
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
    .map((team, index) => ({
      id: team.team_id ?? team.team_name ?? index,
      rank: team.position ?? index + 1,
      label: team.team_name as string,
      sub: isFiniteNumber(team.wins) ? `${team.wins} ${team.wins === 1 ? "win" : "wins"}` : null,
      color: teamColor(team.team_name),
      textColor: readableTeamColor(team.team_name),
      value: isFiniteNumber(team.points) ? team.points : 0,
      display: isFiniteNumber(team.points) ? String(Math.round(team.points * 10) / 10) : "Not published",
    }));
  const exportRows = asArray<LabConstructorStanding>(resource.data).map((team) => ({ season: context.season, position: team.position, team: team.team_name, points: team.points, wins: team.wins }));

  return (
    <ViewCard
      id="lab-constructors"
      variant={variant}
      title="Constructors' championship"
      scope={scopeLine([`${context.season}`, "season standings", resource.status === "loading" ? "loading" : `${rows.length} teams`])}
      endpoints={[endpoint]}
      source={resource.payload?.meta}
      exportRows={exportRows}
      exportName={exportBasename("constructors", context.season, null)}
    >
      {resource.status === "loading" ? (
        <ViewSkeleton label="Loading constructors' standings" rows={8} />
      ) : resource.status === "error" ? (
        <NotPublished title="Constructors' standings unavailable" detail="The standings endpoint did not answer." source="/standings/constructors" tone="amber" />
      ) : rows.length === 0 ? (
        <NotPublished title="Not published for this season" detail="The API has no constructors' standings for this season." source="/standings/constructors" />
      ) : (
        <TeamBars rows={rows} />
      )}
    </ViewCard>
  );
}

// ── Head-to-head record (career + season) ──────────────────────────────

export function HeadToHeadRecord({ context }: { context: LabViewContext }) {
  const [a, b] = context.selectedDrivers;
  const endpoint = a && b ? `/v1/f1/drivers/${a.id}/head-to-head/${b.id}?season=${context.season}` : null;
  const resource = useLabResource<LabHeadToHead>(endpoint);
  if (!endpoint || !a || !b) return null;
  const data = resource.data;
  const records: [string, LabHeadToHead["race_h2h"] | undefined][] = [
    [`${context.season} races`, data?.season_race_h2h],
    ["Career races", data?.race_h2h],
    ["Career qualifying", data?.quali_h2h],
  ];
  const colorA = teamColor(a.team);
  const colorB = teamColor(b.team);
  return (
    <div className="mt-5 border-t border-white/[0.06] pt-5" data-h2h-record>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[14px] text-white/[0.78]">
          Finishing record · <span style={{ color: readableTeamColor(a.team) }}>{a.code}</span> vs <span style={{ color: readableTeamColor(b.team) }}>{b.code}</span>
        </p>
        <p className="font-mono text-[12px] text-white/[0.62]">GET /v1/f1/drivers/{a.id}/head-to-head/{b.id}?season={context.season}</p>
      </div>
      {resource.status === "loading" ? (
        <ViewSkeleton label="Loading head-to-head record" rows={3} />
      ) : resource.status !== "ready" ? (
        <NotPublished title="Head-to-head not published" detail="The API returned no head-to-head record for this pair." source="/drivers/{a}/head-to-head/{b}" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {records.map(([label, record]) => {
            const winsA = record?.driver1_wins ?? null;
            const winsB = record?.driver2_wins ?? null;
            const total = record?.total ?? null;
            const share = winsA != null && winsB != null && winsA + winsB > 0 ? winsA / (winsA + winsB) : null;
            return (
              <div key={label} className="rounded-md border border-white/[0.06] px-3 py-3">
                <p className="text-[13px] text-white/[0.70]">{label}</p>
                {total ? (
                  <>
                    <p className="mt-1 font-mono text-[16px] tabular-nums text-light">{winsA} – {winsB}</p>
                    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
                      <span style={{ width: `${(share ?? 0) * 100}%`, backgroundColor: colorA }} />
                      <span style={{ width: `${(1 - (share ?? 0)) * 100}%`, backgroundColor: colorB, opacity: 0.8 }} />
                    </div>
                    <p className="mt-1 text-[12px] text-white/[0.66]">{total} {label.endsWith("qualifying") ? "sessions" : "races"} both classified</p>
                  </>
                ) : (
                  <p className="mt-1 text-body-sm text-white/[0.66]">No shared classified finish published.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Telemetry (session explorer tab) ───────────────────────────────────

export function TelemetryPanel({ context }: { context: LabViewContext }) {
  const driver = context.selectedDrivers[0];
  const endpoint = context.round != null && driver ? `/v1/f1/races/${context.season}/${context.round}/telemetry/${driver.id}` : null;
  const resource = useLabResource<LabTelemetry>(endpoint);
  // The API publishes `speed_kph`; `speed` is accepted as a legacy alias.
  const speeds = asArray<NonNullable<LabTelemetry["samples"]>[number]>(resource.data?.samples)
    .map(sampleSpeed)
    .filter((speed): speed is number => speed != null);

  if (!endpoint || !driver) {
    return <NotPublished title="Select a driver" detail="Telemetry is read per driver: select one in the field view." />;
  }
  if (resource.status === "loading") return <ViewSkeleton label="Loading telemetry" rows={4} />;
  if (resource.status === "error") {
    return (
      <NotPublished
        title={resource.errorStatus === 409 ? "Telemetry withheld" : "Telemetry unavailable"}
        detail={resource.errorStatus === 409 ? "Telemetry for this race mixes several sources, so the API withholds it until provenance is homogeneous." : "The telemetry endpoint did not answer for this race."}
        source={`GET ${endpoint}`}
        tone="amber"
      />
    );
  }
  if (speeds.length < 2) {
    return (
      <NotPublished
        detail={unavailableDetail(resource.data, `No car telemetry is published for ${driver.name} in this race. Nothing is interpolated`)}
        source={`GET ${endpoint} · OpenF1 historical enrichment`}
      />
    );
  }
  return (
    <LineChart
      series={[{
        id: driver.code,
        label: driver.code,
        name: driver.name,
        color: teamColor(driver.team),
        textColor: readableTeamColor(driver.team),
        points: speeds.map((speed, index) => ({ x: index + 1, y: speed })),
      }]}
      ariaLabel={`Speed trace for ${driver.name}, first ${speeds.length} published samples`}
      xLabel="Sample"
      yLabel="km/h"
      height={260}
    />
  );
}
