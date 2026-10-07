import { expect, test } from "@playwright/test";

test("Data Lab resolves nominal race data and preserves provenance", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator("[data-lab-hydrated=true]")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Work with the race data." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Loading race data" })).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText("Live data unavailable")).toHaveCount(0);

  for (const metric of ["FINISH", "GRID", "LAPS", "WIN %"]) {
    await expect(page.getByRole("tab", { name: metric })).toBeEnabled();
  }

  const coverage = page.getByText("DATA COVERAGE").locator("..");
  await expect(coverage).toContainText("Race results");
  const resultsResponse = await page.request.get("/api/f1/v1/f1/races/2026/13/results");
  expect(resultsResponse.ok()).toBeTruthy();
  const resultsPayload = await resultsResponse.json();
  const resultRows = Array.isArray(resultsPayload) ? resultsPayload : resultsPayload.data;
  await expect(coverage).toContainText(`${resultRows.length} rows`);
  await expect(coverage).toContainText("Win forecast");

  const provenance = page.getByText("PROVENANCE").locator("..");
  // Certified official round (formula1.com), never the internal key 13 used by the API path.
  await expect(provenance).toContainText("2026 / R11");
  await expect(provenance).not.toContainText("R13");
  await expect(provenance).not.toContainText("NOT SUPPLIED");

  await expect(page.getByRole("region", { name: "Data explorer" }).locator("tbody tr").first()).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("Data Lab names the race instead of printing an internal round when official_round is absent", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/?season=2025&round=13");
  await expect(page.locator("[data-lab-hydrated=true]")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Loading race data" })).toBeHidden({ timeout: 10_000 });

  const provenance = page.getByText("PROVENANCE").locator("..");
  await expect(provenance).toContainText("2025 / Previous Fixture Grand Prix");
  await expect(provenance).not.toContainText("R13");
  await expect(page.getByRole("region", { name: "Data explorer" }).locator("tbody tr").first()).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("Data Lab shows no round number when official_round is present but uncertified", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  // Fixture 2024 mirrors production on 2026-09-23: official_round is present
  // (stale R10 for internal 13) but meta.official_round_basis is absent.
  await page.goto("/?season=2024&round=13");
  await expect(page.locator("[data-lab-hydrated=true]")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Loading race data" })).toBeHidden({ timeout: 10_000 });

  const provenance = page.getByText("PROVENANCE").locator("..");
  await expect(provenance).toContainText("2024 / Previous Fixture Grand Prix");
  for (const label of ["R10", "R11", "R13"]) {
    await expect(provenance).not.toContainText(label);
  }
  const raceOptions = await page.locator("select option").allTextContents();
  expect(raceOptions.some((option) => /Previous Fixture/.test(option))).toBeTruthy();
  expect(raceOptions.filter((option) => /\bR\d{1,2}\b/.test(option))).toEqual([]);
  await expect(page.getByRole("region", { name: "Data explorer" }).locator("tbody tr").first()).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
