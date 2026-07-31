import { defineConfig, devices } from "@playwright/test";

import { E2E_BASE_URL, webServerEnvironment } from "./tests/e2e/helpers/test-env";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  workers: process.env.CI ? 1 : undefined,
  expect: {
    // The suite runs against `next dev`: the very first navigation to a route
    // compiles it on demand, which can exceed the 5s default under parallel
    // workers on a cold server.
    timeout: 15_000,
  },
  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: {
    command:
      "corepack pnpm --filter @athenvia/database db:generate && npm run dev -- --hostname 127.0.0.1 --port 3100",
    env: webServerEnvironment(),
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
