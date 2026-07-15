import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { expect, test } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"
import { createZipFixture, deterministicBytes, type ZipFixture } from "../../../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
))
const HOT_NAVIGATION_BUDGET_MS = 150
const HOT_PAGE_TURN_BUDGET_MS = 200
const READER_PREFETCH_READY_MARK = "neoview-reader-prefetch-ready"

let fixture: ZipFixture
let backend: Awaited<ReturnType<typeof startBackend>>

test.setTimeout(90_000)

test.beforeAll(async () => {
  const sharpModule = await import("sharp")
  const sharp = (sharpModule as unknown as { default?: typeof import("sharp") }).default ?? sharpModule
  const largeJpeg = await sharp(deterministicBytes(2000 * 3000 * 3), {
    raw: { width: 2000, height: 3000, channels: 3 },
  }).jpeg({ quality: 90 }).toBuffer()
  const trailingPages = Array.from({ length: 197 }, (_, index) => ({
    path: `pages/${String(index + 4).padStart(3, "0")}.png`,
    bytes: ONE_PIXEL_PNG,
    level: 6,
  }))
  fixture = await createZipFixture({
    entries: [
      { path: "pages/001.jpg", bytes: largeJpeg, level: 6 },
      { path: "pages/002.png", bytes: ONE_PIXEL_PNG, level: 0 },
      { path: "pages/003.jpg", bytes: largeJpeg, level: 6 },
      ...trailingPages,
    ],
  })

  const thumbnailDatabasePath = join(fixture.directory, "thumbnails.db")
  const database = new DatabaseSync(thumbnailDatabasePath)
  database.exec(CURRENT_THUMBNAIL_SCHEMA)
  const insertThumbnail = database.prepare("INSERT INTO thumbs (key,category,value) VALUES (?1,'file',?2)")
  const portraitThumbnail = await sharp({
    create: { width: 40, height: 60, channels: 3, background: { r: 130, g: 85, b: 190 } },
  }).webp().toBuffer()
  const landscapeThumbnail = await sharp({
    create: { width: 60, height: 40, channels: 3, background: { r: 65, g: 150, b: 100 } },
  }).webp().toBuffer()
  insertThumbnail.run(`${fixture.path}::pages/001.jpg#0`, portraitThumbnail)
  insertThumbnail.run(`${fixture.path}::pages/002.png#1`, landscapeThumbnail)
  database.close()

  backend = await startBackend({
    token: "neoview-e2e-token",
    repository: createMemoryWorkspaceRepository(),
    configPath: join(fixture.directory, "xiranite.config.toml"),
    legacyThumbnailDatabasePath: thumbnailDatabasePath,
  })
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.react.cbz-e2e] [neoview.thumbnail.react-e2e] [neoview.shell.e2e] decodes, virtualizes thumbnails and navigates a real CBZ", async ({ page }, testInfo) => {
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })

  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  const openedResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/sessions` && response.request().method() === "POST"
  ))
  await page.getByRole("button", { name: "打开书籍" }).click()
  const opened = await (await openedResponse).json() as {
    sessionId: string
    visiblePages: Array<{ dimensions?: { width: number; height: number } }>
  }
  expect(opened.visiblePages[0]?.dimensions).toEqual({ width: 2000, height: 3000 })

  const first = page.getByRole("img", { name: "001.jpg" })
  await expect(first).toBeVisible()
  await expect.poll(() => first.getAttribute("src")).not.toContain("format=webp")
  await expect.poll(() => first.evaluate((image: HTMLImageElement) => (
    image.complete && image.naturalWidth === 2000
  ))).toBe(true)
  await expect(page.locator("canvas")).toHaveCount(0)

  const topEdge = page.getByRole("region", { name: "NeoView 顶部工具栏" })
  const bottomEdge = page.getByRole("region", { name: "NeoView 底部缩略图与导航栏" })
  await expect(topEdge).toBeVisible()
  await expect(bottomEdge).toBeVisible()
  await expect(page.locator("[data-reader-sidebar]")).toHaveCount(0)
  await page.locator('[data-reader-edge-trigger="left"]').hover()
  await expect(page.locator('[data-reader-sidebar="left"]')).toBeVisible()
  await expect(page.locator('[data-reader-card="页面导航"]')).toBeVisible()
  const viewport = page.viewportSize()!
  await page.mouse.move(viewport.width - 1, viewport.height / 2)
  await expect(page.locator('[data-reader-sidebar="left"]')).toHaveCount(0, { timeout: 1_500 })
  await expect(page.locator('[data-reader-sidebar="right"]')).toBeVisible()
  await expect(page.locator('[data-reader-card="书籍信息"]')).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-reader-sidebar]")).toHaveCount(0)
  await page.locator('[data-reader-edge-trigger="bottom"]').hover()
  await expect(bottomEdge).toBeVisible()
  await page.mouse.move(viewport.width / 2, viewport.height / 2)
  await expect(bottomEdge).toHaveCount(0, { timeout: 1_500 })
  await expect(page.getByTestId("neoview-thumbnail-viewport")).toHaveCount(0)
  await expect.poll(() => page.evaluate(({ mark, pageIndex }) => (
    performance.getEntriesByName(mark).some((entry) => (entry as PerformanceMark).detail === pageIndex)
  ), { mark: READER_PREFETCH_READY_MARK, pageIndex: 1 })).toBe(true)
  await page.locator('[data-reader-edge-trigger="bottom"]').hover()
  await expect(bottomEdge).toBeVisible()

  const thumbnailViewport = page.getByTestId("neoview-thumbnail-viewport")
  await expect(thumbnailViewport).toBeVisible()
  await expect(page.getByRole("button", { name: "转到第 1 页：001.jpg" }).locator("img")).toBeVisible()
  await expect(page.getByRole("button", { name: "转到第 2 页：002.png" }).locator("img")).toBeVisible()
  expect(await thumbnailViewport.getByRole("button").count()).toBeLessThanOrEqual(30)

  await page.getByRole("button", { name: "转到第 2 页：002.png" }).click()
  const second = page.getByRole("img", { name: "002.png" })
  await expect(second).toBeVisible()
  await expect.poll(() => second.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
  await expect(page.getByText("2 / 200")).toBeVisible()
  await expect(page.locator("canvas")).toHaveCount(0)

  await expect.poll(() => page.evaluate(({ mark, pageIndex }) => (
    performance.getEntriesByName(mark).some((entry) => (entry as PerformanceMark).detail === pageIndex)
  ), { mark: READER_PREFETCH_READY_MARK, pageIndex: 2 })).toBe(true)

  const turnStarted = performance.now()
  const navigationResponse = page.waitForResponse((response) => response.url().endsWith("/navigate"))
  await page.getByRole("button", { name: "转到第 3 页：003.jpg" }).click()
  await navigationResponse
  const navigationMs = performance.now() - turnStarted
  const third = page.getByRole("img", { name: "003.jpg" })
  await expect(third).toBeVisible()
  await third.evaluate(async (image: HTMLImageElement) => {
    if (!image.complete || image.naturalWidth === 0) await image.decode()
  })
  const decodedMs = performance.now() - turnStarted
  expect(navigationMs).toBeLessThan(HOT_NAVIGATION_BUDGET_MS)
  expect(decodedMs).toBeLessThan(HOT_PAGE_TURN_BUDGET_MS)
  console.log(`neoview hot page turn: navigation=${navigationMs.toFixed(1)}ms decoded=${decodedMs.toFixed(1)}ms`)
  await testInfo.attach("neoview-page-turn-timing", {
    body: JSON.stringify({ navigationMs, decodedMs, imageUrl: await third.getAttribute("src") }, null, 2),
    contentType: "application/json",
  })
  await page.screenshot({ path: testInfo.outputPath(`neoview-thumbnails-${testInfo.project.name}.png`) })

  await page.getByRole("button", { name: "关闭书籍" }).click()
  await expect.poll(async () => (await fetch(`${backend.url}/reader/s/${opened.sessionId}`, {
    headers: { "x-xiranite-token": backend.token },
  })).status).toBe(404)
})

const CURRENT_THUMBNAIL_SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE thumbs (key TEXT PRIMARY KEY,size INTEGER,date TEXT,ghash INTEGER,category TEXT DEFAULT 'file',value BLOB,emm_json TEXT,rating_data TEXT,ai_translation TEXT,manual_tags TEXT);
  CREATE INDEX idx_thumbs_key ON thumbs(key);
  CREATE INDEX idx_thumbs_category ON thumbs(category);
  CREATE INDEX idx_thumbs_date ON thumbs(date);
  CREATE TABLE failed_thumbnails (key TEXT PRIMARY KEY,reason TEXT NOT NULL,retry_count INTEGER DEFAULT 0,last_attempt TEXT,error_message TEXT);
  CREATE INDEX idx_failed_reason ON failed_thumbnails(reason);
  CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT);
  INSERT INTO metadata VALUES ('version','2.4');
`
