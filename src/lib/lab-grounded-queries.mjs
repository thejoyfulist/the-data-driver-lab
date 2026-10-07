export const STARTER_QUESTIONS = {
  POSITION_GAIN: "Who gained the most from grid to finish?",
  SELECTED_DRIVER_COMPARISON: "Compare the selected drivers this season.",
  MISSING_DATA: "Which data is missing for this race?",
};

/**
 * Track the latest asynchronous request so a response cannot commit after
 * its semantic UI context has been invalidated.
 */
export function createLatestRequestGate() {
  let latestRequestId = 0;
  return {
    begin() {
      latestRequestId += 1;
      return latestRequestId;
    },
    invalidate() {
      latestRequestId += 1;
    },
    isCurrent(requestId) {
      return requestId === latestRequestId;
    },
  };
}

export function transitionInitialSeasonRestore(season, initialSeason, hasVisitedArchive) {
  if (season !== initialSeason) {
    return { restore: false, hasVisitedArchive: true };
  }
  return { restore: hasVisitedArchive, hasVisitedArchive: false };
}

export function normalizeChatPayload(raw) {
  const payload = raw?.data ?? raw;
  const answer = typeof payload?.answer === "string" ? payload.answer.trim() : "";
  if (!answer) throw new Error("empty answer");
  return {
    answer,
    sources: Array.isArray(payload?.sources) ? payload.sources : [],
  };
}

