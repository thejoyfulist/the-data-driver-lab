import { expect, test, type Page } from "@playwright/test";

// Lot H2: tyre strategy coloured by compound, lap-by-lap positions, and the
// race report's strategy card and positions line, against the mock API's
// /stints and /positions (lot H contract).

const MOCK_API = `http://127.0.0.1:${process.env.TDD_PLAYWRIGHT_API_PORT ?? "4411"}`;

async function openLab(page: Page, url = "/") {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(url);
  await expect(page.locator("[data-lab-hydrated=true]")).toHaveCount(1, { timeout: 30_000 });
  return runtimeErrors;
}

/**
 * The proxy allow-list for /stints and /positions ships with the engine lot
 * (H1). Until then the same-origin proxy answers 404 for them; these tests
 * forward the browser's requests to the mock API, as the proxy will.
 */
async function forwardLotH(page: Page) {
  await page.route(/\/api\/f1\/v1\/f1\/races\/\d{4}\/\d{1,2}\/(stints|positions)$/, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/f1/, "");
    const response = await fetch(`${MOCK_API}${path}`);
    await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
  });
}

function nav(page: Page) {
  return page.getByRole("navigation", { name: "Lab views" });
}

test("strategy: stints coloured by compound, with a pattern and a letter, in finishing order", async ({ page }) => {
  const errors = await openLab(page, "/?view=strategy&season=2026&round=13");
  const view = page.locator("#lab-strategy");
  await expect(view.getByRole("heading", { level: 1 })).toHaveText("Tyre strategy");
  await expect(view.locator("[data-view-scope]")).toContainText("5 drivers · 5 pit stops · ordered by finishing position");

  // Finishing order from the official classification.
  await expect(view.locator("[data-strategy-row]")).toHaveCount(5);
  expect(await view.locator("[data-strategy-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-strategy-row")))).toEqual(["NOR", "PIA", "VER", "RUS", "HAM"]);

  // Russell: soft → medium (3 laps old) → soft (4 laps old), two official stops.
  const russell = view.locator("[data-strategy-row=RUS]");
  expect(await russell.locator("[data-stint]").evaluateAll((stints) => stints.map((stint) => stint.getAttribute("data-stint")))).toEqual(["SOFT", "MEDIUM", "SOFT"]);
  expect(await russell.locator("[data-stint-letter]").allInnerTexts()).toEqual(["S", "M(3)", "S(4)"]);
  await expect(russell.locator("[data-stop=official]")).toHaveCount(2);
  await expect(russell).toHaveAttribute("aria-label", /Medium, laps 19–40 \(22 laps\), tyres 3 laps old at the start/);

  // Colour is not the only cue: each compound has its own pattern and letter.
  const medium = view.locator("[data-strategy-row=NOR] [data-stint=MEDIUM]");
  await expect(medium).toHaveCSS("background-color", "rgb(255, 209, 46)");
  await expect(medium).toHaveAttribute("data-stint-pattern", "diagonal");
  await expect(view.locator("[data-strategy-row=NOR] [data-stint=HARD]")).toHaveAttribute("data-stint-pattern", "crosshatch");
  await expect(view.locator("[data-strategy-row=RUS] [data-stint=SOFT]").first()).toHaveAttribute("data-stint-pattern", "solid");
  const fills = await view.locator("[data-stint] svg rect").evaluateAll((rects) => Array.from(new Set(rects.map((rect) => rect.getAttribute("fill")))));
  expect(fills.every((fill) => /^url\(#.+-(SOFT|MEDIUM|HARD)\)$/.test(fill ?? ""))).toBe(true);
  for (const fill of fills) {
    const id = (fill ?? "").slice(5, -1);
    await expect(page.locator(`pattern[id="${id}"]`)).toHaveCount(1);
  }

  // Hamilton's stop is not in the pit-stop summary: a stint change, marked as such.
  await expect(view.locator("[data-strategy-row=HAM] [data-stop=derived]")).toHaveCount(1);
  const legend = view.locator("[data-tyre-legend]");
  await expect(legend).toContainText("Soft");
  await expect(legend).toContainText("Medium");
  await expect(legend).toContainText("Hard");
  await expect(legend).toContainText("Stint change not in the official pit summary");
  // The dashed change is not counted as a stop.
  await expect(view.locator("[data-strategy-row=HAM]")).toHaveAttribute("aria-label", /no official pit stop; 1 stint change after lap 30 not in the official pit summary$/);
  await expect(view).toContainText("CC BY-NC-SA 4.0");

  // Table and export carry the compound and the tyre age.
  await view.getByRole("button", { name: "table", exact: true }).click();
  await expect(view.locator("table tbody tr")).toHaveCount(11);
  await expect(view.locator("table tbody tr", { hasText: "RUS" }).nth(1)).toContainText("Medium");
  await expect(view.locator("table tbody tr", { hasText: "RUS" }).nth(1)).toContainText("3 laps");
  await view.getByRole("button", { name: "More actions for Tyre strategy" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /CSV/ }).click();
  const csv = await (await download).createReadStream().then(async (stream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  });
  expect(csv.split("\n")[0]).toContain("compound");
  expect(csv).toContain("RUS");
  expect(csv).toContain("MEDIUM");
  expect(errors).toEqual([]);
});

test("strategy: an unpublished pit summary shows unknown stops and separate stint changes in the view and export", async ({ page }) => {
  await forwardLotH(page);
  await page.route(/\/api\/f1\/v1\/f1\/races\/2024\/13\/pitstops$/, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data: [], meta: { source: "formula1.com" } }),
  }));
  await openLab(page, "/?view=strategy&season=2024&round=13");
  const view = page.locator("#lab-strategy");
  await expect(view.locator("[data-view-scope]")).toContainText("— pit stops · Official pit summary not published");
  const russell = view.locator("[data-strategy-row=RUS]");
  await expect(russell.locator("[data-stop-count]")).toHaveText("—");
  await expect(russell.locator("[data-stop-count]")).toHaveAttribute("title", "Official pit summary not published");
  await expect(russell.locator("[data-stint-change-count]")).toHaveText("3 stint changes");
  await expect(russell).toHaveAttribute("aria-label", /official pit summary not published; 3 stint changes/);
  await view.getByRole("button", { name: "More actions for Tyre strategy" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /CSV/ }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain("pit_stops");
  expect(csv).toContain("stint_changes");
  expect(csv).toContain("Official pit summary not published");
  expect(csv).not.toContain("0 stops");
});

