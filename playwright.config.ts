import { existsSync } from "node:fs"
import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.XIRANITE_E2E_BASE_URL ?? "http://127.0.0.1:5173"
const useExternalServer = Boolean(process.env.XIRANITE_E2E_BASE_URL)
const workers = process.env.XIRANITE_E2E_WORKERS ? Number(process.env.XIRANITE_E2E_WORKERS) : 1
const chromeExecutablePath = resolveChromeExecutablePath()
const launchOptions = chromeExecutablePath ? { executablePath: chromeExecutablePath } : undefined

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
      use: { ...devices["Desktop Chrome"], launchOptions, viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium-card",
      use: { ...devices["Desktop Chrome"], launchOptions, viewport: { width: 420, height: 360 } },
    },
  ],
})

/**
 * Prefer an explicit override, then Scoop Chrome (machine convention), then the
 * normal Windows install locations Playwright also searches for channel=chrome.
 */
function resolveChromeExecutablePath(): string | undefined {
  const candidates = [
    process.env.XIRANITE_E2E_CHROME_PATH,
    "D:\\scoop\\apps\\chrome\\current\\chrome.exe",
    path.join(process.env.USERPROFILE ?? "", "scoop", "apps", "chrome", "current", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
  ].filter((candidate): candidate is string => Boolean(candidate))

  return candidates.find((candidate) => existsSync(candidate))
}
