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
  fixture = await createZipFixture({ entries: [{ path: "pages/001.png", bytes: ONE_PIXEL_PNG, level: 0 }] })
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
    token: "neoview-bookmark-context-actions-e2e",
    repository: createMemoryWorkspaceRepository(),
    configPath,
    legacyThumbnailDatabasePath: databasePath,
  })
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.bookmark.context-actions-e2e] [neoview.bookmark.thumbnail-reload-e2e] keeps folder-style thumbnails while running host file actions", async ({ page }) => {
  const systemOpenPaths: string[] = []
  const revealedPaths: string[] = []
  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  await page.route(`${backend.url}/reader/files/open`, async (route) => {
    systemOpenPaths.push((route.request().postDataJSON() as { path: string }).path)
    await route.fulfill({ status: 204 })
  })
  await page.route(`${backend.url}/reader/files/reveal`, async (route) => {
    revealedPaths.push((route.request().postDataJSON() as { path: string }).path)
    await route.fulfill({ status: 204 })
  })
  await page.goto(`/tests/e2e/neoview/neoview-book-information-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()
  const readerImage = page.locator('img[alt="001.png"]')
  await expect(readerImage).toBeVisible()
  await readerImage.evaluate((node) => node.setAttribute("data-bookmark-context-image", "stable"))

  const sidebar = page.locator('[data-reader-sidebar="left"]')
  await activateControl(sidebar.getByRole("button", { name: "书签", exact: true }))
  const card = sidebar.locator('[data-reader-card="书签列表"]')
  await activateControl(card.getByRole("button", { name: "内容" }))
  await activateControl(card.getByRole("button", { name: "收藏当前书籍" }))
  const row = card.locator('[data-bookmark-id]').filter({ hasText: "fixture.cbz" }).first()
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute("data-context-menu", "neoview-bookmark-entry")
  await expect(row).toHaveAttribute("data-entry-variant", "content")
  const thumbnail = row.locator('[data-reader-thumbnail-surface="true"]')
  await expect(thumbnail).toHaveAttribute("data-thumbnail-state", "ready", { timeout: 30_000 })
  const originalThumbnailUrl = await thumbnail.locator("img").getAttribute("src")

  await row.click({ button: "right" })
  await page.getByRole("menuitem", { name: "复制路径" }).click()
  await expect.poll(() => page.evaluate(() => window.__NEOVIEW_COPIED_TEXT__)).toBe(fixture.path)
  await row.click({ button: "right" })
  await page.getByRole("menuitem", { name: "用默认软件打开" }).click()
  await expect.poll(() => systemOpenPaths).toEqual([fixture.path])
  await row.click({ button: "right" })
  await page.getByRole("menuitem", { name: "在资源管理器中显示" }).click()
  await expect.poll(() => revealedPaths).toEqual([fixture.path])
  await row.click({ button: "right" })
  const refreshResponse = page.waitForResponse((response) => {
    if (!response.url().endsWith("/reader/library/thumbnails") || response.request().method() !== "POST") return false
    const body = response.request().postDataJSON() as { items?: Array<{ id: string; refresh?: boolean }> }
    return body.items?.some((item) => item.refresh === true) === true
  })
  await page.getByRole("menuitem", { name: "重新加载缩略图" }).click()
  expect((await refreshResponse).status()).toBe(201)
  await expect.poll(() => thumbnail.locator("img").getAttribute("src")).not.toBe(originalThumbnailUrl)

  expect(await readerImage.getAttribute("data-bookmark-context-image")).toBe("stable")
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
})

async function activateControl(button: import("@playwright/test").Locator) {
  await button.focus()
  await expect(button).toBeFocused()
  await button.press("Enter")
}

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
