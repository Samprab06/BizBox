import { defineConfig, devices } from "@playwright/test";

const port = 3000;
// E2E_BASE_URL points the suite at an already-running deployment (a Vercel
// preview or production). When it is set, no local server is started.
const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // HAC-33: API contract specs need no browser, so they run once.
    { name: "api", testMatch: "api/**/*.spec.ts" },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "api/**",
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: "api/**",
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testIgnore: "api/**",
    },
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command: "pnpm build && pnpm start",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
