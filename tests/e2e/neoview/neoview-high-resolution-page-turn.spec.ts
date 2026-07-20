import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { expect, test } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"

const source = process.env.NEOVIEW_E2E_SOURCE
const READY_MARK = "neoview-reader-prefetch-ready"

test.skip(!source, "Set NEOVIEW_E2E_SOURCE to a high-resolution archive")
test.use({ viewport: { width: 1920, height: 1080 } })
test.setTimeout(120_000)

let backend: Awaited<ReturnType<typeof startBackend>>
let runtimeDirectory: string

test.beforeAll(async () => {
  runtimeDirectory = await mkdtemp(join(tmpdir(), "xiranite-neoview-hires-e2e-"))
  backend = await startBackend({
    token: "neoview-hires-e2e-token",
    repository: createMemoryWorkspaceRepository(),
    configPath: join(runtimeDirectory, "xiranite.config.toml"),
    legacyThumbnailDatabasePath: false,
  })
})

test.afterAll(async () => {
  await backend?.close()
  if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true })
})

test("[neoview.reader.hires-direct-page-turn] predecodes direct HTTP assets before atomic page swaps", async ({ page }, testInfo) => {
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })

  const assetRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("/reader/s/") && request.url().includes("/page/")) assetRequests.push(request.url())
  })

  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(source!)}`, { waitUntil: "domcontentloaded" })
  const openedResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/sessions` && response.request().method() === "POST"
  ))
  await page.getByRole("button", { name: /打开书籍/ }).click()
  const opened = await openedResponse
  if (!opened.ok()) throw new Error(`Opening high-resolution archive failed: ${opened.status()} ${await opened.text()}`)

  const active = page.locator("img[data-reader-page-image]").first()
  await expect(active).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => active.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const firstDimensions = await active.evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }))
  expect(firstDimensions.width * firstDimensions.height).toBeGreaterThan(4_000_000)

  const timings: Array<{ from: string; to: string; navigationResponseMs: number; imageCommitMs: number; durationMs: number }> = []
  for (let targetIndex = 1; targetIndex <= 3; targetIndex += 1) {
    await page.waitForFunction(({ mark, index }) => (
      performance.getEntriesByName(mark).some((entry) => (entry as PerformanceMark).detail === index)
    ), { mark: READY_MARK, index: targetIndex }, { timeout: 30_000 })

    const previousId = await active.getAttribute("data-reader-page-image")
    const startedAt = performance.now()
    const navigationResponse = page.waitForResponse((response) => (
      response.url().includes("/reader/s/")
      && response.url().endsWith("/navigate")
      && response.request().method() === "POST"
    ))
    await page.keyboard.press("ArrowRight")
    await navigationResponse
    const navigationResponseMs = performance.now() - startedAt
    await page.waitForFunction((from) => (
      document.querySelector("img[data-reader-page-image]")?.getAttribute("data-reader-page-image") !== from
    ), previousId)
    const imageCommitMs = performance.now() - startedAt
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>("img[data-reader-page-image]")
      return image?.complete === true && image.naturalWidth > 0
    })
    const durationMs = performance.now() - startedAt
    timings.push({ from: previousId ?? "", to: await active.getAttribute("data-reader-page-image") ?? "", navigationResponseMs, imageCommitMs, durationMs })
  }

  expect(assetRequests.length).toBeGreaterThan(0)
  for (const requestUrl of assetRequests) {
    const url = new URL(requestUrl)
    expect(url.searchParams.has("format")).toBe(false)
    expect(url.searchParams.has("width")).toBe(false)
    expect(url.searchParams.has("height")).toBe(false)
  }
  expect(await page.locator('img[data-reader-page-image-pending]').count()).toBe(0)
  console.log(`NeoView high-resolution direct page turns: ${JSON.stringify({ firstDimensions, timings })}`)
  await testInfo.attach("high-resolution-page-turn.json", {
    body: JSON.stringify({ source, firstDimensions, timings, assetRequests: [...new Set(assetRequests)] }, null, 2),
    contentType: "application/json",
  })
})
