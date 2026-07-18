import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { expect, test } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"
import { createZipFixture, type ZipFixture } from "../../../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"))
let fixture: ZipFixture
let backend: Awaited<ReturnType<typeof startBackend>>

test.setTimeout(120_000)

test.beforeAll(async () => {
  fixture = await createZipFixture({ entries: Array.from({ length: 12 }, (_, index) => ({
    path: `pages/${String(index + 1).padStart(3, "0")}.png`,
    bytes: ONE_PIXEL_PNG,
    level: 0,
  })) })
  const databasePath = join(fixture.directory, "thumbnails.db")
  const database = new DatabaseSync(databasePath)
  database.exec(CURRENT_THUMBNAIL_SCHEMA)
  database.close()
  const configPath = join(fixture.directory, "xiranite.config.toml")
  await writeFile(configPath, [
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.panels]",
    "left_sidebar_visible = true",
    "[nodes.neoview.panels.sidebar_control]",
    "enabled = false",
    "[nodes.neoview.panels.sidebars.left]",
    "pinned = true",
    "open = true",
    "width = 320",
    "[nodes.neoview.panels.edges.top]",
    "enabled = true",
    "initial_visible = true",
    "pinned = true",
    "trigger_size = 32",
    "lock_mode = \"locked-open\"",
    "[nodes.neoview.panels.edges.left]",
    "enabled = true",
    "initial_visible = true",
    "pinned = true",
    "trigger_size = 32",
    "lock_mode = \"locked-open\"",
    "",
  ].join("\n"), "utf8")
  backend = await startBackend({
    token: "neoview-page-list-prewarm-e2e",
    repository: createMemoryWorkspaceRepository(),
    configPath,
    legacyThumbnailDatabasePath: databasePath,
  })
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.page-list.prewarm-e2e] prewarms real page thumbnails without remounting Reader media", async ({ page }, testInfo) => {
  const imageRequests: string[] = []
  page.on("request", (request) => {
    if (request.resourceType() === "image") imageRequests.push(request.url())
  })
  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-book-information-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()
  const readerImage = page.locator('img[alt="001.png"]')
  await expect(readerImage).toBeVisible()
  await readerImage.evaluate((node) => node.setAttribute("data-page-list-prewarm-image", "stable"))
  const activeAssetUrl = new URL((await readerImage.getAttribute("src"))!, page.url()).href
  const activeAssetRequests = imageRequests.filter((url) => url === activeAssetUrl).length

  const viewport = page.viewportSize()!
  await page.mouse.move(1, viewport.height / 2)
  const sidebar = page.locator('[data-reader-sidebar="left"]')
  await sidebar.getByRole("button", { name: "页面列表", exact: true }).click()
  const card = sidebar.locator('[data-reader-card="页面导航"]')
  const content = card.locator('[data-neoview-page-list="true"]')
  const prewarmStatus = card.locator("[data-page-prewarm-status]")
  await expect(content).toBeVisible()

  const prewarmResponse = page.waitForResponse((response) => {
    if (!/\/reader\/s\/[^/]+\/pages\?/.test(response.url()) || response.request().method() !== "GET") return false
    const query = new URL(response.url()).searchParams
    return query.get("cursor") === "0" && query.get("limit") === "12" && query.get("thumbnails") === null
  })
  await card.getByRole("button", { name: "预热全部缩略图" }).click()
  expect((await prewarmResponse).status()).toBe(200)
  await expect(prewarmStatus).toHaveAttribute("data-page-prewarm-status", "complete")
  await expect(card.getByRole("status")).toHaveText("全部缩略图已预加载")

  await card.getByRole("button", { name: "带图列表" }).click()
  const thumbnail = card.locator('[data-reader-thumbnail-surface="true"] img').first()
  await expect(thumbnail).toBeVisible()
  await expect.poll(() => thumbnail.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)
  expect(await readerImage.getAttribute("data-page-list-prewarm-image")).toBe("stable")
  expect(await readerImage.getAttribute("src")).toBe(activeAssetUrl)
  expect(imageRequests.filter((url) => url === activeAssetUrl)).toHaveLength(activeAssetRequests)
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await card.screenshot({ path: testInfo.outputPath(`neoview-page-list-prewarm-${testInfo.project.name}.png`) })
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
