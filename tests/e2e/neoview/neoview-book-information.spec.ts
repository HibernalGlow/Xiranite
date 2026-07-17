import { DatabaseSync } from "node:sqlite"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
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
    { path: "pages/003.png", bytes: ONE_PIXEL_PNG, level: 0 },
  ] })
  const databasePath = join(fixture.directory, "thumbnails.db")
  const database = new DatabaseSync(databasePath)
  database.exec("CREATE TABLE thumbs (key TEXT PRIMARY KEY, emm_json TEXT)")
  database.prepare("INSERT INTO thumbs (key, emm_json) VALUES (?1, ?2)").run(
    fixture.path.replaceAll("/", "\\"),
    JSON.stringify({ translated_title: "一个足够长的迁移验证译名", tags: [{ tag: "must-not-leak" }] }),
  )
  database.close()
  const configPath = join(fixture.directory, "xiranite.config.toml")
  await writeFile(configPath, [
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.panels]",
    "left_sidebar_visible = false",
    "right_sidebar_visible = true",
    "[nodes.neoview.panels.sidebars.right]",
    "pinned = false",
    "open = false",
    "width = 280",
    "[nodes.neoview.panels.edges.left]",
    "enabled = false",
    "initial_visible = false",
    "",
  ].join("\n"), "utf8")
  backend = await startBackend({
    token: "neoview-book-information-e2e",
    repository: createMemoryWorkspaceRepository(),
    configPath,
    legacyThumbnailDatabasePath: databasePath,
  })
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.book-information.e2e] [neoview.book-settings.direction-e2e] renders translated metadata and current-book controls", async ({ page }, testInfo) => {
  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  await page.route(`${backend.url}/reader/files/reveal`, (route) => route.fulfill({ status: 204 }))
  await page.goto(`/tests/e2e/neoview/neoview-book-information-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  const openedResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/sessions` && response.request().method() === "POST")
  const initialViewport = page.viewportSize()!
  await page.mouse.move(initialViewport.width / 2, 1)
  await page.getByRole("button", { name: "打开书籍" }).click()
  const opened = await (await openedResponse).json() as { sessionId: string }
  const image = page.locator('img[alt="001.png"]')
  await expect(image).toBeVisible()
  await image.evaluate((node) => node.setAttribute("data-book-information-image-instance", "stable"))

  let metadataRequests = 0
  page.on("request", (request) => { if (request.url().endsWith(`/reader/s/${opened.sessionId}/metadata`)) metadataRequests += 1 })
  const viewport = page.viewportSize()!
  await page.mouse.move(viewport.width - 1, viewport.height / 2)
  const sidebar = page.locator('[data-reader-sidebar="right"]')
  await expect(sidebar).toBeVisible()
  const card = sidebar.locator('[data-reader-card="书籍信息"]')
  await expect(card.getByText("一个足够长的迁移验证译名")).toBeVisible()
  await expect(card.getByText("原名")).toBeVisible()
  await expect(card.getByText("压缩包")).toBeVisible()
  await expect(card.getByText("1 / 3")).toBeVisible()
  await expect(card.getByText("33.3%")).toBeVisible()
  await expect(card.getByText("源大小")).toHaveCount(0)
  expect(await card.locator("dd").evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth + 1))).toBe(true)

  await sidebar.getByRole("button", { name: "信息面板操作" }).click()
  await page.getByRole("menuitem", { name: "复制路径" }).click()
  await expect.poll(() => page.evaluate(() => window.__NEOVIEW_COPIED_TEXT__)).toBe(fixture.path)
  await expect(sidebar.getByRole("status")).toHaveText("已复制书籍路径")

  const revealRequest = page.waitForRequest((request) => request.url() === `${backend.url}/reader/files/reveal` && request.method() === "POST")
  await sidebar.getByRole("button", { name: "信息面板操作" }).click()
  await page.getByRole("menuitem", { name: "在资源管理器中打开" }).click()
  const reveal = await revealRequest
  expect(reveal.postDataJSON()).toEqual({ path: fixture.path })
  expect(reveal.headers()["x-xiranite-token"]).toBe(backend.token)
  expect(await image.getAttribute("data-book-information-image-instance")).toBe("stable")

  const nextResponse = page.waitForResponse((response) => response.url().endsWith("/navigate"))
  await page.locator('[data-reader-app="true"]').focus()
  await page.keyboard.press("ArrowRight")
  await nextResponse
  await expect(card.getByText("2 / 3")).toBeVisible()
  await expect(card.getByText("66.7%")).toBeVisible()
  expect(metadataRequests).toBeLessThanOrEqual(2)
  await card.screenshot({ path: testInfo.outputPath(`neoview-book-information-${testInfo.project.name}.png`) })

  await sidebar.getByRole("button", { name: "属性", exact: true }).click()
  const settingsCard = sidebar.locator('[data-reader-card="本书设置"]')
  await expect(settingsCard).toBeVisible()
  await expect(settingsCard.getByRole("button", { name: "左→右" })).toHaveAttribute("aria-pressed", "true")
  const doubleResponse = page.waitForResponse((response) => response.url().endsWith(`/reader/s/${opened.sessionId}/options`) && response.request().method() === "PATCH")
  await settingsCard.getByRole("button", { name: "双页" }).click()
  expect((await doubleResponse).request().postDataJSON()).toEqual({ layout: { pageMode: "double" } })
  await expect.poll(() => page.locator('[data-reader-frame="true"] img').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("alt")))).toEqual(["002.png", "003.png"])

  const directionResponse = page.waitForResponse((response) => response.url().endsWith(`/reader/s/${opened.sessionId}/options`) && response.request().method() === "PATCH")
  await settingsCard.getByRole("button", { name: "右→左" }).click()
  expect((await directionResponse).request().postDataJSON()).toEqual({ direction: "right-to-left" })
  await expect(settingsCard.getByRole("button", { name: "右→左" })).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => page.locator('[data-reader-frame="true"] img').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("alt")))).toEqual(["003.png", "002.png"])
  expect(await settingsCard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await settingsCard.screenshot({ path: testInfo.outputPath(`neoview-book-settings-${testInfo.project.name}.png`) })
})
