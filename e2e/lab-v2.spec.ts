import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// axe-core ships with eslint-plugin-jsx-a11y; injected as a script, no new dependency.
const AXE_PATH = path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js");

async function openLab(page: Page, path = "/") {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: /Work with/ })).toBeVisible();
  await expect(page.locator("#lab-field li").first()).toBeVisible({ timeout: 15_000 });
  // Server HTML is visible before React hydrates: wait for interactivity,
  // otherwise a click can land on an inert button (dev server, many workers).
  await expect(page.locator("[data-lab-hydrated=true]")).toHaveCount(1, { timeout: 30_000 });
  return runtimeErrors;
}

/** Season-wide views load when they come near the viewport. */
async function revealView(page: Page, id: string) {
  await page.locator(`#${id}`).scrollIntoViewIfNeeded();
  await expect(page.locator(`#${id}[data-view-placeholder]`)).toHaveCount(0, { timeout: 30_000 });
}

test("race selection drives every race view, its scope line and its API request", async ({ page }) => {
  const errors = await openLab(page);
  const fastest = page.getByRole("region", { name: "Fastest lap per driver" });
  await expect(fastest).toContainText("R11");
  await expect(fastest).toContainText("Norris");
  await expect(fastest.getByLabel("API request", { exact: true })).toContainText("https://api.thedatadriver.app/v1/f1/races/2026/13/fastest-laps");
  await expect(page.getByRole("region", { name: "Pit stops and stints" })).toContainText("5 stops");
  await expect(page.getByRole("region", { name: "Lap-by-lap pace" }).getByRole("img").first()).toBeVisible();

  await page.getByLabel("Race", { exact: true }).selectOption("14");
  await expect(fastest.getByLabel("API request", { exact: true })).toContainText("/v1/f1/races/2026/14/fastest-laps");
  await expect(fastest).toContainText("R12");
  await expect(fastest.locator("[data-empty-state]")).toBeVisible();
  await expect(page.getByRole("region", { name: "Pit stops and stints" }).getByLabel("API request", { exact: true })).toContainText("/races/2026/14/pitstops");
  expect(errors).toEqual([]);
});

test("field view states its scope instead of a misleading title and count", async ({ page }) => {
  await openLab(page);
  const field = page.locator("#lab-field");
  await expect(field.getByRole("heading", { level: 2 })).toHaveText("Championship points, season to date");
  await expect(field.locator("[data-view-scope]")).toContainText("independent of the race selected");
  await expect(field.locator("[data-view-scope]")).toContainText("5 of 5 drivers");
  await page.getByRole("tab", { name: "FINISH" }).click();
  await expect(field.getByRole("heading", { level: 2 })).toContainText("Race finish · R11");
  await page.getByLabel("Team filter").selectOption("McLaren");
  await expect(field.locator("[data-view-scope]")).toContainText("2 of 5 drivers");
  await expect(field.locator("[data-view-scope]")).toContainText("team: McLaren");
  await expect(page.getByRole("region", { name: "Data explorer" })).toContainText("2 of 5 drivers");
});

test("CSV export downloads the rows of the view", async ({ page }) => {
  await openLab(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Fastest lap per driver as CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("tdd-fastest-laps-2026-r11.csv");
  const csv = await readFile(await download.path(), "utf8");
  expect(csv.split("\n")[0]).toContain("driver_code");
  expect(csv).toContain("NOR");
  expect(csv.trim().split("\n")).toHaveLength(6);
});

test("Copy API request puts the public URL on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openLab(page);
  await revealView(page, "lab-constructors");
  await page.getByRole("button", { name: "Copy API request for Constructors' championship" }).click();
  await expect(page.getByRole("button", { name: "Copy API request for Constructors' championship" })).toHaveText("Copied");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe("https://api.thedatadriver.app/v1/f1/standings/constructors/2026");
});

test("⌘K palette opens, filters and navigates to a race", async ({ page }) => {
  await openLab(page);
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  await page.keyboard.type("r12 fixture");
  await expect(dialog.getByRole("option").first()).toContainText("R12");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Race", { exact: true })).toHaveValue("14");

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("strategy");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Pit stops and stints" })).toBeFocused();

  await page.keyboard.press("[");
  await expect(page.getByLabel("Race", { exact: true })).toHaveValue("13");
});

