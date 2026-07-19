import { DatabaseSync } from "node:sqlite"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"
import { createZipFixture, type ZipFixture } from "../../../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"

test.use({ viewport: { width: 1920, height: 1080 } })

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
    "[nodes.neoview.reader]",
    "reading_direction = \"left-to-right\"",
    "double_page_view = false",
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

test("[neoview.book-information.e2e] [neoview.book-settings.persistence-e2e] [neoview.book-settings.inheritance-e2e] renders translated metadata and persistent current-book controls", async ({ page }, testInfo) => {
  const imageRequests: string[] = []
  page.on("request", (request) => {
    if (request.resourceType() === "image") imageRequests.push(request.url())
  })
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
  await expect(card.getByText("原名:")).toBeVisible()
  await expect(card.getByText("压缩包")).toBeVisible()
  await expect(card.getByText("1 / 3")).toBeVisible()
  await expect(card.getByText("33.3%")).toBeVisible()
  await expect(card.getByText("源大小")).toHaveCount(0)
  expect(await card.locator("dd").evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth + 1))).toBe(true)

  await sidebar.getByRole("button", { name: "信息面板操作" }).click()
  await page.getByRole("menuitem", { name: "复制路径" }).click()
  await expect.poll(() => page.evaluate(() => window.__NEOVIEW_COPIED_TEXT__)).toBe(fixture.path)
  await expect(page.getByRole("status")).toHaveText("已复制书籍路径")

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
  const initialSettingsResponse = await page.request.get(`${backend.url}/reader/s/${opened.sessionId}/book-settings`, { headers: { "x-xiranite-token": backend.token } })
  expect(initialSettingsResponse.status()).toBe(200)
  const initialSettings = (await initialSettingsResponse.json()).settings as {
    effective: { horizontalBook: boolean }
  }
  const initialHorizontalBook = initialSettings.effective.horizontalBook
  const overriddenHorizontalBook = !initialHorizontalBook
  await expect(settingsCard.getByRole("button", { name: "左→右" })).toHaveAttribute("aria-pressed", "true")
  await expect(settingsCard.getByRole("button", { name: "收藏本书" })).toHaveText("未收藏")
  const activeImage = page.locator('img[alt="002.png"]')
  await expect(activeImage).toBeVisible()
  await activeImage.evaluate((node) => node.setAttribute("data-book-settings-image-instance", "stable"))
  const activeAssetUrl = await activeImage.getAttribute("src")
  const activeRequestsBeforeMetadata = imageRequests.filter((url) => url === activeAssetUrl).length

  await patchBookSettings(page, opened.sessionId, settingsCard.getByRole("button", { name: "收藏本书" }), 0, { favorite: true })
  await expect(settingsCard.getByRole("button", { name: "取消收藏本书" })).toHaveText("已收藏")
  expect(await activeImage.getAttribute("data-book-settings-image-instance")).toBe("stable")
  expect(imageRequests.filter((url) => url === activeAssetUrl)).toHaveLength(activeRequestsBeforeMetadata)

  await patchBookSettings(page, opened.sessionId, settingsCard.getByRole("button", { name: "评分 4 星" }), 1, { rating: 4 })
  await expect(settingsCard.getByRole("button", { name: "评分 4 星" })).toHaveAttribute("aria-pressed", "true")
  expect(await activeImage.getAttribute("data-book-settings-image-instance")).toBe("stable")
  expect(imageRequests.filter((url) => url === activeAssetUrl)).toHaveLength(activeRequestsBeforeMetadata)

  const doubleResponse = await patchBookSettings(page, opened.sessionId, settingsCard.getByRole("button", { name: "双页" }), 2, { pageMode: "double" })
  expect((await doubleResponse.json()).frame.layout.pageMode).toBe("double")
  await expect.poll(() => page.locator('[data-reader-frame="true"] img').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("alt")))).toEqual(["002.png", "003.png"])

  const secondImage = page.locator('img[alt="002.png"]')
  await secondImage.evaluate((node) => node.setAttribute("data-book-settings-frame-instance", "stable"))
  const directionResponse = await patchBookSettings(page, opened.sessionId, settingsCard.getByRole("button", { name: "右→左" }), 3, { direction: "right-to-left" })
  expect((await directionResponse.json()).frame.direction).toBe("right-to-left")
  await expect(settingsCard.getByRole("button", { name: "右→左" })).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => page.locator('[data-reader-frame="true"] img').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("alt")))).toEqual(["003.png", "002.png"])
  expect(await secondImage.getAttribute("data-book-settings-frame-instance")).toBe("stable")

  const horizontalResponse = await patchBookSettings(page, opened.sessionId, settingsCard.getByRole("switch", { name: "横版本子" }), 4, { horizontalBook: overriddenHorizontalBook })
  expect((await horizontalResponse.json()).frame.layout.treatWidePageAsSingle).toBe(overriddenHorizontalBook)
  await expect(settingsCard.getByRole("switch", { name: "横版本子" })).toHaveAttribute("data-state", overriddenHorizontalBook ? "checked" : "unchecked")
  expect(await settingsCard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  await settingsCard.screenshot({ path: testInfo.outputPath(`neoview-book-settings-${testInfo.project.name}.png`) })

  const reopened = await reopenBook(page, backend.url)
  await revealRightSidebar(page)
  const reopenedSidebar = page.locator('[data-reader-sidebar="right"]')
  await reopenedSidebar.getByRole("button", { name: "属性", exact: true }).click()
  const reopenedSettings = reopenedSidebar.locator('[data-reader-card="本书设置"]')
  await expect(reopenedSettings.getByRole("button", { name: "取消收藏本书" })).toHaveText("已收藏")
  await expect(reopenedSettings.getByRole("button", { name: "评分 4 星" })).toHaveAttribute("aria-pressed", "true")
  await expect(reopenedSettings.getByRole("button", { name: "右→左" })).toHaveAttribute("aria-pressed", "true")
  await expect(reopenedSettings.getByRole("button", { name: "双页" })).toHaveAttribute("aria-pressed", "true")
  await expect(reopenedSettings.getByRole("switch", { name: "横版本子" })).toHaveAttribute("data-state", overriddenHorizontalBook ? "checked" : "unchecked")
  await expect(reopenedSettings.locator('[data-book-setting]').getByText("本书", { exact: true })).toHaveCount(5)

  const resetLabels = ["收藏", "评分", "阅读方向", "显示模式", "横版本子"] as const
  const resetKeys = ["favorite", "rating", "direction", "pageMode", "horizontalBook"] as const
  for (let index = 0; index < resetLabels.length; index += 1) {
    const key = resetKeys[index]!
    await patchBookSettings(page, reopened.sessionId, reopenedSettings.getByRole("button", { name: `恢复继承${resetLabels[index]}` }), 5 + index, { [key]: null })
  }
  await expect(reopenedSettings.locator('[data-book-setting]').getByText("继承", { exact: true })).toHaveCount(5)
  await expect(reopenedSettings.getByRole("button", { name: "收藏本书" })).toHaveText("未收藏")
  await expect(reopenedSettings.getByRole("button", { name: "评分 1 星" })).toHaveText("☆")
  await expect(reopenedSettings.getByRole("button", { name: "左→右" })).toHaveAttribute("aria-pressed", "true")
  await expect(reopenedSettings.getByRole("button", { name: "单页" })).toHaveAttribute("aria-pressed", "true")
  await expect(reopenedSettings.getByRole("switch", { name: "横版本子" })).toHaveAttribute("data-state", initialHorizontalBook ? "checked" : "unchecked")

  const inherited = await reopenBook(page, backend.url)
  const inheritedResponse = await page.request.get(`${backend.url}/reader/s/${inherited.sessionId}/book-settings`, { headers: { "x-xiranite-token": backend.token } })
  expect(inheritedResponse.status()).toBe(200)
  expect((await inheritedResponse.json()).settings).toMatchObject({
    revision: 10,
    overrides: {},
    inherited: ["favorite", "rating", "direction", "pageMode", "horizontalBook"],
    effective: { favorite: false, rating: 0, direction: "left-to-right", pageMode: "single", horizontalBook: initialHorizontalBook },
  })
})