export function apiSourceHref(href, siteUrl = "", labPath = "/lab") {
  if (typeof href !== "string" || href.includes("\\")) return null;

  // Normalize the proxy-prefixed form (/api/f1/v1/...) to the canonical API
  // path (/v1/...) so one mapping covers both backend and frontend hrefs.
  const path = href.startsWith("/api/f1/") ? href.slice("/api/f1".length) : href;

  // Article sources have a rendered page.
  const article = path.match(/^\/v1\/f1\/articles\/([^/]+)$/);
  if (article) return `${siteUrl}/articles/${article[1]}`;

  // Model methodology has a rendered page.
  if (path === "/v1/f1/model/info") return `${siteUrl}/methodology`;

  // Standings, calendar and race results live on the season page.
  if (/^\/v1\/f1\/standings\/(drivers|constructors)\//.test(path)) return `${siteUrl}/season`;
  if (/^\/v1\/f1\/calendar\//.test(path)) return `${siteUrl}/season`;
  if (/^\/v1\/f1\/races\/\d+\/\d+\/results/.test(path)) return `${siteUrl}/season`;

  // Race forecast lives on the grid page.
  if (/^\/v1\/f1\/predictions\/race\//.test(path)) return `${siteUrl}/grid`;

  // Practice, qualifying and qualifying forecast live in the Lab.
  if (/^\/v1\/f1\/races\/\d+\/\d+\/(practice|qualifying)/.test(path)) return labPath;
  if (/^\/v1\/f1\/predictions\/qualifying\//.test(path)) return labPath;

  // Any other same-origin path is already a rendered route.
  if (path.startsWith("/") && !path.startsWith("//")) return `${siteUrl}${path}`;
  if (/^https:\/\//i.test(path)) return path;
  return null;
}

export function buildDriverHeadToHead(selectedRows) {
  if (!Array.isArray(selectedRows) || selectedRows.length < 2) return [];

  const position = (value) => value == null ? "Unavailable" : `P${value}`;
  const number = (value) => value == null ? "Unavailable" : String(value);
  const probability = (value) => value == null
    ? "Unavailable"
    : `${(value * 100).toFixed(1)}%`;

  return selectedRows.map((row) => ({
    id: row.id,
    code: row.code ?? "—",
    name: row.name,
    team: row.team ?? "Unavailable",
    metrics: {
      championship: position(row.seasonPosition),
      points: number(row.seasonPoints),
      wins: number(row.wins),
      grid: position(row.grid),
      finish: position(row.racePosition),
      winChance: probability(row.winProbability),
    },
  }));
}

/**
 * Grid-to-finish gains, best first. The single rule shared by the "Who gained
 * the most" answer and the race report: classified rows with a published grid
 * slot (> 0, so pit-lane starts are left out) and a finishing position.
 */
export function rankPositionGains(results) {
  return (Array.isArray(results) ? results : [])
    .filter((result) => result.grid > 0 && result.position > 0)
    .map((result) => ({ ...result, gained: result.grid - result.position }))
    .sort((left, right) => right.gained - left.gained);
}

/**
 * Visible label for the selected race. `context.round` is the internal API key
 * (it still counts cancelled rounds); callers pass `roundLabel` with the
 * official formula1.com round ("R15") or the race name when it is unknown.
 */
function displayRound(context) {
  return typeof context.roundLabel === "string" && context.roundLabel
    ? context.roundLabel
    : `R${context.round}`;
}

/**
 * Build a deterministic answer for a guided Race Lab question.
 *
 * @param {string} question
 * @param {object} context
 * @returns {{answer: string, sources: {title: string, href: string}[]} | null}
 */
export function buildStarterAnswer(question, context) {
  if (question === STARTER_QUESTIONS.MISSING_DATA && context.round == null) {
    return {
      answer: "Select a race before checking its data coverage.",
      sources: [],
    };
  }
  if (question === STARTER_QUESTIONS.POSITION_GAIN && context.round == null) {
    return {
      answer: "Select a race before comparing grid and finish positions.",
      sources: [],
    };
  }

  if (question === STARTER_QUESTIONS.MISSING_DATA) {
    const payloads = [
      ["race results", context.results.length > 0],
      ["practice data", context.practiceCount > 0],
      ["qualifying results", context.qualifyingCount > 0],
      ["race forecast", context.racePredictionCount > 0],
      ["qualifying forecast", context.qualifyingPredictionCount > 0],
    ];
    const missing = payloads.filter(([, published]) => !published).map(([label]) => label);
    const published = payloads.filter(([, ready]) => ready).map(([label]) => label);
    const naturalList = (items) => items.length < 2
      ? items.join("")
      : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
    const prefix = `For ${context.season} ${displayRound(context)}`;
    const verb = (items) => items.length > 1 || items[0]?.endsWith("results") ? "are" : "is";
    const answer = missing.length === 0
      ? `${prefix}, ${naturalList(published)} ${verb(published)} published.`
      : `${prefix}, ${naturalList(missing)} ${verb(missing)} unavailable.${published.length > 0 ? ` ${naturalList(published).replace(/^./, (character) => character.toUpperCase())} ${verb(published)} published.` : ""}`;

    return {
      answer,
      sources: [
        { title: "Race results", href: `/api/f1/v1/f1/races/${context.season}/${context.round}/results?session=race` },
        { title: "Practice data", href: `/api/f1/v1/f1/races/${context.season}/${context.round}/practice` },
        { title: "Qualifying results", href: `/api/f1/v1/f1/races/${context.season}/${context.round}/qualifying` },
        { title: "Race forecast", href: `/api/f1/v1/f1/predictions/race/${context.season}/${context.round}` },
        { title: "Qualifying forecast", href: `/api/f1/v1/f1/predictions/qualifying/${context.season}/${context.round}` },
      ],
    };
  }

  if (question === STARTER_QUESTIONS.SELECTED_DRIVER_COMPARISON) {
    if (context.selectedRows.length === 0) {
      return {
        answer: "Select at least one driver in the field before running this comparison.",
        sources: [],
      };
    }
    const comparisons = context.selectedRows.map((driver) => {
      const position = driver.seasonPosition == null
        ? "unavailable in the championship order"
        : `P${driver.seasonPosition}`;
      const points = driver.seasonPoints == null ? "unavailable" : driver.seasonPoints;
      const wins = driver.wins == null ? "unavailable" : driver.wins;
      const winLabel = driver.wins === 1 ? "win" : "wins";
      return `${driver.name} is ${position} with ${points} points and ${wins} ${winLabel}`;
    });
    return {
      answer: `In the ${context.season} standings, ${comparisons.join("; ")}.`,
      sources: [
        {
          title: `${context.season} driver standings`,
          href: `/api/f1/v1/f1/standings/drivers/${context.season}`,
        },
      ],
    };
  }

  if (question !== STARTER_QUESTIONS.POSITION_GAIN) return null;

  const gainers = rankPositionGains(context.results);
  const best = gainers[0];
  if (!best) {
    return {
      answer: `Position gain is unavailable for ${context.season} ${displayRound(context)} because the live API returned no classified race result with a grid position.`,
      sources: [
        {
          title: `${context.season} ${displayRound(context)} race results`,
          href: `/api/f1/v1/f1/races/${context.season}/${context.round}/results?session=race`,
        },
      ],
    };
  }

  if (best.gained <= 0) {
    return {
      answer: `No driver gained a position in ${context.season} ${displayRound(context)} among classified race results with a grid position.`,
      sources: [
        {
          title: `${context.season} ${displayRound(context)} race results`,
          href: `/api/f1/v1/f1/races/${context.season}/${context.round}/results?session=race`,
        },
      ],
    };
  }

  const tiedBest = gainers.filter((result) => result.gained === best.gained);
  if (tiedBest.length > 1) {
    const names = tiedBest.map((result) => `${result.first_name} ${result.last_name}`);
    const naturalNames = `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    const moves = tiedBest.map((result) => (
      `${result.first_name} ${result.last_name} moved from P${result.grid} to P${result.position}`
    ));
    return {
      answer: `${naturalNames} tied for the most positions gained in ${context.season} ${displayRound(context)}: ${best.gained} ${best.gained === 1 ? "place" : "places"} each. ${moves.join("; ")}.`,
      sources: [
        {
          title: `${context.season} ${displayRound(context)} race results`,
          href: `/api/f1/v1/f1/races/${context.season}/${context.round}/results?session=race`,
        },
      ],
    };
  }

  return {
    answer: `${best.first_name} ${best.last_name} gained the most positions in ${context.season} ${displayRound(context)}: ${best.gained} ${best.gained === 1 ? "place" : "places"}, from P${best.grid} to P${best.position}.`,
    sources: [
      {
        title: `${context.season} ${displayRound(context)} race results`,
        href: `/api/f1/v1/f1/races/${context.season}/${context.round}/results?session=race`,
      },
    ],
  };
}
