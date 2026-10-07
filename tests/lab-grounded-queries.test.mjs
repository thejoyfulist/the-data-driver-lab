import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  apiSourceHref,
  buildDriverHeadToHead,
  buildStarterAnswer,
  createLatestRequestGate,
  normalizeChatPayload,
  transitionInitialSeasonRestore,
} from "../src/lib/lab-grounded-queries.mjs";

const labPageSource = readFileSync(new URL("../src/app/LabPageClient.tsx", import.meta.url), "utf8");
const labServerSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
// The browser fetch helper (and its envelope handling) lives in lab-client.ts.
const labClientSource = readFileSync(new URL("../src/lib/lab-client.ts", import.meta.url), "utf8");
// Practice is read from the per-session best-lap classifications;
// this marker isolates the session request effect.
const SESSION_EFFECT_MARKER = "/practice/${session}/best";

function effectContaining(marker) {
  const markerIndex = labPageSource.indexOf(marker);
  assert.ok(markerIndex >= 0, `missing effect marker: ${marker}`);
  const start = labPageSource.lastIndexOf("  useEffect(() => {", markerIndex);
  const end = labPageSource.indexOf("\n  }, [", markerIndex);
  assert.ok(start >= 0 && end >= 0, `could not isolate effect containing: ${marker}`);
  return labPageSource.slice(start, labPageSource.indexOf("\n", end + 7));
}

test("answers the position-gain starter from the selected race results", () => {
  const answer = buildStarterAnswer("Who gained the most from grid to finish?", {
    season: 2026,
    round: 13,
    selectedRows: [],
    results: [
      { first_name: "Lando", last_name: "Norris", grid: 12, position: 4 },
      { first_name: "Max", last_name: "Verstappen", grid: 3, position: 1 },
      { first_name: "Lewis", last_name: "Hamilton", grid: 0, position: 2 },
    ],
    practiceCount: 0,
    qualifyingCount: 0,
    qualifyingPredictionCount: 0,
    racePredictionCount: 0,
  });

  assert.deepEqual(answer, {
    answer: "Lando Norris gained the most positions in 2026 R13: 8 places, from P12 to P4.",
    sources: [
      {
        title: "2026 R13 race results",
        href: "/api/f1/v1/f1/races/2026/13/results?session=race",
      },
    ],
  });
});

test("reports every driver tied for the largest position gain", () => {
  const answer = buildStarterAnswer("Who gained the most from grid to finish?", {
    season: 2026,
    round: 13,
    selectedRows: [],
    results: [
      { first_name: "Lando", last_name: "Norris", grid: 8, position: 5 },
      { first_name: "Alex", last_name: "Albon", grid: 10, position: 7 },
      { first_name: "Max", last_name: "Verstappen", grid: 2, position: 1 },
    ],
    practiceCount: 0,
    qualifyingCount: 0,
    qualifyingPredictionCount: 0,
    racePredictionCount: 0,
  });

  assert.equal(
    answer?.answer,
    "Lando Norris and Alex Albon tied for the most positions gained in 2026 R13: 3 places each. Lando Norris moved from P8 to P5; Alex Albon moved from P10 to P7.",
  );
});

test("reports when no classified driver made a positive position gain", () => {
  const answer = buildStarterAnswer("Who gained the most from grid to finish?", {
    season: 2026,
    round: 13,
    selectedRows: [],
    results: [
      { first_name: "Max", last_name: "Verstappen", grid: 1, position: 1 },
      { first_name: "Lando", last_name: "Norris", grid: 2, position: 4 },
    ],
    practiceCount: 0,
    qualifyingCount: 0,
    qualifyingPredictionCount: 0,
    racePredictionCount: 0,
  });

  assert.equal(
    answer?.answer,
    "No driver gained a position in 2026 R13 among classified race results with a grid position.",
  );
});

test("uses singular grammar for a one-place gain", () => {
  const answer = buildStarterAnswer("Who gained the most from grid to finish?", {
    season: 2026,
    round: 13,
    selectedRows: [],
    results: [
      { first_name: "Oscar", last_name: "Piastri", grid: 4, position: 3 },
      { first_name: "Max", last_name: "Verstappen", grid: 1, position: 1 },
    ],
    practiceCount: 0,
    qualifyingCount: 0,
    qualifyingPredictionCount: 0,
    racePredictionCount: 0,
  });

  assert.equal(
    answer?.answer,
    "Oscar Piastri gained the most positions in 2026 R13: 1 place, from P4 to P3.",
  );
});

