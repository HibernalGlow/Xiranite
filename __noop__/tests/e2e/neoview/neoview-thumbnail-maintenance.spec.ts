import { DatabaseSync } from "node:sqlite"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"
import { createZipFixture, type ZipFixture } from "../../../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"))
const CURRENT_SCHEMA_SQL = `
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

let fixture: ZipFixture
let backend: Awaited<ReturnType<typeof startBackend>>
let databasePath: string
let emptyPath: string
let expiredPath: string
let invalidPath: string
let legacyDatabaseInvariant: LegacyDatabaseInvariant

interface LegacyDatabaseInvariant {
  schema: readonly { type: string; name: string; tableName: string; sql: string | null }[]
  version: string | undefined
  userVersion: number
  journalMode: string
}

test.setTimeout(90_000)

test.beforeAll(async () => {
  fixture = await createZipFixture({ entries: [
    { path: "pages/001.png", bytes: ONE_PIXEL_PNG, level: 0 },
    { path: "pages/002.png", bytes: ONE_PIXEL_PNG, level: 0 },
  ] })
  databasePath = join(fixture.directory, "thumbnails.db")
  emptyPath = join(fixture.directory, "empty.jpg")
  expiredPath = join(fixture.directory, "expired.jpg")
  invalidPath = join(fixture.directory, "missing.jpg")
  await writeFile(emptyPath, Uint8Array.of())
  await writeFile(expiredPath, ONE_PIXEL_PNG)

  const database = new DatabaseSync(databasePath)
  database.exec(CURRENT_SCHEMA_SQL)
  const insertThumbnail = database.prepare("INSERT INTO thumbs (key, date, category, value) VALUES (?1, ?2, ?3, ?4)")
  insertThumbnail.run(fixture.path, "2099-01-01 00:00:00", "file", ONE_PIXEL_PNG)
  insertThumbnail.run(emptyPath, "2099-01-01 00:00:00", "file", null)
  insertThumbnail.run(expiredPath, "2000-01-01 00:00:00", "file", ONE_PIXEL_PNG)
  insertThumbnail.run(fixture.directory, "2000-01-01 00:00:00", "folder", ONE_PIXEL_PNG)
  insertThumbnail.run(invalidPath, "2099-01-01 00:00:00", "file", ONE_PIXEL_PNG)
  database.prepare("INSERT INTO failed_thumbnails (key, reason, retry_count, last_attempt) VALUES (?1, 'decode', 1, '2000-01-01 00:00:00')").run(expiredPath)
  database.close()

  const configPath = join(fixture.directory, "xiranite.config.toml")
  await writeFile(configPath, [
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.panels]",
    "left_sidebar_visible = false",
    "right_sidebar_visible = true",
    "auto_hide_toolbar = false",
    "[nodes.neoview.panels.sidebars.right]",
    "pinned = true",
    "open = true",
    "width = 320",
    "[nodes.neoview.panels.edges.left]",
    "enabled = false",
    "initial_visible = false",
    "[nodes.neoview.panels.panel_state.control]",
    "visible = true",
    "order = 4",
    'position = "right"',
    "[nodes.neoview.panels.card_state.thumbnail-maintenance]",
    'panel_id = "control"',
    "visible = true",
    "expanded = true",
    "order = 1",
    "",
  ].join("\n"), "utf8")
  backend = await startBackend({
    token: "neoview-thumbnail-maintenance-e2e",
    repository: createMemoryWorkspaceRepository(),
    configPath,
    legacyThumbnailDatabasePath: databasePath,
  })
  legacyDatabaseInvariant = readLegacyDatabaseInvariant()
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.thumbnail-maintenance.e2e] [neoview.thumbnail-maintenance.database-e2e] [neoview.thumbnail-maintenance.image-stability] mutates the real legacy database without remounting the active image", async ({ page }, testInfo) => {
  const imageRequests: string[] = []
  page.on("request", (request) => {
    if (request.resourceType() === "image") imageRequests.push(request.url())
  })
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })
  const statsResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/thumbnails/maintenance`
    && response.request().method() === "GET"
  ))
  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  const initialStats = await statsResponse
  expect(initialStats.status()).toBe(200)
  expect(initialStats.request().headers()["x-xiranite-token"]).toBe(backend.token)
  const openedResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/sessions` && response.request().method() === "POST"
  ))
  const openButton = page.getByRole("button", { name: "打开书籍" })
  await expect(openButton).toBeVisible()
  await openButton.click()
  expect((await openedResponse).status()).toBe(201)
  const image = page.locator('img[alt="001.png"]')
  await expect(image).toBeVisible()
  await image.evaluate((node) => node.setAttribute("data-thumbnail-maintenance-image-instance", "stable"))
  const activeAssetUrl = await image.getAttribute("src")

  const sidebar = page.locator('[data-reader-sidebar="right"]')
  await expect(sidebar).toBeVisible()
  const card = sidebar.locator('[data-neoview-thumbnail-maintenance="true"]')
  await expect(card).toBeVisible()
  await expect(card.getByText("5", { exact: true }).first()).toBeVisible()
  await expect(card.getByRole("button", { name: "清除失败记录 (1)" })).toBeEnabled()

  const invalidResponse = page.waitForResponse((response) => response.url().endsWith("/reader/thumbnails/maintenance/cleanup")
    && response.request().postData()?.includes('"kind":"invalid"') === true)
  await card.getByRole("button", { name: "无效路径" }).click()
  const invalid = await invalidResponse
  expect(invalid.status()).toBe(200)
  expect(invalid.request().headers()["x-xiranite-token"]).toBe(backend.token)
  expect(await thumbnailRowCount(invalidPath)).toBe(0)
  await expect(card.getByText(/已扫描 5 条，删除 1 条/)).toBeVisible()

  const emptyResponse = page.waitForResponse((response) => response.url().endsWith("/reader/thumbnails/maintenance/cleanup")
    && response.request().postData()?.includes('"kind":"empty"') === true)
  await card.getByRole("button", { name: "空 Blob" }).click()
  expect((await emptyResponse).status()).toBe(200)
  expect(await thumbnailRowCount(emptyPath)).toBe(0)

  await card.getByLabel("超过").fill("30")
  const expiredResponse = page.waitForResponse((response) => response.url().endsWith("/reader/thumbnails/maintenance/cleanup")
    && response.request().postData()?.includes('"kind":"expired"') === true)
  await card.getByRole("button", { name: "清理过期条目" }).click()
  expect((await expiredResponse).status()).toBe(200)
  expect(await thumbnailRowCount(expiredPath)).toBe(0)
  expect(await thumbnailRowCount(fixture.directory)).toBe(1)

  const failuresResponse = page.waitForResponse((response) => response.url().endsWith("/reader/thumbnails/maintenance/failures/clear"))
  await card.getByRole("button", { name: "清除失败记录 (1)" }).click()
  expect((await failuresResponse).status()).toBe(200)
  expect(await failedRowCount()).toBe(0)
  expect(readLegacyDatabaseInvariant()).toEqual(legacyDatabaseInvariant)

  expect(await image.getAttribute("data-thumbnail-maintenance-image-instance")).toBe("stable")
  expect(imageRequests.filter((url) => url === activeAssetUrl)).toHaveLength(1)
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await card.screenshot({ path: testInfo.outputPath(`neoview-thumbnail-maintenance-${testInfo.project.name}.png`) })
})

async function thumbnailRowCount(key: string): Promise<number> {
  const database = new DatabaseSync(databasePath, { open: true, readOnly: true })
  try {
    return Number(database.prepare("SELECT COUNT(*) AS count FROM thumbs WHERE key = ?1").get(key)?.count ?? 0)
  } finally {
    database.close()
  }
}

async function failedRowCount(): Promise<number> {
  const database = new DatabaseSync(databasePath, { open: true, readOnly: true })
  try {
    return Number(database.prepare("SELECT COUNT(*) AS count FROM failed_thumbnails").get()?.count ?? 0)
  } finally {
    database.close()
  }
}

function readLegacyDatabaseInvariant(): LegacyDatabaseInvariant {
  const database = new DatabaseSync(databasePath, { open: true, readOnly: true })
  try {
    const schema = database.prepare(`
      SELECT type, name, tbl_name AS tableName, sql
      FROM sqlite_master
      WHERE name NOT LIKE 'xr\\_%' ESCAPE '\\'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all() as unknown as LegacyDatabaseInvariant["schema"]
    const version = database.prepare("SELECT value FROM metadata WHERE key = 'version'").get()?.value
    const userVersion = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0)
    const journalMode = String(database.prepare("PRAGMA journal_mode").get()?.journal_mode ?? "")
    return { schema, version: typeof version === "string" ? version : undefined, userVersion, journalMode }
  } finally {
    database.close()
  }
}
