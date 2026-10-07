import { expect, test } from "@playwright/test";

test.skip(
  process.env.TDD_EXPECT_API_OUTAGE !== "1",
  "Run explicitly with TDD_EXPECT_API_OUTAGE=1 against an unavailable API.",
);

test("Data Lab exposes live API failure without crashing", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const failedApiResponse = await page.request.get("/api/f1/v1/f1/standings/drivers/2026");
  expect(failedApiResponse.status()).toBeGreaterThanOrEqual(500);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  const status = page.getByRole("status", { name: "System status" });
  await expect(status).toBeVisible();
  await expect(status).toContainText("Season data is unavailable from the live API.");
  await page.goto("/?view=h2h");
  await expect(page.locator("#lab-head-to-head")).toContainText("Select at least two drivers");
  await page.goto("/?view=field");
  await page.locator("#lab-field").getByRole("button", { name: "Table" }).click();
  await expect(page.locator("#lab-field")).toContainText("No rows match this query.");
  expect(pageErrors).toEqual([]);
});

test("Data Lab exposes server-known API failure without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const status = page.getByRole("status", { name: "System status" });
  await expect(status).toContainText("Season data is unavailable from the live API.");
  await context.close();
});
