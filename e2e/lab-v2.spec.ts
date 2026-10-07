import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

// axe-core ships with eslint-plugin-jsx-a11y; injected as a script, no new dependency.
const AXE_PATH = path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js");

const VIEWS = [
  ["field", "Field"],
  ["championship", "Championship"],
  ["constructors", "Constructors"],
  ["report", "Race report"],
  ["pace", "Race pace"],
  ["fastest", "Fastest laps"],
  ["strategy", "Strategy"],
  ["positions", "Positions"],
  ["timeline", "Race timeline"],
  ["sessions", "Sessions"],
  ["h2h", "Head-to-head"],
  ["seasons", "Across seasons"],
  ["ask", "Ask the data"],
] as const;

async function openLab(page: Page, url = "/") {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(url);
  // Server HTML is visible before React hydrates: wait for interactivity,
  // otherwise a click can land on an inert button (dev server, many workers).
  await expect(page.locator("[data-lab-hydrated=true]")).toHaveCount(1, { timeout: 30_000 });
  return runtimeErrors;
}

function nav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Lab views" });
}

async function showView(page: Page, label: string) {
  await nav(page).getByRole("link", { name: label, exact: true }).click();
  await expect(nav(page).getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
}

async function axeViolations(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return result.violations.map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
  });
}

