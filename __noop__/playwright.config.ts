import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.XIRANITE_E2E_BASE_URL ?? "http://127.0.0.1:5173"
const useExternalServer = Boolean(process.env.XIRANITE_E2E_BASE_URL)
const workers = process.env.XIRANITE_E2E_WORKERS ? Number(process.env.XIRANITE_E2E_WORKERS) : 1

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./artifacts/playwright",
  fullyParallel: false,
  workers,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "artifacts/playwright-report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: useExternalServer
    ? undefined
    : {
      command: "bun run dev:vite -- --host 127.0.0.1",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium-card",
      use: { ...devices["Desktop Chrome"], viewport: { width: 420, height: 360 } },
    },
  ],
})