async function patchBookSettings(
  page: Page,
  sessionId: string,
  control: Locator,
  expectedRevision: number,
  patch: Record<string, unknown>,
) {
  const response = page.waitForResponse((candidate) => candidate.url().endsWith(`/reader/s/${sessionId}/book-settings`) && candidate.request().method() === "PATCH")
  await control.click()
  const result = await response
  expect(result.request().postDataJSON()).toEqual({ expectedRevision, patch })
  expect(result.status()).toBe(200)
  return result
}

async function reopenBook(page: Page, baseUrl: string): Promise<{ sessionId: string }> {
  const viewport = page.viewportSize()!
  await page.mouse.move(1, viewport.height / 2)
  await expect(page.locator('[data-reader-sidebar="right"]')).toBeHidden()
  await page.mouse.move(viewport.width / 2, 1)
  const closeButton = page.locator('button[aria-label="关闭书籍"]')
  await expect(closeButton).toBeVisible()
  await closeButton.click()
  await expect(page.getByRole("button", { name: "打开书籍" })).toBeVisible()
  const response = page.waitForResponse((candidate) => candidate.url() === `${baseUrl}/reader/sessions` && candidate.request().method() === "POST")
  await page.getByRole("button", { name: "打开书籍" }).click()
  const opened = await (await response).json() as { sessionId: string }
  await expect(page.locator('[data-reader-frame="true"] img').first()).toBeVisible()
  return opened
}

async function revealRightSidebar(page: Page) {
  const viewport = page.viewportSize()!
  await page.mouse.move(viewport.width - 1, viewport.height / 2)
  await expect(page.locator('[data-reader-sidebar="right"]')).toBeVisible()
}
