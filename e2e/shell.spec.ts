import { expect, test } from "@playwright/test";

test("legacy /lab links redirect to the Lab and keep the query", async ({ page }) => {
  await page.goto("/lab?season=2025&round=13");
  await expect(page).toHaveURL(/\/\?season=2025&round=13$/);
});

test("the shell links to the public website, the API docs and the source", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "External links" });
  await expect(nav.getByRole("link", { name: "API docs" })).toHaveAttribute("href", "https://thedatadriver.app/api-docs");
  await expect(nav.getByRole("link", { name: "Website" })).toHaveAttribute("href", "https://thedatadriver.app");
  await expect(page.getByRole("contentinfo")).toContainText("CC BY-NC-SA 4.0");
  await expect(page.getByRole("contentinfo")).toContainText("not associated in any way with the Formula 1 companies");
});

test("the proxy forwards allow-listed reads and refuses everything else", async ({ request }) => {
  const allowed = await request.get("/api/f1/v1/f1/standings/drivers/2026");
  expect(allowed.status()).toBe(200);
  expect((await allowed.json()).status).toBe("success");

  const fixture = "http://127.0.0.1:4411/__requests";
  const before = await (await request.get(fixture)).json() as Record<string, number>;
  for (const path of ["/api/f1/admin/private", "/api/f1/v1/f1/private", "/api/f1/v1/admin/users", "/api/f1/v1/f1/races/2026/13/../../../health", "/api/f1/internal"]) {
    const refused = await request.get(path);
    expect(refused.status(), path).toBe(404);
  }
  const post = await request.post("/api/f1/v1/f1/standings/drivers/2026", { data: {} });
  expect(post.status()).toBe(404);
  const after = await (await request.get(fixture)).json() as Record<string, number>;
  expect(after["/admin/private"] ?? 0).toBe(before["/admin/private"] ?? 0);
  expect(after["/v1/f1/private"] ?? 0).toBe(before["/v1/f1/private"] ?? 0);
});
