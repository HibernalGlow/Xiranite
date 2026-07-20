import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"

let backend: Awaited<ReturnType<typeof startBackend>>
const evidenceDirectory = join(process.cwd(), "artifacts", "playwright", "system-monitor")

test.setTimeout(90_000)

test.beforeAll(async () => {
  await mkdir(evidenceDirectory, { recursive: true })
  const configPath = join(evidenceDirectory, "xiranite-system-monitor-e2e.toml")
  await writeFile(configPath, [
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.performance.monitor]",
    "enabled = true",
    "refresh_interval_ms = 500",
    "max_samples = 10",
    "",
  ].join("\n"), "utf8")
  backend = await startBackend({
    token: "neoview-system-monitor-e2e",
    repository: createMemoryWorkspaceRepository(),
    configPath,
  })
})

test.afterAll(async () => {
  await backend?.close()
})

test("[neoview.system-monitor.e2e] polls only while active and remains usable at desktop and Card viewports", async ({ page }, testInfo) => {
  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  let samples = 0
  page.on("request", (request) => {
    if (request.url() === `${backend.url}/reader/diagnostics/system`) samples += 1
  })
  await page.goto("/tests/e2e/neoview/neoview-system-monitor-harness.html", { waitUntil: "domcontentloaded" })

  const card = page.locator('[data-reader-card="系统资源监控"]')
  await expect(card.getByRole("heading", { name: "系统资源监控" })).toBeVisible()
  await expect(card.getByText("CPU 核心")).toBeVisible()
  await expect.poll(() => samples).toBeGreaterThanOrEqual(1)
  const initial = samples
  await expect.poll(() => samples).toBeGreaterThan(initial)

  await page.getByRole("button", { name: "隐藏卡片" }).click()
  const hiddenCount = samples
  await page.waitForTimeout(800)
  expect(samples).toBe(hiddenCount)
  await page.getByRole("button", { name: "显示卡片" }).click()
  await expect.poll(() => samples).toBeGreaterThan(hiddenCount)

  await card.getByRole("button", { name: "停止监控" }).click()
  await expect(card.getByRole("button", { name: "开始监控" })).toBeVisible()
  const stoppedCount = samples
  await page.waitForTimeout(800)
  expect(samples).toBe(stoppedCount)
  await card.getByRole("combobox", { name: "刷新间隔" }).selectOption("2000")
  await card.getByRole("button", { name: "开始监控" }).click()
  await expect.poll(() => samples).toBeGreaterThan(stoppedCount)

  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await card.screenshot({ path: join(evidenceDirectory, `neoview-system-monitor-${testInfo.project.name}.png`) })
})
