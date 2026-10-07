import { expect, test, type Page } from "@playwright/test";

async function openRace(page: Page, url: string) {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(url);
  await expect(page.locator("[data-lab-hydrated=true]")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator("#lab-report [data-key-figure=winner] [role=status]")).toHaveCount(0, { timeout: 10_000 });
  return runtimeErrors;
}

test("Data Lab resolves nominal race data and preserves provenance", async ({ page }) => {
  const runtimeErrors = await openRace(page, "/");
  await expect(page.getByRole("heading", { level: 1, name: "Previous Fixture Grand Prix" })).toBeVisible();
  await expect(page.getByText("Live data unavailable")).toHaveCount(0);

  const provenance = page.locator("[data-provenance]");
  const resultsResponse = await page.request.get("/api/f1/v1/f1/races/2026/13/results");
  expect(resultsResponse.ok()).toBeTruthy();
  const resultsPayload = await resultsResponse.json();
  const resultRows = Array.isArray(resultsPayload) ? resultsPayload : resultsPayload.data;
  await expect(provenance).toContainText(new RegExp(`Race results\\s*${resultRows.length} rows`));
  await expect(provenance).toContainText("Win forecast");
  // Certified official round (formula1.com), never the internal key 13 used by the API path.
  await expect(provenance).toContainText("2026 / R11");
  await expect(provenance).not.toContainText("R13");

  await page.getByRole("navigation", { name: "Lab views" }).getByRole("link", { name: "Field", exact: true }).click();
  for (const metric of ["Finish", "Grid", "Laps", "Win %"]) {
    await expect(page.getByRole("tab", { name: metric })).toBeEnabled();
  }
  await page.locator("#lab-field").getByRole("button", { name: "Table" }).click();
  await expect(page.getByLabel("Data explorer table").locator("tbody tr").first()).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("Data Lab names the race instead of printing an internal round when official_round is absent", async ({ page }) => {
  const runtimeErrors = await openRace(page, "/?season=2025&round=13");
  const provenance = page.locator("[data-provenance]");
  await expect(provenance).toContainText("2025 / Previous Fixture Grand Prix");
  await expect(provenance).not.toContainText("R13");
  await expect(page.locator("#lab-report > header [data-view-scope]")).not.toContainText("Round");
  expect(runtimeErrors).toEqual([]);
});

test("Data Lab shows no round number when official_round is present but uncertified", async ({ page }) => {
  // Fixture 2024 mirrors production on 2026-09-23: official_round is present
  // (stale R10 for internal 13) but meta.official_round_basis is absent.
  const runtimeErrors = await openRace(page, "/?season=2024&round=13");
  const provenance = page.locator("[data-provenance]");
  await expect(provenance).toContainText("2024 / Previous Fixture Grand Prix");
  for (const label of ["R10", "R11", "R13"]) {
    await expect(provenance).not.toContainText(label);
  }
  await page.locator("[data-race-picker]").click();
  const raceOptions = await page.getByRole("dialog", { name: "Choose a season and a race" }).getByRole("list").getByRole("button").allTextContents();
  expect(raceOptions.some((option) => /Previous Fixture/.test(option))).toBeTruthy();
  expect(raceOptions.filter((option) => /\bR\d{1,2}\b/.test(option))).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});