test("positions: P1 on top, grid at lap 0, highlighted drivers, gaps kept, labels apart", async ({ page }) => {
  const errors = await openLab(page, "/?view=positions&season=2026&round=13");
  const view = page.locator("#lab-positions");
  await expect(view.getByRole("heading", { level: 1 })).toHaveText("Positions lap by lap");
  await expect(nav(page).getByRole("link", { name: "Positions", exact: true })).toHaveAttribute("aria-current", "page");
  const svg = view.locator("[data-position-chart] svg[role=img]");
  await expect(svg.locator("[data-axis-label=x]")).toHaveText("Lap");
  await expect(svg.locator("[data-axis-label=y]")).toHaveText("Position");

  // Inverted axis: P1 is drawn above P9; the first x tick is the grid.
  const tickY = async (label: string) => svg.locator("text", { hasText: new RegExp(`^${label}$`) }).first().evaluate((node) => Number(node.getAttribute("y")));
  expect(await tickY("P1")).toBeLessThan(await tickY("P9"));
  await expect(svg.locator("text", { hasText: /^Grid$/ })).toHaveCount(1);

  // Five lines in team colours, the second McLaren dashed; Verstappen's
  // missing lap 30 breaks his line (two sub-paths), it is not interpolated.
  await expect(view.locator("[data-position-line]")).toHaveCount(5);
  await expect(view.locator("[data-position-line=PIA] path")).toHaveAttribute("stroke-dasharray", "6 4");
  await expect(view.locator("[data-position-line=NOR] path")).not.toHaveAttribute("stroke-dasharray", /.+/);
  expect((await view.locator("[data-position-line=VER] path").getAttribute("d"))?.match(/M/g)?.length).toBe(2);

  // Selected drivers (NOR, PIA, VER by default) stand out; the others are dimmed.
  await expect(view.locator("[data-position-line=NOR]")).toHaveAttribute("data-highlighted", "true");
  await expect(view.locator("[data-position-line=HAM]")).toHaveAttribute("data-highlighted", "false");
  await expect(view.locator("[data-position-line=HAM] path")).toHaveAttribute("stroke-opacity", "0.22");
  const legend = view.locator("[data-position-legend]");
  await legend.getByRole("button", { name: /HAM/ }).click();
  await expect(legend.getByRole("button", { name: /HAM/ })).toHaveAttribute("aria-pressed", "true");
  await expect(view.locator("[data-position-line=HAM]")).toHaveAttribute("data-highlighted", "true");
  await legend.getByRole("button", { name: "Show all equally" }).click();
  await expect(view.locator("[data-position-line=HAM]")).not.toHaveAttribute("data-highlighted", /.+/);

  // End labels never overlap.
  const labels = view.locator("[data-end-label]");
  await expect(labels).toHaveCount(5);
  const boxes = (await labels.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()))).map((rect) => [rect.top, rect.bottom]).sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < boxes.length; index += 1) expect(boxes[index][0]).toBeGreaterThanOrEqual(boxes[index - 1][1] - 1);

  // Biggest climb from the positions: Hamilton P9 on lap 3 to P5.
  await expect(view.locator("[data-biggest-climb]")).toContainText("+4 · Lewis Hamilton, P9 on lap 3 to P5");
  await expect(view.locator("[data-climb-label]")).toHaveText("Biggest recovery in the race (from lowest running position)");
  // Neutralisations drawn on the chart too.
  await expect(view.locator("[data-position-band=SC]")).toHaveCount(1);

  // Accessible table: the grid column and a gap written out.
  await view.getByRole("button", { name: "table", exact: true }).click();
  const table = view.locator("[data-positions-table] table");
  await expect(table.locator("thead th").nth(2)).toHaveText("Grid");
  await expect(table.locator("tbody tr")).toHaveCount(5);
  const verstappen = table.locator("tbody tr", { hasText: "VER" });
  await expect(verstappen.locator("td").nth(1 + 30)).toHaveText("n/p");
  await expect(verstappen.locator("td").nth(1)).toHaveText("4");
  expect(errors).toEqual([]);
});