test("builds a real head-to-head from selected live rows without inventing unavailable values", () => {
  const comparison = buildDriverHeadToHead([
    {
      id: 1,
      code: "ANT",
      name: "Kimi Antonelli",
      team: "Mercedes",
      seasonPosition: 1,
      seasonPoints: 219,
      wins: 4,
      racePosition: 2,
      grid: 3,
      laps: 70,
      status: "Finished",
      winProbability: 0.31,
    },
    {
      id: 2,
      code: "HAM",
      name: "Lewis Hamilton",
      team: "Ferrari",
      seasonPosition: 2,
      seasonPoints: 169,
      wins: 2,
      racePosition: null,
      grid: null,
      laps: null,
      status: null,
      winProbability: null,
    },
  ]);

  assert.equal(comparison.length, 2);
  assert.deepEqual(comparison[0].metrics, {
    championship: "P1",
    points: "219",
    wins: "4",
    grid: "P3",
    finish: "P2",
    winChance: "31.0%",
  });
  assert.deepEqual(comparison[1].metrics, {
    championship: "P2",
    points: "169",
    wins: "2",
    grid: "Unavailable",
    finish: "Unavailable",
    winChance: "Unavailable",
  });
});

test("requires two selected rows before rendering a head-to-head", () => {
  assert.deepEqual(buildDriverHeadToHead([]), []);
  assert.deepEqual(buildDriverHeadToHead([{ id: 1, name: "Only driver" }]), []);
});

test("rejects an empty 200 chat payload and routes internal citations through the API proxy", () => {
  assert.throws(
    () => normalizeChatPayload({ data: { answer: "   ", sources: [] } }),
    /empty answer/,
  );
  assert.deepEqual(
    normalizeChatPayload({
      data: {
        answer: "Antonelli leads with 219 points.",
        sources: [{ title: "Driver standings 2026", href: "/v1/f1/standings/drivers/2026" }],
      },
    }),
    {
      answer: "Antonelli leads with 219 points.",
      sources: [{ title: "Driver standings 2026", href: "/v1/f1/standings/drivers/2026" }],
    },
  );
  assert.equal(apiSourceHref("/v1/f1/standings/drivers/2026"), "https://thedatadriver.app/season");
  assert.equal(apiSourceHref("/v1/f1/standings/constructors/2026"), "https://thedatadriver.app/season");
  assert.equal(apiSourceHref("/v1/f1/calendar/2026"), "https://thedatadriver.app/season");
  assert.equal(apiSourceHref("/v1/f1/calendar/next"), "https://thedatadriver.app/season");
  assert.equal(apiSourceHref("/v1/f1/races/2026/13/results"), "https://thedatadriver.app/season");
  assert.equal(apiSourceHref("/v1/f1/predictions/race/2026/14"), "https://thedatadriver.app/grid");
  assert.equal(apiSourceHref("/v1/f1/predictions/qualifying/2026/14"), "/");
  assert.equal(apiSourceHref("/v1/f1/races/2026/13/qualifying"), "/");
  assert.equal(apiSourceHref("/v1/f1/races/2026/13/practice"), "/");
  assert.equal(apiSourceHref("/v1/f1/model/info"), "https://thedatadriver.app/methodology");
  assert.equal(apiSourceHref("/v1/f1/articles/analysis-20260504-historical-patterns"), "https://thedatadriver.app/articles/analysis-20260504-historical-patterns");
  // Proxy-prefixed form normalizes to the same rendered route.
  assert.equal(apiSourceHref("/api/f1/v1/f1/predictions/qualifying/2026/14"), "/");
  assert.equal(apiSourceHref("/articles/verified-analysis"), "https://thedatadriver.app/articles/verified-analysis");
  assert.equal(apiSourceHref("https://example.test/source"), "https://example.test/source");
  assert.equal(apiSourceHref("javascript:alert(1)"), null);
  assert.equal(apiSourceHref("data:text/html,unsafe"), null);
  assert.equal(apiSourceHref("//evil.test/source"), null);
  assert.equal(apiSourceHref("/\\\\evil.test/source"), null);
});

