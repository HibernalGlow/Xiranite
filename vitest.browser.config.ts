/// <reference types="vitest/config" />
import { existsSync } from "node:fs"
import path from "node:path"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vite"
import viteConfig from "./vite.config"

export default defineConfig(async (environment) => {
  const resolvedViteConfig = typeof viteConfig === "function"
    ? await viteConfig(environment)
    : await viteConfig
  const chromeExecutablePath = resolveChromeExecutablePath()
  const browserPlugins = (resolvedViteConfig.plugins ?? []).flat().filter((plugin) => plugin?.name !== "rolldown-plugin-transform-imports")

  return {
    ...resolvedViteConfig,
    plugins: browserPlugins,
    test: {
      include: ["src/**/*.browser.test.{ts,tsx}"],
      exclude: ["**/dist/**", "**/artifacts/**", "**/build/**", "**/vendor/**", "**/ref/**"],
      setupFiles: [path.resolve(__dirname, "./src/test/setup-browser.ts")],
      fileParallelism: false,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright({
          launchOptions: chromeExecutablePath ? { executablePath: chromeExecutablePath } : undefined,
        }),
        instances: [{ browser: "chromium" as const, viewport: { width: 1440, height: 900 } }],
      },
    },
  }
})

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
