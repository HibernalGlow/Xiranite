/// <reference types="vitest/config" />
// 临时配置：仅运行 jellypot 节点包的 browser 测试（不与主 src/** 混跑）。
import { existsSync } from "node:fs"
import path from "node:path"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vite"

const chromeCandidates = [
  process.env.XIRANITE_E2E_CHROME_PATH,
  "D:\\scoop\\apps\\chrome\\current\\chrome.exe",
  path.join(process.env.USERPROFILE ?? "", "scoop", "apps", "chrome", "current", "chrome.exe"),
  path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
].filter((candidate): candidate is string => Boolean(candidate))
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate))

export default defineConfig({
  test: {
    include: ["packages/nodes/jellypot/src/**/*.browser.test.{ts,tsx}"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    fileParallelism: false,
    maxWorkers: 1,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: chromePath ? { executablePath: chromePath } : undefined,
      }),
      instances: [{ browser: "chromium" as const, viewport: { width: 1440, height: 900 } }],
    },
  },
})