test("one view at a time: the URL carries it, Back restores it, deep links open it", async ({ page }) => {
  const errors = await openLab(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Previous Fixture Grand Prix");
  await expect(page.locator("#lab-report")).toHaveCount(1);

  await showView(page, "Race pace");
  await expect(page).toHaveURL(/[?&]view=pace\b/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lap-by-lap pace");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(page.locator("#lab-report")).toHaveCount(0);

  await showView(page, "Strategy");
  await expect(page).toHaveURL(/[?&]view=strategy\b/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tyre strategy");

  await page.goBack();
  await expect(page).toHaveURL(/[?&]view=pace\b/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lap-by-lap pace");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Previous Fixture Grand Prix");
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lap-by-lap pace");

  // A race chosen in the picker is a history step too.
  await page.locator("[data-race-picker]").click();
  await page.getByRole("dialog", { name: "Choose a season and a race" }).getByRole("button", { name: /R12 · Fixture Grand Prix/ }).click();
  await expect(page).toHaveURL(/[?&]round=14\b/);
  await page.goBack();
  await expect(page).toHaveURL(/[?&]round=13\b/);
  await expect(page.locator("[data-race-picker]")).toContainText("R11 · Previous Fixture Grand Prix");
  expect(errors).toEqual([]);

  await openLab(page, "/?view=fastest&season=2026&round=13");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fastest lap per driver");
  await expect(page.locator("#lab-fastest")).toContainText("Norris");
  await expect(page.locator("#lab-fastest li", { hasText: "Russell" })).toContainText("1:31.130");
  await expect(page.locator("#lab-fastest li", { hasText: "Hamilton" })).toContainText("1:31.340");
  // Links shared before the workspace (#anchor) still land on their view.
  await openLab(page, "/#lab-strategy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tyre strategy");
});

test("race report: key figures computed from the API, exact against the fixture", async ({ page }) => {
  await openLab(page, "/?season=2026&round=13");
  const report = page.locator("#lab-report");
  await expect(report.getByRole("heading", { level: 1 })).toHaveText("Previous Fixture Grand Prix");
  await expect(report.locator(":scope > header [data-view-scope]")).toContainText("Round 11 · Previous Fixture Circuit, Archive City · 16 August 2026 · 57 laps");
  const figure = (id: string) => report.locator(`[data-key-figure="${id}"]`);
  await expect(figure("winner").locator("[data-figure-value]")).toHaveText("Lando Norris");
  await expect(figure("winner").locator("[data-figure-detail]")).toHaveText("McLaren · from P2 on the grid");
  await expect(figure("fastest-lap").locator("[data-figure-value]")).toHaveText("1:30.500");
  await expect(figure("fastest-lap").locator("[data-figure-detail]")).toHaveText("Norris · lap 50");
  // Same rule as "Who gained the most from grid to finish?": Hamilton P7 → P5.
  await expect(figure("biggest-gain").locator("[data-figure-value]")).toHaveText("+2");
  await expect(figure("biggest-gain").locator("[data-figure-detail]")).toHaveText("Lewis Hamilton, P7 to P5");
  await expect(figure("neutralised").locator("[data-figure-value]")).toHaveText("2");
  await expect(figure("neutralised").locator("[data-figure-detail]")).toHaveText("1 safety car · 1 VSC");

  await expect(report.locator("#lab-fastest li")).toHaveCount(5);
  // Secondary rows: times that cross a second are computed from time_ms.
  await expect(report.locator("#lab-fastest li", { hasText: "Russell" })).toContainText("1:31.130");
  await expect(report.locator("#lab-fastest li", { hasText: "Hamilton" })).toContainText("1:31.340");
  await expect(report.locator("#lab-fastest")).not.toContainText(/1:30\.\d{4}/);
  await expect(report.locator("#lab-timeline [data-retirements]")).toContainText("Fixture Driver (lap not published)");
  await expect(report.locator("#lab-report-standings")).toContainText("Championship after R11");
  await expect(report.locator("[data-provenance]")).toContainText("2026 / R11");

  const insights = page.locator("[data-insights]");
  await expect(insights).toContainText("Lando Norris won from P2 on the grid.");
  await expect(insights).toContainText("Lewis Hamilton gained the most places: P7 to P5 (+2).");

  // A race without published results: explicit states, nothing invented.
  await page.locator("[data-race-picker]").click();
  await page.getByRole("dialog", { name: "Choose a season and a race" }).getByRole("button", { name: /R12 · Fixture Grand Prix/ }).click();
  await expect(report.getByRole("heading", { level: 1 })).toHaveText("Fixture Grand Prix");
  await expect(figure("winner")).toContainText("Not available");
  await expect(figure("winner")).toContainText("No classified winner is published for this race.");
  await expect(figure("biggest-gain")).toContainText("No classified result with a grid position is published.");
  await expect(figure("fastest-lap")).toContainText("The fastest-lap endpoint did not answer (HTTP 404).");
  await expect(report.locator("#lab-report-standings")).toContainText("Championship standings today");
  await expect(page.locator("[data-insights-refusal]")).toHaveText("No classified result is published for this race, so nothing is computed.");
});

test("charts: synchronised lap cursor with values, keyboard reading, clickable legend", async ({ page }) => {
  await openLab(page, "/?view=pace&season=2026&round=13");
  const pace = page.locator("#lab-pace");
  const chart = pace.getByRole("group", { name: /Lap times for/ });
  const strip = pace.locator("[data-pace-strip] [role=group]");
  await expect(chart).toBeVisible();

  // Hover: tooltip with the lap and every visible driver's value, and the
  // race-timeline strip below moves its cursor to the same lap.
  const box = await chart.locator("svg").boundingBox();
  if (!box) throw new Error("pace chart has no box");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  const tooltip = pace.locator("[data-chart-tooltip]");
  await expect(tooltip).toBeVisible();
  const lapText = (await tooltip.locator("p").first().innerText()).trim();
  expect(lapText).toMatch(/^L\d+$/);
  await expect(tooltip).toContainText("NOR");
  await expect(strip).toHaveAttribute("data-cursor-lap", lapText.slice(1));
  await expect(pace.locator("[data-timeline-readout]")).toContainText(`Lap ${lapText.slice(1)}`);

  // The strip drives the chart back.
  const stripBox = await strip.boundingBox();
  if (!stripBox) throw new Error("strip has no box");
  await page.mouse.move(stripBox.x + stripBox.width * (10.5 / 57), stripBox.y + 10);
  await expect(strip).toHaveAttribute("data-cursor-lap", "11");
  await expect(pace.locator("[data-timeline-readout]")).toContainText("Lap 11 · SC");

  // Keyboard: End jumps to the last lap, arrows step through laps.
  await page.mouse.move(0, 0);
  await chart.focus();
  await page.keyboard.press("End");
  await expect(tooltip.locator("p").first()).toHaveText("L57");
  await expect(strip).toHaveAttribute("data-cursor-lap", "57");
  await page.keyboard.press("ArrowLeft");
  await expect(tooltip.locator("p").first()).toHaveText("L56");

  // Legend: hide a line, its end label goes; teammates differ by stroke.
  await expect(pace.locator("[data-end-label]")).toHaveCount(3);
  const legend = pace.locator("[data-chart-legend]");
  await legend.getByRole("button", { name: "Max Verstappen" }).click();
  await expect(legend.getByRole("button", { name: "Max Verstappen" })).toHaveAttribute("aria-pressed", "false");
  await expect(pace.locator("[data-end-label]")).toHaveCount(2);
  await expect(pace.locator("[data-end-label]", { hasText: "VER" })).toHaveCount(0);
  await expect(pace.locator("svg path[stroke-dasharray]")).toHaveCount(1);
});

test("line charts name both axes in the SVG (race pace, championship)", async ({ page }) => {
  await openLab(page, "/?view=pace&season=2026&round=13");
  const paceChart = page.locator("#lab-pace svg[role=img]").first();
  await expect(paceChart.locator("[data-axis-label=x]")).toHaveText("Lap");
  await expect(paceChart.locator("[data-axis-label=y]")).not.toHaveText("");
  await showView(page, "Championship");
  const championshipChart = page.locator("[data-line-chart] svg[role=img]").first();
  await expect(championshipChart.locator("[data-axis-label=x]")).toHaveText("Round");
  await expect(championshipChart.locator("[data-axis-label=y]")).toHaveText("Points");
  // Readable: the axis title is drawn inside the SVG at 12 px or more.
  const fontSize = await championshipChart.locator("[data-axis-label=x]").evaluate((node) => Number(node.getAttribute("font-size")));
  expect(fontSize).toBeGreaterThanOrEqual(12);
});

test("end-of-line labels never overlap", async ({ page }) => {
  await openLab(page, "/?view=pace&season=2026&round=13");
  const labels = page.locator("#lab-pace [data-end-label]");
  await expect(labels).toHaveCount(3);
  const ys = (await labels.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()))).map((rect) => [rect.top, rect.bottom]).sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < ys.length; index += 1) expect(ys[index][0]).toBeGreaterThanOrEqual(ys[index - 1][1] - 1);
});

