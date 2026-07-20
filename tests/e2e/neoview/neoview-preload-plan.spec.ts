import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"
import { createZipFixture } from "../../../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
))
const READER_PREFETCH_READY_MARK = "neoview-reader-prefetch-ready"

test.use({ viewport: { width: 1920, height: 1080 } })
test.setTimeout(60_000)

test("[neoview.preload.plan-e2e] [neoview.preload.telemetry-e2e] consumes the configured backend plan and reports browser decode telemetry", async ({ page }) => {
  const fixture = await createZipFixture({
    entries: [0, 1, 2].map((index) => ({
      path: `${String(index + 1).padStart(3, "0")}.png`,
      bytes: ONE_PIXEL_PNG,
      level: index % 2 === 0 ? 0 : 6,
    })),
  })
  const configPath = join(fixture.directory, "xiranite.config.toml")
  await writeFile(configPath, [
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.performance]",
    "preload_pages = 1",
    "",
  ].join("\n"), "utf8")
  const backend = await startBackend({
    token: "neoview-preload-e2e-token",
    repository: createMemoryWorkspaceRepository(),
    configPath,
  })
  try {
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    const openedResponse = page.waitForResponse((response) => (
      response.url() === `${backend.url}/reader/sessions` && response.request().method() === "POST"
    ))
    await page.getByRole("button", { name: "打开书籍" }).evaluate((button: HTMLButtonElement) => button.click())
    const opened = await (await openedResponse).json() as {
      sessionId: string
      preload?: { generation: number; candidates: Array<{ pageIndexes: number[] }> }
    }

    expect(opened.preload?.generation).toBeGreaterThan(0)
    expect(opened.preload?.candidates.flatMap((candidate) => candidate.pageIndexes)).toEqual([1])
    await expect(page.getByRole("img", { name: "001.png" })).toBeVisible()
    await expect.poll(() => page.evaluate(({ mark, pageIndex }) => (
      performance.getEntriesByName(mark).some((entry) => (entry as PerformanceMark).detail === pageIndex)
    ), { mark: READER_PREFETCH_READY_MARK, pageIndex: 1 })).toBe(true)
    await expect.poll(async () => {
      const response = await page.request.get(`${backend.url}/reader/diagnostics?sessionId=${encodeURIComponent(opened.sessionId)}`, {
        headers: { "x-xiranite-token": backend.token },
      })
      const diagnostics = await response.json() as { reader?: { preload?: { ready?: number; performance?: { decodeSamples?: number } } } }
      return Math.min(diagnostics.reader?.preload?.ready ?? 0, diagnostics.reader?.preload?.performance?.decodeSamples ?? 0)
    }).toBeGreaterThan(0)
  } finally {
    await page.close()
    await backend.close()
    await fixture.cleanup()
  }
})
