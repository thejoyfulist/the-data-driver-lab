import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? "http://127.0.0.1:3411";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalBaseURL
    ? undefined
    : [
        {
          command: "node e2e/mock-api.mjs",
          env: { TDD_PLAYWRIGHT_API_PORT: "4411" },
          url: "http://127.0.0.1:4411/v1/health",
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: "npm run dev -- --hostname 127.0.0.1 --port 3411",
          url: "http://127.0.0.1:3411",
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            TDD_API_BASE: "http://127.0.0.1:4411",
          },
        },
      ],
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