test("renders the selected-driver head-to-head immediately after the field overview", () => {
  assert.match(
    labPageSource,
    /const selectedComparisonRows = useMemo\(\s*\(\) => buildRows\(standings, results, predictions\)\.filter\(\(row\) => selectedDrivers\.includes\(row\.id\)\),\s*\[predictions, results, selectedDrivers, standings\],\s*\);/,
  );
  assert.match(labPageSource, /const driverHeadToHead = useMemo\(\s*\(\) => buildDriverHeadToHead\(selectedComparisonRows\),/);
  const comparisonIndex = labPageSource.indexOf('aria-label="Driver head-to-head"');
  const sessionIndex = labPageSource.indexOf('aria-label="Session explorer"');
  const seasonHistoryIndex = labPageSource.indexOf('aria-label="Season comparison"');
  const dataExplorerIndex = labPageSource.indexOf('aria-label="Data explorer"');
  assert.ok(comparisonIndex > 0, "head-to-head section is missing");
  assert.ok(comparisonIndex < sessionIndex, "head-to-head must follow the field before session detail");
  assert.ok(sessionIndex < seasonHistoryIndex, "session evidence must precede historical comparison");
  assert.ok(seasonHistoryIndex < dataExplorerIndex, "raw rows must remain the final drill-down");
  assert.match(labPageSource, /Championship/);
  assert.match(labPageSource, /Win chance/);
  assert.match(labPageSource, /text-amber-400/);
  assert.doesNotMatch(labPageSource, /(?:text|border|bg)-ambre/);
  assert.match(labPageSource, /Unavailable/);
});

test("renders server-known API failures in a persistent accessible system-status region", () => {
  assert.match(labPageSource, /<section\s+aria-label="System status"/);
  assert.match(labPageSource, /seasonError \|\| raceError \|\| sessionError/);
  assert.match(labPageSource, /role="status"/);
  assert.match(labPageSource, /Season data is unavailable from the live API/);
});

test("keeps rejected historical standings distinct from a verified empty season", () => {
  assert.match(
    labPageSource,
    /const missingSeasons = targetSeasons\.filter\(\(year\) => seasonStandings\[year\] == null\)/,
  );
  assert.match(labPageSource, /Promise\.allSettled\(missingSeasons\.map/);
  assert.match(labPageSource, /seasonLoadErrors/);
  assert.match(labPageSource, /entry\.status !== "fulfilled"/);
  assert.match(labPageSource, /unavailable: seasonLoadErrors\[year\] === true/);
  assert.match(labPageSource, /unavailable \? "UNAVAILABLE" : standing\?\.position \?\? "NOT IN SEASON"/);
  const historicalLoadSource = labPageSource.slice(
    labPageSource.indexOf("Promise.allSettled(missingSeasons.map"),
    labPageSource.indexOf("}, [initialSeason, season, seasonStandings, seasonTimestamps])"),
  );
  assert.doesNotMatch(historicalLoadSource, /entry\.status === "fulfilled"[\s\S]*?: \[\]/);
});

test("uses a composite key for duplicate-titled source citations", () => {
  assert.match(
    labPageSource,
    /answer\.sources\.map\(\(source, index\) => <SourceCitation key={`\$\{source\.href \?\? "text"\}:\$\{source\.title\}:\$\{index\}`} source=\{source\} \/>\)/,
  );
});

test("compares only the selected drivers from the current season", () => {
  const answer = buildStarterAnswer("Compare the selected drivers this season.", {
    season: 2026,
    round: 13,
    selectedRows: [
      { name: "Kimi Antonelli", seasonPosition: 1, seasonPoints: 219, wins: 4 },
      { name: "Lewis Hamilton", seasonPosition: 2, seasonPoints: 169, wins: 2 },
    ],
    results: [],
    practiceCount: 0,
    qualifyingCount: 0,
    qualifyingPredictionCount: 0,
    racePredictionCount: 0,
  });

  assert.deepEqual(answer, {
    answer: "In the 2026 standings, Kimi Antonelli is P1 with 219 points and 4 wins; Lewis Hamilton is P2 with 169 points and 2 wins.",
    sources: [
      {
        title: "2026 driver standings",
        href: "/api/f1/v1/f1/standings/drivers/2026",
      },
    ],
  });
});

test("keeps selected standings drivers available through a circuit-only lens", () => {
  assert.match(
    labPageSource,
    /const selectedStandingRows = useMemo\(\s*\(\) => buildRows\(standings, \[\], null\)\.filter\(\(row\) => selectedDrivers\.includes\(row\.id\)\),\s*\[selectedDrivers, standings\],\s*\);/,
  );

  const askQuestionSource = labPageSource.slice(
    labPageSource.indexOf("async function askQuestion"),
    labPageSource.indexOf("function handleStarterQuestion"),
  );
  assert.match(askQuestionSource, /selectedRows:\s*selectedStandingRows/);
  assert.doesNotMatch(askQuestionSource, /selectedRows:\s*rows/);
});

test("renders nullable standings values as unavailable", () => {
  const answer = buildStarterAnswer("Compare the selected drivers this season.", {
    season: 2026,
    round: 13,
    selectedRows: [
      { name: "Reserve Driver", seasonPosition: null, seasonPoints: null, wins: null },
    ],
    results: [],
    practiceCount: 0,
    qualifyingCount: 0,
    qualifyingPredictionCount: 0,
    racePredictionCount: 0,
  });

  assert.equal(
    answer?.answer,
    "In the 2026 standings, Reserve Driver is unavailable in the championship order with unavailable points and unavailable wins.",
  );
  assert.doesNotMatch(answer?.answer ?? "", /Pnull|null/);
});

test("reports missing and published payloads for the selected race", () => {
  const answer = buildStarterAnswer("Which data is missing for this race?", {
    season: 2026,
    round: 13,
    selectedRows: [],
    results: [{ first_name: "Max", last_name: "Verstappen", grid: 3, position: 1 }],
    practiceCount: 0,
    qualifyingCount: 0,
    qualifyingPredictionCount: 22,
    racePredictionCount: 22,
  });

  assert.deepEqual(answer, {
    answer: "For 2026 R13, practice data and qualifying results are unavailable. Race results, race forecast and qualifying forecast are published.",
    sources: [
      { title: "Race results", href: "/api/f1/v1/f1/races/2026/13/results?session=race" },
      { title: "Practice data", href: "/api/f1/v1/f1/races/2026/13/practice" },
      { title: "Qualifying results", href: "/api/f1/v1/f1/races/2026/13/qualifying" },
      { title: "Race forecast", href: "/api/f1/v1/f1/predictions/race/2026/13" },
      { title: "Qualifying forecast", href: "/api/f1/v1/f1/predictions/qualifying/2026/13" },
    ],
  });
});

test("keeps the selected-driver starter local when no driver is selected", () => {
  const answer = buildStarterAnswer("Compare the selected drivers this season.", {
    season: 2026,
    round: 13,
    selectedRows: [],
    results: [],
    practiceCount: 0,
    qualifyingCount: 0,
    qualifyingPredictionCount: 0,
    racePredictionCount: 0,
  });

  assert.deepEqual(answer, {
    answer: "Select at least one driver in the field before running this comparison.",
    sources: [],
  });
});

test("keeps the position-gain starter grounded when classifications are unavailable", () => {
  const answer = buildStarterAnswer("Who gained the most from grid to finish?", {
    season: 2025,
    round: 4,
    selectedRows: [],
    results: [],
    practiceCount: 0,
    qualifyingCount: 0,
    qualifyingPredictionCount: 0,
    racePredictionCount: 0,
  });

  assert.deepEqual(answer, {
    answer: "Position gain is unavailable for 2025 R4 because the live API returned no classified race result with a grid position.",
    sources: [
      {
        title: "2025 R4 race results",
        href: "/api/f1/v1/f1/races/2025/4/results?session=race",
      },
    ],
  });
});

test("asks for a race selection before answering race-scoped starters", () => {
  const answer = buildStarterAnswer("Which data is missing for this race?", {
    season: 2026,
    round: null,
    selectedRows: [],
    results: [],
    practiceCount: 0,
    qualifyingCount: 0,
    qualifyingPredictionCount: 0,
    racePredictionCount: 0,
  });

  assert.deepEqual(answer, {
    answer: "Select a race before checking its data coverage.",
    sources: [],
  });
});

test("uses the payload label grammar when one plural payload is missing", () => {
  const answer = buildStarterAnswer("Which data is missing for this race?", {
    season: 2026,
    round: 13,
    selectedRows: [],
    results: [{ first_name: "Max", last_name: "Verstappen", grid: 3, position: 1 }],
    practiceCount: 4,
    qualifyingCount: 0,
    qualifyingPredictionCount: 22,
    racePredictionCount: 22,
  });

  assert.equal(
    answer?.answer,
    "For 2026 R13, qualifying results are unavailable. Race results, practice data, race forecast and qualifying forecast are published.",
  );
});

test("derives practice coverage from the per-session best-lap classifications", () => {
  // The raw /practice list is paginated, so coverage counts the rows of the
  // API's best-lap classifications, never a page of raw laps.
  assert.match(labPageSource, /const practiceRows = practiceBest\?\.rows \?\? \[\];/);
  assert.match(labPageSource, /practiceCount:\s*practiceRows\.length/);
  assert.doesNotMatch(labPageSource, /practiceCount:\s*practiceSummary\.length/);
});

test("Lab preserves and renders OpenF1 attribution metadata", () => {
  assert.match(labClientSource, /meta:\s*payload\?\.meta\s*\?\?\s*null/);
  assert.match(labPageSource, /import \{[^}]*\bfetchLab\b[^}]*\} from "@\/lib\/lab-client"/);
  assert.match(labPageSource, /setSessionSourceMeta\(practiceWithMeta\?\.meta \?\? null\)/);
  assert.match(labPageSource, /sessionSourceMeta\.license_url/);
  assert.match(labPageSource, /sessionSourceMeta\.adaptation_notice/);
  assert.doesNotMatch(labPageSource, />Live API ·/);
});