test("empty sessions say they are not published, with the API's reason and the source checked", async ({ page }) => {
  await openLab(page, "/?season=2026&round=14");
  const sessions = page.getByRole("region", { name: "Session explorer" });
  await sessions.getByRole("tab", { name: /Practice/ }).click();
  const empty = sessions.locator("[data-empty-state]");
  await expect(empty).toContainText("Not published for this session");
  await expect(empty).toContainText("API reason: No attributed timed laps have been ingested for FP1 at this race.");
  await expect(empty).toContainText("/v1/f1/races/2026/14/practice/FP1/best");
  await sessions.getByRole("tab", { name: /Telemetry/ }).click();
  await expect(empty).toContainText("Not published for this session");
  await expect(empty).toContainText("API reason: Complete, source-verified race telemetry is not available for this race.");
  await expect(sessions.getByRole("tab", { name: /Practice/ })).not.toHaveText(/—/);
});

test("practice best laps come from the per-session classification, beyond the first 100 laps", async ({ page }) => {
  await openLab(page);
  const sessions = page.getByRole("region", { name: "Session explorer" });
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
  await openLab(page);
  const sessions = page.getByRole("region", { name: "Session explorer" });
  await sessions.getByRole("tab", { name: /Telemetry/ }).click();
  await expect(sessions.getByRole("img", { name: /Speed trace for Lando Norris, first 240 published samples/ })).toBeVisible({ timeout: 30_000 });
  await expect(sessions.locator("[data-empty-state]")).toHaveCount(0);
});

test("a failing timeline endpoint is reported as unavailable, not as no event", async ({ page }) => {
  await openLab(page, "/?season=2025&round=13");
  const timeline = page.getByRole("region", { name: "Safety cars, incidents and conditions" });
  await expect(timeline).toContainText("Safety cars unavailable · /safety-cars did not answer (HTTP 503)", { timeout: 30_000 });
  await expect(timeline).not.toContainText("No safety car or VSC published");
  await expect(timeline.locator("[data-view-scope]")).toContainText("neutralisations unavailable");
  // The other resources answered and are still drawn.
  await expect(timeline).toContainText("Air");
});

test("Data Lab has no axe violations (WCAG 2 A/AA)", async ({ page }) => {
  await openLab(page);
  await revealView(page, "lab-championship");
  await revealView(page, "lab-constructors");
  await expect(page.locator("[data-skeleton]")).toHaveCount(0, { timeout: 30_000 });
  await page.addScriptTag({ path: AXE_PATH });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return result.violations.map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
  });
  expect(violations).toEqual([]);
});

test("390 px: compact filters, first chart in the first screen, no horizontal overflow", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await openLab(page);
  await expect(page.getByLabel("Season", { exact: true })).toBeHidden();
  const firstBar = page.locator("#lab-field li").first();
  const box = await firstBar.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? Infinity) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByLabel("Season", { exact: true })).toBeVisible();
  await context.close();
});

test("the selected race's charts are server-rendered and readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("#lab-field li").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Fastest lap per driver" })).toContainText("Norris");
  const pace = page.getByRole("region", { name: "Lap-by-lap pace" });
  await expect(pace.getByRole("img", { name: /Lap times for/ })).toBeVisible();
  // Text alternative of the curves, in the server HTML (a collapsed
  // <details>, which opens natively without JavaScript).
  const values = pace.locator("details[data-chart-values]");
  await expect(values.locator("summary")).toContainText("Values table · 3 series");
  const table = values.locator("table");
  await expect(table.locator("caption")).toContainText("Lap times for NOR");
  await expect(table.locator("thead")).toContainText("NOR");
  const lapTwo = table.locator("tbody tr").filter({ has: page.locator("th", { hasText: /^L2$/ }) });
  await expect(lapTwo).toContainText(/1:3\d\.\d{3}/);
  await expect(table.locator("tbody")).toContainText("excluded");
  // Season-wide views load in the browser; their anchor and title stay in
  // place. (Their <noscript> note is checked in the server HTML below:
  // Chromium's script-disabled emulation does not parse <noscript> content.)
  await expect(page.locator("#lab-championship[data-view-placeholder]")).toContainText("Championship progression");
  await context.close();
});

test("server HTML for the Lab carries the pace values table and no season-wide seed", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain("data-chart-values");
  expect(html).toMatch(/<caption[^>]*>Lap times for/);
  // Browser-loaded views explain themselves to no-JS readers.
  expect(html).toContain("This view is drawn in the browser");
});