test("the ⋯ menu exports the view and copies its request; </> API reveals the requests", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openLab(page);
  const fastest = page.locator("#lab-fastest");
  await expect(fastest.locator("[data-api-panel]")).toHaveCount(0);

  await fastest.getByRole("button", { name: "More actions for Fastest lap per driver" }).click();
  const menu = page.getByRole("menu", { name: "Fastest lap per driver actions" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Download CSV", "Download JSON", "Copy API request", "Show API requests"]);
  await expect(menu.getByRole("menuitem", { name: "Download CSV" })).toBeFocused();
  const downloadPromise = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: "Download CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("tdd-fastest-laps-2026-r11.csv");
  const csv = await readFile(await download.path(), "utf8");
  expect(csv.split("\n")[0]).toContain("driver_code");
  expect(csv.trim().split("\n")).toHaveLength(6);
  expect(csv).toContain("91130,1:31.130");
  expect(csv).not.toMatch(/1:30\.\d{4}/);

  await fastest.getByRole("button", { name: "More actions for Fastest lap per driver" }).click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://api.thedatadriver.app/v1/f1/races/2026/13/fastest-laps");

  await page.getByRole("button", { name: "</> API" }).click();
  await expect(page.getByRole("button", { name: "</> API" })).toHaveAttribute("aria-pressed", "true");
  await expect(fastest.getByLabel("API request", { exact: true })).toContainText("GET https://api.thedatadriver.app/v1/f1/races/2026/13/fastest-laps");
  await expect(page.locator("#lab-strategy, #lab-timeline").first().getByLabel("API request", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "</> API" }).click();
  await expect(page.locator("[data-api-panel]")).toHaveCount(0);

  await showView(page, "Constructors");
  await page.getByRole("button", { name: "More actions for Constructors' championship" }).click();
  await page.getByRole("menuitem", { name: "Copy API request" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://api.thedatadriver.app/v1/f1/standings/constructors/2026");
});

test("Share view copies the URL of the current view", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openLab(page);
  await showView(page, "Head-to-head");
  await page.getByRole("button", { name: "Share view" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/\/\?view=h2h&season=2026&round=13$/);
});

test("compared drivers: chips remove, + Driver adds, views follow", async ({ page }) => {
  await openLab(page, "/?view=h2h");
  const chips = page.getByRole("group", { name: "Compared drivers" });
  await expect(page.locator("#lab-head-to-head tbody tr")).toHaveCount(3);
  await chips.getByRole("button", { name: "Remove Max Verstappen from comparison" }).click();
  await expect(page.locator("#lab-head-to-head tbody tr")).toHaveCount(2);
  await expect(page).toHaveURL(/drivers=4%2C81|drivers=4,81/);
  await chips.getByRole("button", { name: "+ Driver" }).click();
  const dialog = page.getByRole("dialog", { name: "Add or remove a driver" });
  await dialog.getByRole("button", { name: /RUS/ }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(chips.getByRole("button", { name: "Remove George Russell from comparison" })).toBeVisible();
  await expect(page.locator("#lab-head-to-head tbody tr")).toHaveCount(3);
});

test("⌘K palette opens, filters and switches races and views; / opens the field search", async ({ page }) => {
  await openLab(page);
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill("r12 fixture");
  await expect(dialog.getByRole("option").first()).toContainText("R12");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-race-picker]")).toContainText("R12 · Fixture Grand Prix");

  await page.keyboard.press("ControlOrMeta+k");
  await dialog.getByRole("combobox").fill("stints");
  await expect(dialog.getByRole("option").first()).toContainText("Strategy");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Tyre strategy" })).toBeFocused();

  await page.keyboard.press("[");
  await expect(page.locator("[data-race-picker]")).toContainText("R11 · Previous Fixture Grand Prix");

  await page.keyboard.press("/");
  await expect(page).toHaveURL(/[?&]view=field\b/);
  await expect(page.getByLabel("Find a driver or team")).toBeFocused();
});

test("field view states its scope; the table mode lists the same rows", async ({ page }) => {
  await openLab(page, "/?view=field");
  const field = page.locator("#lab-field");
  await expect(field.getByRole("heading", { level: 1 })).toHaveText("Championship points, season to date");
  await expect(field.locator("[data-view-scope]")).toContainText("independent of the race selected");
  await expect(field.locator("[data-view-scope]")).toContainText("5 of 5 drivers");
  await field.getByRole("tab", { name: "Finish" }).click();
  await expect(field.getByRole("heading", { level: 1 })).toContainText("Race finish · R11");
  await field.getByLabel("Team filter").selectOption("McLaren");
  await expect(field.locator("[data-view-scope]")).toContainText("2 of 5 drivers");
  await expect(field.locator("[data-view-scope]")).toContainText("team: McLaren");
  await field.getByRole("button", { name: "Table" }).click();
  await expect(field.getByLabel("Data explorer table").locator("tbody tr")).toHaveCount(2);
});

test("empty sessions are one line with the API's reason and the source checked", async ({ page }) => {
  await openLab(page, "/?view=sessions&season=2026&round=14");
  const sessions = page.locator("#lab-sessions");
  await sessions.getByRole("tab", { name: /Practice/ }).click();
  const empty = sessions.locator("[data-empty-state]");
  await expect(empty).toContainText("Not published for this session");
  await expect(empty).toContainText("API reason: No attributed timed laps have been ingested for FP1 at this race.");
  await expect(empty).toContainText("/v1/f1/races/2026/14/practice/FP1/best");
  expect((await empty.boundingBox())?.height ?? 999).toBeLessThan(120);
  await sessions.getByRole("tab", { name: /Telemetry/ }).click();
  await expect(empty).toContainText("Not published for this session");
  await expect(empty).toContainText("API reason: Complete, source-verified race telemetry is not available for this race.");
  await expect(sessions.getByRole("tab", { name: /Practice/ })).not.toHaveText(/—/);
});

test("practice best laps come from the per-session classification, beyond the first 100 laps", async ({ page }) => {
  await openLab(page, "/?view=sessions");
  const sessions = page.locator("#lab-sessions");
  await sessions.getByRole("tab", { name: /Practice/ }).click();
  const table = sessions.getByLabel("Practice best laps");
  // Hamilton's best lap is not on the first /practice page: only /best has it.
  await expect(table).toContainText("Lewis Hamilton");
  await expect(table).toContainText("1:21.874");
  await expect(table.locator("tbody tr")).toHaveCount(3);
  const coverage = sessions.locator("[data-practice-coverage]");
  await expect(coverage).toContainText("Partial: FP3 (HTTP 503) could not be read");
  await expect(coverage).toContainText("FP2 not published");
  await expect(coverage).toContainText("No attributed timed laps have been ingested for FP2 at this race.");
});

test("telemetry reads the published speed_kph samples", async ({ page }) => {
  await openLab(page, "/?view=sessions");
  const sessions = page.locator("#lab-sessions");
  await sessions.getByRole("tab", { name: /Telemetry/ }).click();
  await expect(sessions.getByRole("img", { name: /Speed trace for Lando Norris, first 240 published samples/ })).toBeVisible({ timeout: 30_000 });
  await expect(sessions.locator("[data-empty-state]")).toHaveCount(0);
});

test("a failing timeline endpoint is reported as unavailable, not as no event", async ({ page }) => {
  await openLab(page, "/?view=timeline&season=2025&round=13");
  const timeline = page.locator("#lab-timeline");
  await expect(timeline).toContainText("Safety cars unavailable · /safety-cars did not answer (HTTP 503)", { timeout: 30_000 });
  await expect(timeline).not.toContainText("No safety car or VSC published");
  await expect(timeline.locator("[data-view-scope]")).toContainText("neutralisations unavailable");
  // The other resources answered and are still drawn.
  await expect(timeline).toContainText("Air");
});

test("first data within 300 px under the site header at 1440 px", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLab(page);
  const header = await page.locator("body > div header, header").first().boundingBox();
  const figure = await page.locator("[data-key-figure=winner] [data-figure-value]").boundingBox();
  expect(header && figure).toBeTruthy();
  expect((figure?.y ?? 999) - ((header?.y ?? 0) + (header?.height ?? 0))).toBeLessThanOrEqual(300);
  await showView(page, "Race pace");
  const chart = await page.locator("#lab-pace svg[role=img]").boundingBox();
  expect((chart?.y ?? 999) - ((header?.y ?? 0) + (header?.height ?? 0))).toBeLessThanOrEqual(300);
});

test("every view has no axe violations (WCAG 2 A/AA)", async ({ page }) => {
  test.setTimeout(240_000);
  await openLab(page);
  const failures: string[] = [];
  for (const [id, label] of VIEWS) {
    await showView(page, label);
    await expect(page.locator(`[data-view="${id}"]`)).toHaveCount(1);
    await expect(page.locator("[data-view-placeholder], [data-skeleton]")).toHaveCount(0, { timeout: 30_000 });
    failures.push(...(await axeViolations(page)).map((violation) => `${id} → ${violation}`));
  }
  // The open ⋯ menu and the API panel are part of the page too.
  await showView(page, "Race report");
  await page.getByRole("button", { name: "</> API" }).click();
  await page.getByRole("button", { name: "More actions for Race report" }).click();
  failures.push(...(await axeViolations(page)).map((violation) => `menu → ${violation}`));
  expect(failures).toEqual([]);
});

test("390 px: one selector, view pills, chart in the first screen, action bar, 44 px targets, no overflow", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await openLab(page);
  const bar = page.locator("[data-mobile-actions]");
  await expect(bar.getByRole("button", { name: "Ask the data" })).toBeVisible();
  const barTop = (await bar.boundingBox())?.y ?? 0;
  expect(barTop).toBeGreaterThan(700);
  // First chart above the fold (and above the action bar).
  const firstBar = await page.locator("#lab-fastest li").first().boundingBox();
  expect(firstBar).not.toBeNull();
  expect((firstBar?.y ?? Infinity) + (firstBar?.height ?? 0)).toBeLessThanOrEqual(barTop);

  const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-lab-bar] button, nav[aria-label='Lab views'] a, [data-mobile-actions] button, #lab-report header button, #lab-report section header button")]
    .filter((element) => element.offsetParent !== null)
    .map((element) => ({ label: element.getAttribute("aria-label") ?? element.textContent?.trim(), height: element.getBoundingClientRect().height }))
    .filter((target) => target.height < 44));
  expect(small).toEqual([]);

  for (const [id, label] of VIEWS) {
    await nav(page).getByRole("link", { name: label, exact: true }).click();
    await expect(page.locator(`[data-view="${id}"]`)).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), id).toBe(390);
  }
  await page.locator("[data-race-picker]").click();
  await expect(page.getByLabel("Season", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.keyboard.press("Escape");

  await bar.getByRole("button", { name: "Share and export" }).click();
  await expect(page.getByRole("menuitem", { name: "Show API requests and export" })).toBeVisible();
  await bar.getByRole("button", { name: "Ask the data" }).click();
  await expect(page.locator("[data-view=ask]")).toHaveCount(1);
  await context.close();
});

test("the race report is server-rendered and readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("/");
  const report = page.locator("#lab-report");
  await expect(report.getByRole("heading", { level: 1 })).toHaveText("Previous Fixture Grand Prix");
  await expect(report.locator("[data-key-figure=winner]")).toContainText("Lando Norris");
  await expect(report.locator("[data-key-figure=biggest-gain]")).toContainText("+2");
  await expect(report.locator("[data-key-figure=neutralised]")).toContainText("1 safety car · 1 VSC");
  await expect(report.locator("#lab-fastest li").first()).toBeVisible();
  await expect(report.locator("#lab-timeline")).toContainText("Air");
  // View links are real URLs; the browser-drawn progression keeps its title.
  await expect(page.getByRole("navigation", { name: "Lab views" }).getByRole("link", { name: "Race pace" })).toHaveAttribute("href", /\?view=pace/);
  await expect(page.locator("#lab-report-progression[data-view-placeholder]")).toContainText("Championship progression");
  await context.close();
});

test("server HTML for the Lab carries the report and explains browser-drawn views", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain("data-key-figures");
  expect(html).toContain("Lando Norris");
  expect(html).toContain("This view is drawn in the browser");
});
