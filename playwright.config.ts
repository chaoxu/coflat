import { defineConfig, devices } from "@playwright/test";

const PORT = 5180;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm vite --config vite.e2e.config.ts --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/tests/e2e/fixtures/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