test("positions: the lap cursor is shared with the SC/VSC strip, both ways and by keyboard", async ({ page }) => {
  await openLab(page, "/?view=positions&season=2026&round=13");
  const view = page.locator("#lab-positions");
  const chart = view.getByRole("group", { name: /Positions by lap/ });
  const strip = view.locator("[data-positions-strip] [role=group]");
  await expect(chart).toBeVisible();

  const box = await chart.locator("svg").boundingBox();
  if (!box) throw new Error("positions chart has no box");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  const tooltip = view.locator("[data-chart-tooltip]");
  await expect(tooltip).toBeVisible();
  const lapText = (await tooltip.locator("p").first().innerText()).trim();
  expect(lapText).toMatch(/^L\d+$/);
  await expect(strip).toHaveAttribute("data-cursor-lap", lapText.slice(1));
  await expect(view.locator("[data-timeline-readout]")).toContainText(`Lap ${lapText.slice(1)}`);

  // The strip drives the chart: lap 11 is under the safety car.
  const stripBox = await strip.boundingBox();
  if (!stripBox) throw new Error("strip has no box");
  await page.mouse.move(stripBox.x + stripBox.width * (10.5 / 57), stripBox.y + 10);
  await expect(strip).toHaveAttribute("data-cursor-lap", "11");
  await expect(view.locator("[data-timeline-readout]")).toContainText("Lap 11 · SC");
  await expect(view.locator("[data-chart-cursor]")).toHaveAttribute("data-chart-cursor", "11");
  await expect(tooltip.locator("p").first()).toHaveText("L11");
  // Selected drivers (and the top three) at that lap.
  await expect(tooltip).toContainText("VER");

  // Keyboard: Home is the grid, End the last lap.
  await page.mouse.move(0, 0);
  await chart.focus();
  await page.keyboard.press("Home");
  await expect(tooltip.locator("p").first()).toHaveText("Grid");
  await expect(tooltip).toContainText("PIA");
  await page.keyboard.press("End");
  await expect(tooltip.locator("p").first()).toHaveText("L57");
  await expect(strip).toHaveAttribute("data-cursor-lap", "57");
  await page.keyboard.press("ArrowLeft");
  await expect(tooltip.locator("p").first()).toHaveText("L56");
});