test("guards starter answers while relevant data is loading or errored", () => {
  const askQuestionSource = labPageSource.slice(
    labPageSource.indexOf("async function askQuestion"),
    labPageSource.indexOf("function handleStarterQuestion"),
  );
  const guard = /if \(isStarterQuestion && \(isLoadingSeason \|\| isLoadingRace \|\| isLoadingSession \|\| seasonError \|\| raceError \|\| sessionError\)\) \{\s*answerKindRef\.current = null;\s*setAnswer\(null\);\s*return;\s*\}/;
  assert.match(askQuestionSource, /const isStarterQuestion = starterQuestions\.includes\(text\);/);
  assert.match(askQuestionSource, guard);
  assert.ok(askQuestionSource.search(guard) < askQuestionSource.indexOf("buildStarterAnswer"));
});

test("tracks season and session fetch failures and withholds local starter answers", () => {
  assert.match(labPageSource, /const \[seasonError, setSeasonError\] = useState<string \| null>\([^;]+\);/);
  assert.match(labPageSource, /const \[sessionError, setSessionError\] = useState<string \| null>\(null\);/);

  const seasonRequestSource = effectContaining("fetchLab<APICalendarRace[]>(`/v1/f1/calendar/${season}`)");
  assert.match(seasonRequestSource, /setSeasonError\(null\);[\s\S]*\.then\([\s\S]*setSeasonError\(null\);[\s\S]*\.catch\([\s\S]*setSeasonError\("Season data is unavailable from the live API\."\);/);

  const sessionRequestSource = effectContaining(SESSION_EFFECT_MARKER);
  assert.match(sessionRequestSource, /setSessionError\(null\);[\s\S]*\.then\([\s\S]*setSessionError\(null\);[\s\S]*\.catch\([\s\S]*setSessionError\("Session data is unavailable from the API\."\);/);

  const askQuestionSource = labPageSource.slice(
    labPageSource.indexOf("async function askQuestion"),
    labPageSource.indexOf("function handleStarterQuestion"),
  );
  assert.match(askQuestionSource, /isLoadingSeason \|\| isLoadingRace \|\| isLoadingSession \|\| seasonError \|\| raceError \|\| sessionError/);
});

test("returns local starter answers before the chat request", () => {
  const askQuestionSource = labPageSource.slice(
    labPageSource.indexOf("async function askQuestion"),
    labPageSource.indexOf("function handleStarterQuestion"),
  );
  const helperIndex = askQuestionSource.indexOf("buildStarterAnswer");
  const localReturnIndex = askQuestionSource.search(/if \(localAnswer\) \{\s*answerKindRef\.current = "starter";\s*setAnswer\(localAnswer\);\s*return;/);
  const chatIndex = askQuestionSource.indexOf("/v1/f1/chat");
  assert.ok(helperIndex >= 0 && localReturnIndex > helperIndex && chatIndex > localReturnIndex);
});

test("invalidates chat requests on semantic context changes and only clears starter answers for payload transitions", () => {
  assert.match(
    labPageSource,
    /const invalidateSemanticContext = useCallback\([\s\S]*chatRequestGateRef\.current\.invalidate\(\);[\s\S]*setIsAsking\(false\);[\s\S]*\}, \[\]\);/,
  );
  assert.match(
    labPageSource,
    /const clearStarterAnswer = useCallback\([\s\S]*if \(answerKindRef\.current !== "starter"\) return;[\s\S]*setAnswer\(null\);[\s\S]*\}, \[\]\);/,
  );
  assert.doesNotMatch(labPageSource, /\}, \[season, round, selectedDrivers\]\);/);
});

test("clears answers synchronously in semantic and request transition callbacks", () => {
  assert.match(
    labPageSource,
    /const clearStarterAnswer = useCallback\(\(\) => \{\s*if \(answerKindRef\.current !== "starter"\) return;\s*answerKindRef\.current = null;\s*setAnswer\(null\);\s*\}, \[\]\);/,
  );
  assert.match(
    labPageSource,
    /const invalidateSemanticContext = useCallback\(\(\) => \{\s*chatRequestGateRef\.current\.invalidate\(\);\s*answerKindRef\.current = null;\s*setAnswer\(null\);\s*setIsAsking\(false\);\s*\}, \[\]\);/,
  );
  for (const [callback, setter] of [
    ["changeSeason", "setSeason"],
    ["changeRound", "setRound"],
    ["changeSelectedDrivers", "setSelectedDrivers"],
  ]) {
    const transitionSource = labPageSource.slice(
      labPageSource.indexOf(`const ${callback} = useCallback`),
      labPageSource.indexOf("}, [invalidateSemanticContext]);", labPageSource.indexOf(`const ${callback} = useCallback`)),
    );
    assert.ok(transitionSource.indexOf("invalidateSemanticContext();") < transitionSource.indexOf(`${setter}(`));
  }

  for (const loadingSetter of ["setIsLoadingSeason", "setIsLoadingRace", "setIsLoadingSession"]) {
    assert.match(labPageSource, new RegExp(`clearStarterAnswer\\(\\);\\s*${loadingSetter}\\(true\\);`));
  }
  for (const payloadSetter of ["setStandings", "setResults", "setPracticeBest"]) {
    assert.match(labPageSource, new RegExp(`\\.then\\([\\s\\S]*?clearStarterAnswer\\(\\);[\\s\\S]*?${payloadSetter}\\(`));
  }
  for (const errorSetter of ["setSeasonError", "setRaceError", "setSessionError"]) {
    assert.match(labPageSource, new RegExp(`\\.catch\\([\\s\\S]*?clearStarterAnswer\\(\\);[\\s\\S]*?${errorSetter}\\(`));
  }

  const sessionRequestSource = effectContaining(SESSION_EFFECT_MARKER);
  assert.doesNotMatch(sessionRequestSource, /invalidateSemanticContext|chatRequestGateRef/);
});

test("invalidates an in-flight chat response after the Lab context changes", async () => {
  const gate = createLatestRequestGate();
  let commitResponse;
  const response = new Promise((resolve) => {
    commitResponse = resolve;
  });
  const requestId = gate.begin();
  let committed = null;
  const pending = response.then((value) => {
    if (gate.isCurrent(requestId)) committed = value;
  });

  gate.invalidate();
  commitResponse("stale answer");
  await pending;

  assert.equal(committed, null);
});

test("keeps the current chat request valid across unrelated loading transitions", async () => {
  const gate = createLatestRequestGate();
  const requestId = gate.begin();

  await Promise.resolve();

  assert.equal(gate.isCurrent(requestId), true);
});

test("marks season and round payloads stale synchronously before changing context", () => {
  const seasonTransition = labPageSource.slice(
    labPageSource.indexOf("const changeSeason = useCallback"),
    labPageSource.indexOf("const changeRound = useCallback"),
  );
  const seasonCommit = seasonTransition.indexOf("setSeason(nextSeason)");
  for (const statement of [
    "setIsLoadingSeason(true)",
    "setIsLoadingRace(true)",
    "setIsLoadingSession(true)",
    "setCalendar([])",
    "setStandings([])",
    "setResults([])",
    "setPracticeBest(null)",
  ]) {
    assert.ok(seasonTransition.indexOf(statement) >= 0, `${statement} is missing from changeSeason`);
    assert.ok(seasonTransition.indexOf(statement) < seasonCommit, `${statement} must precede setSeason`);
  }

  const roundTransition = labPageSource.slice(
    labPageSource.indexOf("const changeRound = useCallback"),
    labPageSource.indexOf("const changeSelectedDrivers = useCallback"),
  );
  const roundCommit = roundTransition.indexOf("setRound(nextRound)");
  for (const statement of [
    "setIsLoadingRace(nextRound != null)",
    "setIsLoadingSession(nextRound != null)",
    "setResults([])",
    "setPredictions(null)",
    "setPracticeBest(null)",
    "setQualifying(null)",
    "setQualifyingPrediction(null)",
  ]) {
    assert.ok(roundTransition.indexOf(statement) >= 0, `${statement} is missing from changeRound`);
    assert.ok(roundTransition.indexOf(statement) < roundCommit, `${statement} must precede setRound`);
  }
});

test("starts selected-round session hydration as unknown without invalidating arbitrary chat", () => {
  assert.match(
    labPageSource,
    /const \[isLoadingSession, setIsLoadingSession\] = useState\(defaultRound != null\);/,
  );
  const sessionRequestSource = effectContaining(SESSION_EFFECT_MARKER);
  assert.doesNotMatch(sessionRequestSource, /invalidateSemanticContext|chatRequestGateRef/);
});

test("restores initial-season data and clears loading when an archive request is cancelled", () => {
  const seasonRequestSource = labPageSource.slice(
    labPageSource.indexOf("useEffect(() => {", labPageSource.indexOf("const selectedStandingRows")),
    labPageSource.indexOf("useEffect(() => {", labPageSource.indexOf("if (season === initialSeason)" ) + 1),
  );
  assert.match(
    seasonRequestSource,
    /if \(season === initialSeason\) \{[\s\S]*setCalendar\(initialCalendar\);[\s\S]*setStandings\(initialStandings\);[\s\S]*setIsLoadingSeason\(false\);[\s\S]*return;/,
  );
  assert.match(seasonRequestSource, /setIsLoadingRace\(defaultRound != null\);/);
  assert.match(seasonRequestSource, /setIsLoadingSession\(defaultRound != null\);/);
  assert.match(
    seasonRequestSource,
    /if \(nextRound == null\) \{\s*setIsLoadingRace\(false\);\s*setIsLoadingSession\(false\);\s*\} else \{\s*changeRound\(nextRound\);\s*\}/,
  );
  assert.match(seasonRequestSource, /roundRef\.current = [^;]+;[\s\S]*setRound\(roundRef\.current\);/);
  assert.match(seasonRequestSource, /return \(\) => \{\s*cancelled = true;\s*\};/);
});

test("propagates required server fetch failures into fail-closed starter guards", () => {
  assert.match(labServerSource, /initialSeasonError=\{calendar == null \|\| standings == null\}/);
  assert.match(
    labServerSource,
    /initialRaceError=\{initialRound != null && resultPayload == null\}/,
  );
  assert.match(labPageSource, /initialSeasonError: boolean;/);
  assert.match(labPageSource, /initialRaceError: boolean;/);
  assert.match(
    labPageSource,
    /const \[seasonError, setSeasonError\] = useState<string \| null>\(initialSeasonError \? "Season data is unavailable from the live API\." : null\);/,
  );
  assert.match(
    labPageSource,
    /const \[raceError, setRaceError\] = useState<string \| null>\(initialRaceError \? "Race data is unavailable from the live API\." : null\);/,
  );
  assert.match(labServerSource, /initialPredictions=\{predictionPayload\?\.data \?\? null\}/);
});

test("hydrates a URL season before validating its round and circuit", () => {
  const hydrationSource = labPageSource.slice(
    labPageSource.indexOf("useEffect(() => {", labPageSource.indexOf("const selectedStandingRows")),
    labPageSource.indexOf("useEffect(() => {", labPageSource.indexOf("setUrlStateReady(true)") + 1),
  );
  const seasonChange = hydrationSource.indexOf("changeSeason(urlSeason)");
  const waitForSeason = hydrationSource.indexOf("if (isLoadingSeason || calendarSeason !== seasonRef.current) return;");
  const roundValidation = hydrationSource.indexOf("calendar.some((race) => race.round === urlRound)");
  const circuitLookup = hydrationSource.indexOf("raceForCircuit.get(Number(urlCircuit))");
  const ready = hydrationSource.indexOf("setUrlStateReady(true)");
  assert.ok(seasonChange >= 0 && waitForSeason > seasonChange);
  assert.ok(roundValidation > waitForSeason && circuitLookup > waitForSeason);
  assert.ok(ready > roundValidation && ready > circuitLookup);
  assert.match(
    hydrationSource,
    /if \(AVAILABLE_SEASONS\.includes\(urlSeason\) && urlSeason !== seasonRef\.current\) \{\s*changeSeason\(urlSeason\);\s*return;\s*\}/,
  );
  assert.match(hydrationSource, /if \(circuitRace\) changeRound\(circuitRace\.round\);/);
});

test("does not treat a loading flag race as proof that the target calendar is ready", () => {
  assert.match(
    labPageSource,
    /const \[calendarSeason, setCalendarSeason\] = useState<number \| null>\(initialSeasonError \? null : initialSeason\);/,
  );
  const seasonTransition = labPageSource.slice(
    labPageSource.indexOf("const changeSeason = useCallback"),
    labPageSource.indexOf("const changeRound = useCallback"),
  );
  assert.ok(seasonTransition.indexOf("setCalendarSeason(null)") < seasonTransition.indexOf("setSeason(nextSeason)"));

  const hydrationSource = effectContaining("const params = new URLSearchParams(window.location.search)");
  assert.match(hydrationSource, /if \(isLoadingSeason \|\| calendarSeason !== seasonRef\.current\) return;/);
  const archiveEffect = effectContaining("fetchLab<APICalendarRace[]>(`/v1/f1/calendar/${season}`)");
  assert.match(archiveEffect, /setCalendarSeason\(initialSeasonError \? null : initialSeason\);/);
  assert.match(archiveEffect, /setCalendarSeason\(season\);/);
});

test("restores initial data after archive URL hydration without clobbering mount controls", () => {
  let transition = transitionInitialSeasonRestore(2026, 2026, false);
  assert.deepEqual(transition, { restore: false, hasVisitedArchive: false });

  transition = transitionInitialSeasonRestore(2024, 2026, transition.hasVisitedArchive);
  assert.deepEqual(transition, { restore: false, hasVisitedArchive: true });

  transition = transitionInitialSeasonRestore(2026, 2026, transition.hasVisitedArchive);
  assert.deepEqual(transition, { restore: true, hasVisitedArchive: false });

  assert.match(
    labPageSource,
    /transitionInitialSeasonRestore\(\s*season,\s*initialSeason,\s*hasVisitedArchiveSeasonRef\.current,?\s*\)/,
  );
  assert.match(labPageSource, /if \(!seasonTransition\.restore\) \{/);
});

test("starter answers show the official round while API links keep the internal round", () => {
  const answer = buildStarterAnswer("Which data is missing for this race?", {
    season: 2026,
    round: 17,
    roundLabel: "R15",
    selectedRows: [],
    results: [],
    practiceCount: 0,
    qualifyingCount: 0,
    qualifyingPredictionCount: 0,
    racePredictionCount: 22,
  });

  assert.match(answer.answer, /^For 2026 R15, /);
  assert.doesNotMatch(answer.answer, /R17/);
  assert.equal(answer.sources[0].href, "/api/f1/v1/f1/races/2026/17/results?session=race");
});
