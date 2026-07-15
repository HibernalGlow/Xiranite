import { readFile, writeFile } from "node:fs/promises"
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

  const configPath = join(fixture.directory, "xiranite.config.toml")
  await writeFile(configPath, [
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.panels]",
    "left_sidebar_visible = true",
    "right_sidebar_visible = true",
    "bottom_panel_visible = true",
    "auto_hide_toolbar = false",
    "[nodes.neoview.panels.sidebars.left]",
    "pinned = false",
    "open = false",
    "width = 320",
    "[nodes.neoview.panels.sidebars.right]",
    "pinned = false",
    "open = false",
    "width = 280",
    "",
  ].join("\n"), "utf8")
  backend = await startBackend({
    token: "neoview-e2e-token",
    repository: createMemoryWorkspaceRepository(),
    configPath,
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
  const leftSidebar = page.locator('[data-reader-sidebar="left"]')
  await expect(leftSidebar).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-reader-card="页面导航"]')).toBeVisible()
  const collapseResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config` && response.request().method() === "PATCH"
  ))
  await page.getByRole("button", { name: "折叠页面导航" }).click()
  expect((await collapseResponse).status()).toBe(200)
  await expect(page.getByRole("spinbutton", { name: "跳转页码" })).toHaveCount(0)
  expect(await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")).toContain("expanded = false")
  const expandResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config` && response.request().method() === "PATCH"
  ))
  await page.getByRole("button", { name: "展开页面导航" }).click()
  expect((await expandResponse).status()).toBe(200)
  await expect(page.getByRole("spinbutton", { name: "跳转页码" })).toBeVisible()
  await first.evaluate((image) => image.setAttribute("data-neoview-image-instance", "before-sidebar-resize"))
  let shellPatchRequests = 0
  page.on("request", (request) => {
    if (request.url() === `${backend.url}/reader/config` && request.method() === "PATCH") shellPatchRequests += 1
  })
  const widthHandle = page.getByRole("separator", { name: "调整左侧栏宽度" })
  const handleBox = await widthHandle.boundingBox()
  expect(handleBox).not.toBeNull()
  const patchResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config` && response.request().method() === "PATCH"
  ))
  const startX = handleBox!.x + handleBox!.width / 2
  const startY = handleBox!.y + 20
  await widthHandle.dispatchEvent("pointerdown", { pointerId: 17, clientX: startX, clientY: startY, buttons: 1 })
  for (let step = 1; step <= 40; step += 1) {
    await widthHandle.dispatchEvent("pointermove", { pointerId: 17, clientX: startX + step * 2, clientY: startY, buttons: 1 })
  }
  await widthHandle.dispatchEvent("pointerup", { pointerId: 17, clientX: startX + 80, clientY: startY, buttons: 0 })
  expect((await patchResponse).status()).toBe(200)
  expect(shellPatchRequests).toBe(1)
  expect(await leftSidebar.evaluate((element) => Number.parseFloat(getComputedStyle(element).width))).toBeGreaterThan(320)
  expect(await first.getAttribute("data-neoview-image-instance")).toBe("before-sidebar-resize")
  expect(await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")).toContain("width = ")
  const viewport = page.viewportSize()!
  await page.mouse.move(viewport.width - 1, viewport.height / 2)
  await expect(page.locator('[data-reader-sidebar="left"]')).toHaveCount(0, { timeout: 1_500 })
  await expect(page.locator('[data-reader-sidebar="right"]')).toBeVisible()
  await expect(page.locator('[data-reader-card="书籍信息"]')).toBeVisible()
  await expect(page.getByRole("region", { name: "NeoView 右侧面板" })).toHaveAttribute("data-pinned", "false")
  await page.locator('[data-reader-viewport="true"]').click({ position: { x: viewport.width / 2, y: viewport.height / 2 }, force: true })
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
