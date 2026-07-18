import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test, type Locator } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"
import { createZipFixture, type ZipFixture } from "../../../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"))
let fixture: ZipFixture
let backend: Awaited<ReturnType<typeof startBackend>>

test.setTimeout(90_000)

test.beforeAll(async () => {
  fixture = await createZipFixture({ entries: [
    { path: "pages/001.png", bytes: ONE_PIXEL_PNG, level: 0 },
    { path: "pages/002.png", bytes: ONE_PIXEL_PNG, level: 0 },
  ] })
  const configPath = join(fixture.directory, "xiranite.config.toml")
  await writeFile(configPath, [
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.panels]",
    "right_sidebar_visible = true",
    "[nodes.neoview.panels.sidebars.right]",
    "pinned = false",
    "open = false",
    "width = 280",
    "",
  ].join("\n"), "utf8")
  backend = await startBackend({
    token: "neoview-storage-information-e2e",
    repository: createMemoryWorkspaceRepository(),
    configPath,
  })
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.storage-information.e2e] renders legacy storage fields and one bounded diagnostics snapshot", async ({ page }, testInfo) => {
  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-storage-information-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  const openedResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/sessions` && response.request().method() === "POST")
  const initialViewport = page.viewportSize()!
  await page.mouse.move(initialViewport.width - 1, 1)
  await page.getByRole("button", { name: "打开书籍" }).click()
  await openedResponse
  const image = page.locator('img[alt="001.png"]')
  await expect(image).toBeVisible()
  await image.evaluate((node) => node.setAttribute("data-storage-information-image-instance", "stable"))

  let diagnosticsRequests = 0
  page.on("request", (request) => {
    if (request.url() === `${backend.url}/reader/diagnostics`) diagnosticsRequests += 1
  })
  const diagnosticsResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/diagnostics`)
  const viewport = page.viewportSize()!
  await page.mouse.move(viewport.width - 1, viewport.height / 2)
  const sidebar = page.locator('[data-reader-sidebar="right"]')
  await expect(sidebar).toBeVisible()
  const card = sidebar.locator('[data-reader-card="存储信息"]')
  await expect(card.getByText("pages/001.png")).toBeVisible()
  await expect(rowValue(card, "大小")).toHaveText(`${ONE_PIXEL_PNG.byteLength} B`)
  await expect(rowValue(card, "书籍大小")).toHaveText(/^[0-9.]+ (B|KB|MB|GB)$/)

  const response = await diagnosticsResponse
  expect(response.request().headers()["x-xiranite-token"]).toBe(backend.token)
  const diagnostics = await response.json() as StorageDiagnostics
  await expect(rowValue(card, "呈现缓存")).toHaveText(formatBytes(diagnostics.assets.presentation?.bytes))
  await expect(rowValue(card, "缩略图缓存")).toHaveText(formatBytes(diagnostics.assets.thumbnails?.cachedBytes))
  await expect(rowValue(card, "归档缓存")).toHaveText(formatBytes(diagnostics.solidArchiveCache.retainedBytes))
  await expect(rowValue(card, "磁盘缓存")).toHaveText(formatBytes(diagnostics.presentationDiskCache.enabled ? diagnostics.presentationDiskCache.bytes : undefined))
  expect(diagnosticsRequests).toBe(1)
  expect(await image.getAttribute("data-storage-information-image-instance")).toBe("stable")
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await card.screenshot({ path: testInfo.outputPath(`neoview-storage-information-${testInfo.project.name}.png`) })
})

function rowValue(card: Locator, label: string) {
  return card.locator("dt", { hasText: new RegExp(`^${label}:$`) }).locator("..").locator("dd")
}

interface StorageDiagnostics {
  assets: { presentation: { bytes: number } | null; thumbnails: { cachedBytes: number } | null }
  presentationDiskCache: { enabled: boolean; bytes?: number }
  solidArchiveCache: { retainedBytes: number }
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return "—"
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(2)} KB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(2)} MB`
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`
}