test("race report: strategy at a glance and the positions line", async ({ page }) => {
  await openLab(page, "/?season=2026&round=13");
  const report = page.locator("#lab-report");
  const card = report.locator("#lab-report-strategy");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Strategy at a glance");
  await expect(card.locator("[data-view-scope]")).toContainText("top 5 finishers");
  await expect(card.locator("[data-strategy-row]")).toHaveCount(5);
  await expect(card.locator("[data-strategy-row=NOR] [data-stint-letter]").first()).toHaveText("M");
  const line = report.locator("[data-positions-line]");
  await expect(line.locator("[data-climb-value]")).toHaveText("+4");
  await expect(line.locator("[data-climb-label]")).toHaveText("Biggest recovery in the race (from lowest running position)");
  await expect(line.locator("[data-climb-detail]")).toHaveText("Lewis Hamilton, P9 on lap 3 to P5");
  // Verstappen has no position on lap 30: the maximum is restricted to the
  // drivers with every lap published, and says so.
  await expect(line.locator("[data-climb-basis]")).toHaveAttribute("data-climb-basis", "positions-partial");
  await expect(line.locator("[data-climb-basis]")).toContainText("among the 4 of 5 classified drivers with complete lap positions");
  await line.getByRole("button", { name: "Positions lap by lap →" }).click();
  await expect(page).toHaveURL(/[?&]view=positions\b/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Positions lap by lap");
});

test("partial data: official top 10 kept, stint changes outside the summary marked, climb restricted", async ({ page }) => {
  await forwardLotH(page);
  const errors = await openLab(page, "/?season=2024&round=13");
  const report = page.locator("#lab-report");
  const card = report.locator("#lab-report-strategy");
  // /stints omits Piastri (P2): the card keeps P1–P5 of the classification, never a lower finisher.
  await expect(card.locator("[data-strategy-row]")).toHaveCount(5);
  expect(await card.locator("[data-strategy-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-strategy-row")))).toEqual(["NOR", "PIA", "VER", "RUS", "HAM"]);
  await expect(card.locator("[data-strategy-row=PIA] [data-stints-missing]")).toHaveText("Stints not published");
  await expect(card.locator("[data-strategy-missing]")).toContainText("No stints published for P2 Oscar Piastri");
  await expect(card.locator("[data-partial]")).toContainText("Stints are missing for one driver.");
  // Russell: two official stops and one stint change the official summary does not list.
  await expect(card.locator("[data-strategy-row=RUS] [data-stop=official]")).toHaveCount(2);
  await expect(card.locator("[data-strategy-row=RUS] [data-stop=derived]")).toHaveCount(1);
  await expect(card.locator("[data-legend-derived]")).toHaveText("Stint change not in the official pit summary");
  // Verstappen's laps 1–3 are missing: no race-wide maximum.
  const basis = report.locator("[data-positions-line] [data-climb-basis]");
  await expect(basis).toHaveAttribute("data-climb-basis", "positions-partial");
  await expect(basis).toContainText("among the 4 of 5 classified drivers with complete lap positions (partial data: No running order on laps 1–3 for one driver.)");

  await nav(page).getByRole("link", { name: "Strategy", exact: true }).click();
  const view = page.locator("#lab-strategy");
  await expect(view.locator("[data-strategy-row=RUS]")).toHaveAttribute("aria-label", /2 official pit stops on lap 18, 40; 1 stint change after lap 50 not in the official pit summary$/);
  await expect(view.locator("[data-strategy-row=RUS]")).toContainText("2 stops");
  // Overlapping stints: the official stop still covers the boundary.
  await expect(view.locator("[data-strategy-row=VER] [data-stop=official]")).toHaveCount(1);
  await expect(view.locator("[data-strategy-row=VER] [data-stop=derived]")).toHaveCount(0);
  await expect(view.locator("[data-strategy-row=PIA]")).toHaveCount(0);

  await nav(page).getByRole("link", { name: "Positions", exact: true }).click();
  const positions = page.locator("#lab-positions");
  await expect(positions.locator("[data-partial]")).toContainText("No running order on laps 1–3 for one driver.");
  await expect(positions.locator("[data-biggest-climb]")).toContainText("+4 · Lewis Hamilton, P9 on lap 3 to P5");
  await expect(positions.locator("[data-biggest-climb] [data-climb-basis]")).toContainText("among the 4 of 5 classified drivers");
  expect(errors).toEqual([]);
});

