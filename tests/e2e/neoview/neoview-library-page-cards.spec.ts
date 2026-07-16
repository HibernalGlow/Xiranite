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

test.setTimeout(90_000)

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
    token: "neoview-library-page-cards-e2e",
    repository: createMemoryWorkspaceRepository(),
    configPath,
    legacyThumbnailDatabasePath: databasePath,
  })
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.bookmark.thumbnail-e2e] [neoview.page-list.thumbnail-e2e] [neoview.image-information.image-e2e] reuses bounded thumbnail surfaces", async ({ page }, testInfo) => {
  let pageMediaInformationRequests = 0
  page.on("request", (request) => {
    if (request.url().includes("/page-media-information")) pageMediaInformationRequests += 1
  })
  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-book-information-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  const openButton = page.getByRole("button", { name: "打开书籍" })
  await expect(openButton).toBeVisible()
  await openButton.click()
  const readerImage = page.locator('img[alt="001.png"]')
  await expect(readerImage).toBeVisible()
  await readerImage.evaluate((node) => node.setAttribute("data-library-page-card-image", "stable"))

  const viewport = page.viewportSize()!
  await page.mouse.move(1, viewport.height / 2)
  const sidebar = page.locator('[data-reader-sidebar="left"]')
  await expect(sidebar).toBeVisible()
  await sidebar.getByRole("button", { name: "书签", exact: true }).click()
  const bookmarkCard = sidebar.locator('[data-reader-card="书签列表"]')
  await expect(bookmarkCard).toBeVisible()
  await bookmarkCard.getByRole("button", { name: "收藏当前书籍" }).click()
  const bookmarkRow = bookmarkCard.locator('[data-bookmark-id]').filter({ hasText: "fixture.cbz" }).first()
  await expect(bookmarkRow).toBeVisible()
  const bookmarkThumbnail = bookmarkRow.locator('[data-reader-thumbnail-surface="true"]')
  await expect(bookmarkThumbnail).toHaveAttribute("data-thumbnail-fit", "cover")
  await expect(bookmarkThumbnail.locator("img")).toBeVisible({ timeout: 30_000 })
  await expect(bookmarkRow).toContainText(fixture.path)

  const starResponse = page.waitForResponse((response) => response.url().includes("/reader/library/bookmarks/") && response.request().method() === "PATCH")
  await bookmarkRow.getByRole("button", { name: "收藏：fixture.cbz" }).click()
  expect((await starResponse).status()).toBe(200)
  await expect(bookmarkRow.getByRole("button", { name: "取消收藏：fixture.cbz" })).toBeVisible()
  expect(await readerImage.getAttribute("data-library-page-card-image")).toBe("stable")
  expect(await bookmarkCard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await bookmarkCard.screenshot({ path: testInfo.outputPath(`neoview-bookmark-thumbnails-${testInfo.project.name}.png`) })

  await sidebar.getByRole("button", { name: "页面列表", exact: true }).click()
  const pageListCard = sidebar.locator('[data-reader-card="页面导航"]')
  await expect(pageListCard).toBeVisible()
  await pageListCard.getByRole("button", { name: "带图列表" }).click()
  await expect(pageListCard.locator('[data-neoview-page-list="true"]')).toHaveAttribute("data-page-list-mode", "details")
  const pageThumbnail = pageListCard.locator('[data-reader-thumbnail-surface="true"]').first()
  await expect(pageThumbnail).toHaveAttribute("data-thumbnail-fit", "contain")
  await expect(pageThumbnail.locator("img")).toBeVisible()
  await expect(pageListCard.getByText("#1", { exact: true }).first()).toBeVisible()
  await expect(pageListCard.getByText("当前", { exact: true }).first()).toBeVisible()

  await pageListCard.getByRole("button", { name: "缩略图网格" }).click()
  await expect(pageListCard.locator('[data-neoview-page-list="true"]')).toHaveAttribute("data-page-list-mode", "thumbnails")
  await expect(pageListCard.locator('[data-page-thumbnail-grid-row]').first()).toBeVisible()
  expect(await pageListCard.locator('[data-page-thumbnail-grid-row]').first().locator('[data-page-thumbnail-tile]').count()).toBe(3)
  expect(await readerImage.getAttribute("data-library-page-card-image")).toBe("stable")
  expect(await pageListCard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await pageListCard.screenshot({ path: testInfo.outputPath(`neoview-page-list-thumbnails-${testInfo.project.name}.png`) })

  await page.mouse.move(viewport.width - 1, viewport.height / 2)
  const rightSidebar = page.locator('[data-reader-sidebar="right"]')
  await expect(rightSidebar).toBeVisible()
  await rightSidebar.getByRole("button", { name: "信息", exact: true }).click()
  const imageInformationCard = rightSidebar.locator('[data-reader-card="图像信息"]')
  await expect(imageInformationCard).toBeVisible()
  await expect(imageInformationCard.getByText("001.png", { exact: true })).toBeVisible()
  await expect(imageInformationCard.getByText("PNG", { exact: true })).toBeVisible()
  await expect(imageInformationCard.getByText("image/png", { exact: true })).toBeVisible()
  expect(pageMediaInformationRequests).toBe(0)
  expect(await readerImage.getAttribute("data-library-page-card-image")).toBe("stable")
  expect(await imageInformationCard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await imageInformationCard.screenshot({ path: testInfo.outputPath(`neoview-image-information-${testInfo.project.name}.png`) })
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