test("not published yet: a 404 endpoint (current proxy) and an API 'unavailable' are explicit states", async ({ page }) => {
  // 1. Today's production: the proxy does not serve /stints and /positions (404).
  await openLab(page, "/?season=2026&round=13");
  await page.locator("[data-race-picker]").click();
  await page.getByRole("dialog", { name: "Choose a season and a race" }).getByRole("button", { name: /R12 · Fixture Grand Prix/ }).click();
  const report = page.locator("#lab-report");
  await expect(report.getByRole("heading", { level: 1 })).toHaveText("Fixture Grand Prix");
  await expect(report.locator("#lab-report-strategy [data-tyres-state]")).toContainText("Tyre compounds not published yet");
  await expect(report.locator("#lab-report-strategy [data-tyres-state]")).toContainText("OpenF1 has not published tyre stints for this session yet.");
  // No result for this race: the climb says so instead of a number.
  await expect(report.locator("[data-positions-line]")).toContainText("Not available");
  await nav(page).getByRole("link", { name: "Strategy", exact: true }).click();
  await expect(page.locator("#lab-strategy [data-tyres-state]")).toContainText("Tyre compounds not published yet");
  await expect(page.locator("#lab-strategy [data-strategy-row]")).toHaveCount(0);
  await nav(page).getByRole("link", { name: "Positions", exact: true }).click();
  await expect(page.locator("#lab-positions [data-positions-state]")).toContainText("Lap-by-lap positions not published yet");
  await expect(page.locator("#lab-positions [data-position-chart]")).toHaveCount(0);
});

test("not published yet: the API's reason, an outage and the grid fallback once the proxy serves lot H", async ({ page }) => {
  await forwardLotH(page);
  // 2026 R12: the API answers { availability: "unavailable", reason }.
  await openLab(page, "/?view=strategy&season=2026&round=14");
  await expect(page.locator("#lab-strategy [data-tyres-state]")).toContainText("Tyre compounds not published yet. OpenF1 has not published tyre stints for this session yet.");
  await nav(page).getByRole("link", { name: "Positions", exact: true }).click();
  await expect(page.locator("#lab-positions [data-positions-state]")).toContainText("OpenF1 has not published lap positions for this session yet.");

  // 2025 R13: /stints is not deployed (404), /positions fails (503).
  await openLab(page, "/?view=strategy&season=2025&round=13");
  await expect(page.locator("#lab-strategy [data-tyres-state]")).toContainText("Tyre compounds not published yet", { timeout: 30_000 });
  // The official pit stops are still drawn, numbered.
  await expect(page.locator("#lab-strategy")).toContainText("Meanwhile, the official pit stops");
  await nav(page).getByRole("link", { name: "Positions", exact: true }).click();
  const positions = page.locator("#lab-positions [data-positions-state]");
  await expect(positions).toContainText("Lap-by-lap positions unavailable");
  await expect(positions).toContainText("HTTP 503");
  await expect(positions).toContainText("biggest gain from the grid +2 · Lewis Hamilton, P7 to P5");
  await nav(page).getByRole("link", { name: "Race report", exact: true }).click();
  await expect(page.locator("[data-positions-line] [data-climb-basis]")).toContainText("grid to finish; lap-by-lap positions not published yet");
});

test("390 px: strategy, positions and the report card fit without horizontal scroll", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await openLab(page, "/?season=2026&round=13");
  await expect(page.locator("#lab-report-strategy [data-strategy-row]")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  for (const label of ["Strategy", "Positions"]) {
    await nav(page).getByRole("link", { name: label, exact: true }).click();
    await expect(nav(page).getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth), label).toBe(390);
  }
  const chart = await page.locator("#lab-positions [data-position-chart] svg").boundingBox();
  expect(chart?.width ?? 0).toBeLessThanOrEqual(390);
  expect(chart?.width ?? 0).toBeGreaterThan(300);
  // Highlight buttons are 44 px touch targets.
  const heights = await page.locator("#lab-positions [data-position-legend] button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(heights.every((height) => height >= 44)).toBe(true);
  await context.close();
});
