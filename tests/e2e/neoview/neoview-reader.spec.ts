import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { expect, test } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"
import { createZipFixture, deterministicBytes, type ZipFixture } from "../../../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"

test.use({ viewport: { width: 1920, height: 1080 } })

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
))
const HOT_NAVIGATION_BUDGET_MS = 150
const HOT_PAGE_TURN_BUDGET_MS = 200
const READER_PREFETCH_READY_MARK = "neoview-reader-prefetch-ready"

async function selectFolderHandleAction(page: Page, folderCard: Locator, action: string): Promise<void> {
  await folderCard.getByRole("button", { name: "文件操作手柄" }).click()
  await page.getByRole("menuitem", { name: action, exact: true }).click()
}

async function selectFolderViewMode(page: Page, folderCard: Locator, view: string): Promise<void> {
  if (await folderCard.getByRole("button", { name: view, exact: true }).count() === 0) {
    await selectFolderHandleAction(page, folderCard, "视图")
  }
  await folderCard.getByRole("button", { name: view, exact: true }).click()
}

async function openFolderMoreActions(page: Page, folderCard: Locator): Promise<void> {
  if (await folderCard.getByRole("button", { name: "新建文件夹标签" }).count() === 0) {
    await selectFolderHandleAction(page, folderCard, "更多操作")
  }
}

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
  await mkdir(join(fixture.directory, "nested-search"), { recursive: true })
  await writeFile(join(fixture.directory, "nested-search", "recursive-result.png"), ONE_PIXEL_PNG)

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
  database.prepare("INSERT INTO thumbs (key, category, emm_json) VALUES (?1, 'file', ?2)").run(
    fixture.path,
    JSON.stringify({ tags: [{ namespace: "artist", tag: "alice" }] }),
  )
  database.close()

  const configPath = join(fixture.directory, "xiranite.config.toml")
  await writeFile(configPath, [
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.reader]",
    "default_zoom_mode = \"fitHeight\"",
    "double_page_view = false",
    "[nodes.neoview.slideshow]",
    "interval_seconds = 7",
    "loop = false",
    "random = true",
    "fade_transition = false",
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

test("[neoview.react.cbz-e2e] [neoview.thumbnail.react-e2e] [neoview.shell.e2e] [neoview.folder.tree-layout-e2e] [neoview.folder.tree-pins-e2e] [neoview.folder.tree-roots-e2e] [neoview.folder.watch-live-e2e] decodes, virtualizes thumbnails and navigates a real CBZ", async ({ page }, testInfo) => {
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

  const first = page.locator('img[alt="001.jpg"]')
  await expect(first).toBeVisible()
  await expect.poll(() => first.getAttribute("src")).not.toContain("format=webp")
  await expect.poll(() => first.evaluate((image: HTMLImageElement) => (
    image.complete && image.naturalWidth === 2000
  ))).toBe(true)
  await expect(page.locator("canvas")).toHaveCount(0)

  await first.evaluate((image) => image.setAttribute("data-neoview-presentation-image-instance", "stable"))
  const readerViewport = page.locator('[data-reader-frame-viewport="true"]')
  const fitMode = page.getByRole("combobox", { name: "缩放模式" })
  await expect(fitMode).toHaveValue("fit-height")
  const activeAssetUrl = await first.getAttribute("src")
  let repeatedActiveAssetRequests = 0
  page.on("request", (request) => {
    if (request.url() === activeAssetUrl) repeatedActiveAssetRequests += 1
  })
  const platformRootRequests: string[] = []
  page.on("request", (request) => {
    if (request.url() === `${backend.url}/reader/browser/roots`) platformRootRequests.push(request.url())
  })
  const originalDefaultsResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"fitMode":"original"') === true
  ))
  await fitMode.selectOption("original")
  expect((await originalDefaultsResponse).status()).toBe(200)
  expect(await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")).toContain('default_zoom_mode = "original"')
  await expect(readerViewport).toHaveAttribute("data-reader-fit-mode", "original")
  await expect.poll(() => readerViewport.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await page.getByRole("button", { name: "顺时针旋转 90 度" }).click()
  await expect(readerViewport).toHaveAttribute("data-reader-rotation", "90")
  await expect(first).toHaveCSS("transform", /matrix/)
  await page.getByRole("button", { name: "放大" }).click()
  await expect(page.getByLabel("手动缩放比例")).toHaveText("110%")
  const resetDefaultsResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"fitMode":"fit"') === true
  ))
  await page.getByRole("button", { name: "重置视图" }).click()
  expect((await resetDefaultsResponse).status()).toBe(200)
  await expect(readerViewport).toHaveAttribute("data-reader-fit-mode", "fit")
  await expect(readerViewport).toHaveAttribute("data-reader-rotation", "0")
  await expect.poll(() => readerViewport.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
  expect(await first.getAttribute("data-neoview-presentation-image-instance")).toBe("stable")
  expect(repeatedActiveAssetRequests).toBe(0)
  await expect(page.locator("canvas")).toHaveCount(0)

  const doubleOptionsResponse = page.waitForResponse((response) => response.url().endsWith("/options") && response.request().method() === "PATCH")
  const doubleDefaultsResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"pageMode":"double"') === true
  ))
  await page.getByRole("button", { name: "双页模式" }).click()
  expect(await (await doubleOptionsResponse).json()).toMatchObject({ frame: { layout: { pageMode: "double" } } })
  expect((await doubleDefaultsResponse).status()).toBe(200)
  await expect(page.getByRole("button", { name: "双页模式" })).toHaveAttribute("aria-pressed", "true")
  expect(await first.getAttribute("data-neoview-presentation-image-instance")).toBe("stable")
  expect(await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")).toContain("double_page_view = true")

  const singleOptionsResponse = page.waitForResponse((response) => response.url().endsWith("/options") && response.request().method() === "PATCH")
  const singleDefaultsResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"pageMode":"single"') === true
  ))
  await page.getByRole("button", { name: "单页模式" }).click()
  expect((await singleOptionsResponse).status()).toBe(200)
  expect((await singleDefaultsResponse).status()).toBe(200)
  await expect(page.getByRole("button", { name: "单页模式" })).toHaveAttribute("aria-pressed", "true")
  expect(await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")).toContain("double_page_view = false")

  await first.evaluate((image) => image.setAttribute("data-neoview-settings-image-instance", "stable"))
  let boardPatchRequests = 0
  page.on("request", (request) => {
    if (request.url() === `${backend.url}/reader/config` && request.method() === "PATCH" && request.postData()?.includes('"board"')) boardPatchRequests += 1
  })
  await page.getByRole("button", { name: "打开 NeoView 设置" }).click()
  const settingsDialog = page.getByRole("dialog")
  await expect(settingsDialog).toBeVisible()
  await expect(page.getByRole("heading", { name: "边栏布局" })).toBeVisible()
  await expect(page.locator('[data-neoview-panel-layout-editor="true"]')).toHaveCount(0)
  const settingsBox = await settingsDialog.boundingBox()
  const settingsViewport = page.viewportSize()!
  expect(settingsBox!.width).toBeGreaterThan(settingsViewport.width * 0.65)
  expect(settingsBox!.height).toBeGreaterThan(settingsViewport.height * 0.8)
  await page.screenshot({ path: testInfo.outputPath(`neoview-settings-${testInfo.project.name}.png`) })
  await page.getByRole("button", { name: "视图" }).click()
  await expect(page.getByRole("heading", { name: "视图默认值" })).toBeVisible()
  const settingsFitResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"fitMode":"fit-width"') === true
  ))
  await page.getByRole("combobox", { name: "默认缩放模式" }).selectOption("fit-width")
  expect((await settingsFitResponse).status()).toBe(200)
  await expect(readerViewport).toHaveAttribute("data-reader-fit-mode", "fit-width")
  expect(await first.getAttribute("data-neoview-settings-image-instance")).toBe("stable")
  expect(await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")).toContain('default_zoom_mode = "fitWidth"')
  await page.getByRole("button", { name: "边栏管理" }).click()
  await page.getByRole("combobox", { name: "历史记录位置" }).selectOption("right")
  expect(boardPatchRequests).toBe(0)
  const sidebarBoardResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config` && response.request().method() === "PATCH" && response.request().postData()?.includes('"board"') === true
  ))
  await page.getByRole("button", { name: "保存边栏布局" }).click()
  const sidebarBoardResult = await sidebarBoardResponse
  expect(sidebarBoardResult.status()).toBe(200)
  expect(sidebarBoardResult.request().postDataJSON()).toMatchObject({ expectedRevision: 0 })
  expect((await sidebarBoardResult.json() as { shell: { panelLayout: Record<string, { position: string }> } }).shell.panelLayout.history?.position).toBe("right")
  expect(boardPatchRequests).toBe(1)
  await page.getByRole("button", { name: "卡片管理" }).click()
  await expect(page.locator('[data-neoview-panel-layout-editor="true"]')).toBeVisible()
  await expect(page.getByRole("combobox", { name: "移动页面导航到" }).locator('option[value="__hidden__"]')).toHaveCount(0)
  await expect(page.getByRole("combobox", { name: "移动页面导航到" }).locator('option[value="cardwindow"]')).toHaveCount(0)
  const dockedSettingCard = page.locator('[data-panel-layout-column="settings"] [data-panel-layout-card="panel-layout-settings"]')
  const dockedSidebarSettingCard = page.locator('[data-panel-layout-column="settings"] [data-panel-layout-card="sidebar-management-settings"]')
  await page.getByRole("combobox", { name: "移动面板布局设置到" }).selectOption("settings")
  await page.getByRole("combobox", { name: "移动边栏管理设置到" }).selectOption("settings")
  await expect(dockedSettingCard).toBeVisible()
  await expect(dockedSidebarSettingCard).toBeVisible()
  const boardResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config` && response.request().method() === "PATCH" && response.request().postData()?.includes('"board"') === true
  ))
  await page.getByRole("button", { name: "保存面板布局" }).click()
  const savedBoardResponse = await boardResponse
  expect(savedBoardResponse.status()).toBe(200)
  expect(savedBoardResponse.request().postDataJSON()).toMatchObject({ expectedRevision: 1 })
  expect(boardPatchRequests).toBe(2)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.locator('[data-neoview-panel-layout-editor="true"]')).toHaveCount(0)
  expect(await first.getAttribute("data-neoview-settings-image-instance")).toBe("stable")

  const topEdge = page.getByRole("region", { name: "NeoView 顶部工具栏" })
  const bottomEdge = page.getByRole("region", { name: "NeoView 底部缩略图与导航栏" })
  await expect(topEdge).toBeVisible()
  const shellViewport = page.viewportSize()!
  await page.mouse.move(shellViewport.width / 2, shellViewport.height - 1)
  await expect(bottomEdge).toBeVisible()
  await expect(page.locator("[data-reader-sidebar]")).toHaveCount(0)
  await page.mouse.move(1, shellViewport.height / 2)
  const leftSidebar = page.locator('[data-reader-sidebar="left"]')
  await expect(leftSidebar).toBeVisible({ timeout: 20_000 })
  const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
  await expect(folderCard).toBeVisible()
  const folderEntries = folderCard.getByRole("listbox", { name: "文件项目" }).locator('button[aria-selected]')
  await expect.poll(() => folderEntries.count()).toBeGreaterThanOrEqual(3)
  await folderEntries.nth(0).click()
  await folderEntries.nth(2).click({ modifiers: ["Shift"] })
  await expect(folderCard).toHaveAttribute("data-selection-count", "3")
  await folderEntries.nth(1).click({ modifiers: ["Control"] })
  await expect(folderCard).toHaveAttribute("data-selection-count", "2")
  await selectFolderHandleAction(page, folderCard, "多选模式")
  const selectionBar = folderCard.locator('[data-neoview-folder-selection-bar="true"]')
  await expect(selectionBar).toBeVisible()
  const totalEntries = Number(await folderCard.getAttribute("data-selection-total"))
  await selectionBar.getByRole("button", { name: "选择全部项目" }).click()
  await expect(folderCard).toHaveAttribute("data-selection-count", String(totalEntries))
  await selectionBar.getByRole("button", { name: "点击行为：点开" }).click()
  await folderEntries.nth(1).click()
  await expect(folderCard).toHaveAttribute("data-selection-count", String(totalEntries - 1))
  await selectionBar.getByRole("button", { name: "反转选择状态" }).click()
  await expect(folderCard).toHaveAttribute("data-selection-count", "1")
  await selectionBar.getByRole("button", { name: "取消全部选择" }).click()
  await expect(folderCard).toHaveAttribute("data-selection-count", "0")
  await selectionBar.getByRole("button", { name: "链接选中模式" }).click()
  await folderEntries.nth(0).click()
  await folderEntries.nth(2).click()
  await expect(folderCard).toHaveAttribute("data-selection-count", "3")
  await selectionBar.getByRole("button", { name: "关闭多选模式" }).click()
  await expect(selectionBar).toHaveCount(0)
  const folderList = folderCard.getByRole("listbox", { name: "文件项目" })
  await folderList.focus()
  await folderList.press("End")
  await expect(folderList).toHaveAttribute("data-focused-index", String(totalEntries - 1))
  await folderList.press("ArrowUp")
  await expect(folderList).toHaveAttribute("data-focused-index", String(Math.max(0, totalEntries - 2)))
  await folderList.press("Home")
  await expect(folderList).toHaveAttribute("data-focused-index", "0")
  await folderList.press("Control+a")
  await expect(folderCard).toHaveAttribute("data-selection-count", String(totalEntries))
  await folderList.press("Escape")
  await expect(folderCard).toHaveAttribute("data-selection-count", "0")
  await expect(folderCard.locator('[data-neoview-folder-selection-bar="true"]')).toHaveCount(0)
  const stableWatchSelection = folderList.getByTitle(join(fixture.directory, "fixture.cbz"), { exact: true })
  await stableWatchSelection.click({ modifiers: ["Control"] })
  await expect(folderCard).toHaveAttribute("data-selection-count", "1")
  const watchedPath = join(fixture.directory, "watch-created.cbz")
  const createdResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/changes") && response.status() === 200
  ), { timeout: 20_000 })
  await writeFile(watchedPath, "external")
  expect((await createdResponse).status()).toBe(200)
  await expect(folderList.getByText("watch-created.cbz", { exact: true })).toBeVisible()
  await expect(folderCard).toHaveAttribute("data-selection-count", "1")
  await expect(stableWatchSelection).toHaveAttribute("aria-selected", "true")
  const removedResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/changes") && response.status() === 200
  ), { timeout: 20_000 })
  await rm(watchedPath)
  expect((await removedResponse).status()).toBe(200)
  await expect(folderList.getByText("watch-created.cbz", { exact: true })).toHaveCount(0)
  await expect(folderCard).toHaveAttribute("data-selection-count", "1")
  await expect(stableWatchSelection).toHaveAttribute("aria-selected", "true")
  await stableWatchSelection.click({ modifiers: ["Control"] })
  await expect(folderCard).toHaveAttribute("data-selection-count", "0")
  const stableFolderTreeImage = await first.getAttribute("data-neoview-settings-image-instance")
  const folderTreeSettingPatches: Array<Record<string, unknown>> = []
  page.on("request", (request) => {
    if (request.url() !== `${backend.url}/reader/config` || request.method() !== "PATCH") return
    const body = request.postDataJSON() as { folderView?: { tree?: Record<string, unknown> } }
    if (body.folderView?.tree) folderTreeSettingPatches.push(body.folderView.tree)
  })
  const platformRootsResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/browser/roots` && response.request().method() === "GET"
  ))
  await selectFolderHandleAction(page, folderCard, "文件树")
  await expect.poll(() => folderTreeSettingPatches).toEqual([{ visible: true }])
  await folderCard.getByRole("radio", { name: "文件树位于顶部" }).click()
  await expect.poll(() => folderTreeSettingPatches).toEqual([{ visible: true }, { layout: "top" }])
  const folderTree = folderCard.locator('[data-neoview-folder-tree="true"]')
  await expect(folderTree).toBeVisible()
  const platformRoots = await (await platformRootsResponse).json() as { roots: Array<{ path: string; label: string; available: boolean }> }
  expect(platformRoots.roots.length).toBeGreaterThan(0)
  await expect(folderTree).toHaveAttribute("data-platform-root-count", String(platformRoots.roots.length))
  await expect(folderTree).toHaveAttribute("data-tree-root-count", String(platformRoots.roots.length))
  expect(platformRootRequests).toHaveLength(1)
  await expect(folderList).toBeVisible()
  await expect(folderCard.locator('[data-neoview-folder-tree-pane="true"]')).toBeVisible()
  await expect(folderTree.getByTitle(fixture.directory, { exact: true })).toBeVisible()
  const watchedTreePath = join(fixture.directory, "watch-tree-folder")
  const treeCreatedResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/tree/changes") && response.status() === 200
  ), { timeout: 20_000 })
  const treeListCreatedResponse = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname
    return path.endsWith("/changes") && !path.endsWith("/tree/changes") && response.status() === 200
  }, { timeout: 20_000 })
  await mkdir(watchedTreePath)
  expect((await treeCreatedResponse).status()).toBe(200)
  expect((await treeListCreatedResponse).status()).toBe(200)
  await expect(folderList.getByTitle(watchedTreePath, { exact: true })).toBeVisible()
  await folderTree.focus()
  const currentTreeRowAfterCreate = folderTree.locator('[data-current="true"]')
  await expect(currentTreeRowAfterCreate).toHaveAttribute("data-focused", "true")
  await folderTree.press("ArrowRight")
  await expect(folderTree.locator('[data-focused="true"]')).toHaveAttribute("data-tree-path", join(fixture.directory, "nested-search"))
  const watchedTreeRow = folderTree.locator('[data-focused="true"]')
  let focusedTreePath = await watchedTreeRow.getAttribute("data-tree-path")
  for (let step = 0; step < 32 && focusedTreePath !== watchedTreePath; step += 1) {
    await folderTree.press("ArrowDown")
    focusedTreePath = await watchedTreeRow.getAttribute("data-tree-path")
  }
  expect(focusedTreePath).toBe(watchedTreePath)
  await expect(folderTree.getByTitle(watchedTreePath, { exact: true })).toBeVisible()
  const treeRemovedResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/tree/changes") && response.status() === 200
  ), { timeout: 20_000 })
  const treeListRemovedResponse = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname
    return path.endsWith("/changes") && !path.endsWith("/tree/changes") && response.status() === 200
  }, { timeout: 20_000 })
  await rm(watchedTreePath, { recursive: true })
  expect((await treeRemovedResponse).status()).toBe(200)
  expect((await treeListRemovedResponse).status()).toBe(200)
  await expect(folderTree.getByTitle(watchedTreePath, { exact: true })).toHaveCount(0)
  await expect(folderList.getByTitle(watchedTreePath, { exact: true })).toHaveCount(0)
  await expect(folderTree.locator('[data-current="true"]')).toHaveAttribute("data-focused", "true")
  const treeResizeHandle = folderCard.getByRole("separator", { name: "调整文件树大小" })
  const treeResizeBox = await treeResizeHandle.boundingBox()
  expect(treeResizeBox).not.toBeNull()
  const treeResizeX = treeResizeBox!.x + treeResizeBox!.width / 2
  const treeResizeY = treeResizeBox!.y + treeResizeBox!.height / 2
  await treeResizeHandle.dispatchEvent("pointerdown", { pointerId: 17, clientX: treeResizeX, clientY: treeResizeY, buttons: 1 })
  for (let step = 1; step <= 40; step += 1) {
    await treeResizeHandle.dispatchEvent("pointermove", { pointerId: 17, clientX: treeResizeX, clientY: treeResizeY + step, buttons: 1 })
  }
  expect(folderTreeSettingPatches).toHaveLength(2)
  const treeSizeResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"tree":{"size":240}') === true
  ))
  await treeResizeHandle.dispatchEvent("pointerup", { pointerId: 17, clientX: treeResizeX, clientY: treeResizeY + 40, buttons: 0 })
  expect((await treeSizeResponse).status()).toBe(200)
  await expect.poll(() => folderTreeSettingPatches).toEqual([{ visible: true }, { layout: "top" }, { size: 240 }])
  const treeSettingsToml = await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")
  expect(treeSettingsToml).toContain("[nodes.neoview.folder]")
  expect(treeSettingsToml).toContain("visible = true")
  expect(treeSettingsToml).toContain('layout = "top"')
  expect(treeSettingsToml).toContain("size = 240")
  const originalTreeRow = folderTree.locator('[data-current="true"]')
  await expect(originalTreeRow).toHaveCount(1)
  const originalTreePath = await originalTreeRow.getAttribute("data-tree-path")
  expect(originalTreePath).toBeTruthy()
  const childTreeButton = folderTree.getByText("nested-search", { exact: true })
  await folderTree.focus()
  await expect(originalTreeRow).toHaveAttribute("data-focused", "true")
  await folderTree.press("ArrowDown")
  await expect(folderCard).toHaveAttribute("data-selection-count", "0")
  await expect(childTreeButton).toBeVisible()
  await expect(childTreeButton.locator("..")).toHaveAttribute("data-focused", "true")
  await folderTree.press("Enter")
  await expect(folderTree).toBeVisible()
  await expect(childTreeButton.locator("..")).toHaveAttribute("data-current", "true")
  await expect(folderList.getByText("recursive-result.png", { exact: true })).toBeVisible()
  await expect(folderList.getByText("xiranite.config.toml", { exact: true })).toHaveCount(0)
  const originalTreeButton = folderTree.getByTitle(originalTreePath!, { exact: true })
  await folderTree.press("ArrowLeft")
  await folderTree.press("ArrowLeft")
  await expect(originalTreeButton.locator("..")).toHaveAttribute("data-focused", "true")
  await folderTree.press("Enter")
  await expect(originalTreeButton.locator("..")).toHaveAttribute("data-current", "true")
  const childTreePath = await childTreeButton.locator("..").getAttribute("data-tree-path")
  expect(childTreePath).toBeTruthy()
  const pinTreeResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"pinnedPaths"') === true
  ))
  await childTreeButton.click({ button: "right" })
  await page.getByRole("menuitem", { name: "固定到文件树" }).click()
  expect((await pinTreeResponse).status()).toBe(200)
  await expect.poll(() => folderTreeSettingPatches.at(-1)).toEqual({ pinnedPaths: [childTreePath] })
  const pinnedTreeRow = folderTree.locator('[data-pinned-root="true"]').filter({ hasText: "nested-search" })
  await expect(pinnedTreeRow).toBeVisible()
  await expect(folderCard).toHaveAttribute("data-selection-count", "0")
  const refreshPinnedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith("/tree") && url.searchParams.get("path") === childTreePath && url.searchParams.get("refresh") === "1"
  })
  await pinnedTreeRow.click({ button: "right" })
  await page.getByRole("menuitem", { name: "刷新" }).click()
  expect((await refreshPinnedResponse).status()).toBe(200)
  const pinnedTreeToml = await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")
  expect(pinnedTreeToml).toContain(`pinned_paths = [ "${childTreePath!.replaceAll("\\", "\\\\")}" ]`)
  expect(await first.getAttribute("data-neoview-settings-image-instance")).toBe(stableFolderTreeImage)
  await folderTree.press("Control+f")
  await expect(folderTree).toBeVisible()
  const folderSearch = folderCard.locator('[data-neoview-folder-search="true"]')
  const folderSearchSettingPatches: Array<Record<string, unknown>> = []
  page.on("request", (request) => {
    if (request.url() !== `${backend.url}/reader/config` || request.method() !== "PATCH") return
    const body = request.postDataJSON() as { folderView?: { search?: Record<string, unknown> } }
    if (body.folderView?.search) folderSearchSettingPatches.push(body.folderView.search)
  })
  await expect(folderSearch).toBeVisible()
  const folderSearchInput = folderSearch.getByRole("textbox", { name: "搜索文件" })
  await expect(folderSearchInput).toBeFocused()
  await folderSearchInput.fill("xiranite.config.toml")
  const currentFolderSearchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith("/search") && url.searchParams.get("q") === "xiranite.config.toml"
  })
  const currentSearchHistoryResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/search-history")
    && response.request().method() === "POST"
    && response.request().postData()?.includes('"query":"xiranite.config.toml"') === true
  ))
  await folderSearch.getByRole("button", { name: "执行搜索" }).click()
  const currentFolderSearchUrl = new URL((await currentFolderSearchResponse).url())
  expect(currentFolderSearchUrl.searchParams.has("depth")).toBe(false)
  expect((await currentSearchHistoryResponse).status()).toBe(201)
  await expect(folderSearch.getByText("xiranite.config.toml", { exact: true })).toBeVisible()
  await folderSearch.getByRole("button", { name: "搜索历史", exact: true }).click()
  await expect(folderSearch.getByRole("button", { name: "使用搜索历史：xiranite.config.toml" })).toBeVisible()
  await folderSearch.getByRole("button", { name: "搜索历史", exact: true }).click()

  await folderSearch.getByRole("button", { name: "子目录" }).click()
  await folderSearch.getByRole("radio", { name: "仅文件", exact: true }).click()
  await folderSearch.getByRole("checkbox", { name: "匹配路径" }).check()
  await folderSearch.locator("button:has(svg.lucide-list-tree)").click()
  await folderSearch.getByRole("checkbox").nth(1).uncheck()
  await expect.poll(() => folderSearchSettingPatches).toEqual([
    { includeSubfolders: false },
    { searchInPath: true },
    { includeSubfolders: true },
    { showHistoryOnFocus: false },
  ])
  await folderSearchInput.fill("nested-search")
  const recursiveFolderSearchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith("/search") && url.searchParams.get("q") === "nested-search"
  })
  const recursiveSearchHistoryResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname.endsWith("/search-history")
    && response.request().method() === "POST"
    && response.request().postData()?.includes('"query":"nested-search"') === true
  ))
  await folderSearch.getByRole("button", { name: "执行搜索" }).click()
  const recursiveFolderSearchUrl = new URL((await recursiveFolderSearchResponse).url())
  expect(recursiveFolderSearchUrl.searchParams.has("depth")).toBe(false)
  expect(recursiveFolderSearchUrl.searchParams.get("kind")).toBe("file")
  expect(recursiveFolderSearchUrl.searchParams.get("path")).toBe("1")
  expect((await recursiveSearchHistoryResponse).status()).toBe(201)
  await expect(folderSearch.getByText("recursive-result.png", { exact: true })).toBeVisible()
  await folderSearch.getByRole("button", { name: "搜索历史", exact: true }).click()
  const deleteSearchHistoryResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith("/search-history")
      && response.request().method() === "DELETE"
      && url.searchParams.get("query") === "nested-search"
  })
  await folderSearch.getByRole("button", { name: "删除搜索历史：nested-search" }).click()
  expect((await deleteSearchHistoryResponse).status()).toBe(200)
  const clearSearchHistoryResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith("/search-history")
      && response.request().method() === "DELETE"
      && !url.searchParams.has("query")
  })
  await folderSearch.getByRole("button", { name: "清空搜索历史" }).click()
  expect((await clearSearchHistoryResponse).status()).toBe(200)
  const searchSettingsToml = await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")
  expect(searchSettingsToml).toContain("[nodes.neoview.folder]")
  expect(searchSettingsToml).toContain("include_subfolders = true")
  expect(searchSettingsToml).toContain("show_history_on_focus = false")
  expect(searchSettingsToml).toContain("search_in_path = true")
  expect(await first.getAttribute("data-neoview-settings-image-instance")).toBe("stable")
  await folderSearch.getByRole("button", { name: "关闭搜索" }).click()
  await expect(folderSearch).toHaveCount(0)
  await expect(folderCard.getByRole("listbox", { name: "文件项目" })).toBeVisible()
  const folderViewResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"viewMode":"details"') === true
  ))
  await selectFolderViewMode(page, folderCard, "详细信息")
  expect((await folderViewResponse).status()).toBe(200)
  await expect(leftSidebar.locator('[data-table-engine="niko-sparse"]')).toBeVisible()
  expect(await first.getAttribute("data-neoview-settings-image-instance")).toBe("stable")
  const folderColumnsResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"hiddenColumns":["tags"]') === true
  ))
  await leftSidebar.getByRole("combobox", { name: "管理详细信息列" }).click()
  const columnSearch = page.locator('[cmdk-input]')
  await columnSearch.fill("标签")
  await columnSearch.press("Enter")
  expect((await folderColumnsResponse).status()).toBe(200)
  const nameResizeHandle = leftSidebar.getByRole("separator", { name: "调整 name 列宽" })
  let nameResizeBox = await nameResizeHandle.boundingBox()
  await expect.poll(async () => {
    nameResizeBox = await nameResizeHandle.boundingBox().catch(() => null)
    return nameResizeBox
  }).not.toBeNull()
  const folderWidthResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"columnWidths"') === true
  ))
  await page.mouse.move(nameResizeBox!.x + nameResizeBox!.width / 2, nameResizeBox!.y + nameResizeBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(nameResizeBox!.x + nameResizeBox!.width / 2 + 48, nameResizeBox!.y + nameResizeBox!.height / 2, { steps: 4 })
  await page.mouse.up()
  const savedFolderWidth = await folderWidthResponse
  expect(savedFolderWidth.status()).toBe(200)
  expect((savedFolderWidth.request().postDataJSON() as { folderView: { details: { columnWidths: { name: number } } } }).folderView.details.columnWidths.name).toBeGreaterThan(220)
  const folderToml = await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")
  expect(folderToml).toContain("[nodes.neoview.folder]")
  expect(folderToml).toContain('view_mode = "details"')
  expect(folderToml).toContain("[nodes.neoview.folder.details]")
  expect(folderToml).toMatch(/hidden_columns\s*=\s*\[\s*"tags"\s*\]/)
  expect(folderToml).not.toContain("[nodes.neoview.folder.details.column_widths]")
  expect(folderToml).toMatch(/name\s*=\s*2[5-9]\d/)
  expect(await first.getAttribute("data-neoview-settings-image-instance")).toBe("stable")
  await page.keyboard.press("Escape")
  await expect(page.locator('[cmdk-item]')).toHaveCount(0)
  await page.mouse.move(1, page.viewportSize()!.height / 2)
  await expect(leftSidebar).toBeVisible()
  await leftSidebar.getByRole("button", { name: "设置", exact: true }).click()
  await expect(page.locator('[data-reader-card="面板布局设置"]')).toBeVisible()
  await expect(page.locator('[data-reader-card="边栏管理设置"]')).toBeVisible()
  await expect(page.locator('[data-neoview-panel-layout-editor="true"]')).toBeVisible()
  await expect(page.locator('[data-neoview-settings-card="sidebar-management"]')).toBeVisible()
  await leftSidebar.getByRole("button", { name: "页面列表", exact: true }).click()
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
  await first.evaluate((image) => image.setAttribute("data-neoview-image-instance", "before-card-resize"))
  let cardHeightPatchRequests = 0
  page.on("request", (request) => {
    if (
      request.url() === `${backend.url}/reader/config`
      && request.method() === "PATCH"
      && request.postData()?.includes('"cardId":"page-navigation"')
      && request.postData()?.includes('"height"')
    ) cardHeightPatchRequests += 1
  })
  const cardHeightHandle = page.getByRole("button", { name: "调整页面导航高度" })
  const cardContent = page.locator('[data-reader-card-content="页面导航"]')
  const cardHandleBox = await cardHeightHandle.boundingBox()
  expect(cardHandleBox).not.toBeNull()
  const cardStartHeight = await cardContent.evaluate((element) => element.getBoundingClientRect().height)
  const cardPatchResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"cardId":"page-navigation"') === true
    && response.request().postData()?.includes('"height"') === true
  ))
  const cardStartX = cardHandleBox!.x + cardHandleBox!.width / 2
  const cardStartY = cardHandleBox!.y + cardHandleBox!.height / 2
  await cardHeightHandle.dispatchEvent("pointerdown", { pointerId: 19, clientX: cardStartX, clientY: cardStartY, buttons: 1 })
  for (let step = 1; step <= 40; step += 1) {
    await cardHeightHandle.dispatchEvent("pointermove", { pointerId: 19, clientX: cardStartX, clientY: cardStartY + step * 2, buttons: 1 })
  }
  await cardHeightHandle.dispatchEvent("pointerup", { pointerId: 19, clientX: cardStartX, clientY: cardStartY + 80, buttons: 0 })
  expect((await cardPatchResponse).status()).toBe(200)
  expect(cardHeightPatchRequests).toBe(1)
  expect(await cardContent.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(cardStartHeight)
  expect(await first.getAttribute("data-neoview-image-instance")).toBe("before-card-resize")
  expect(await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")).toMatch(/height = \d+/)

  const cardResetResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"height":null') === true
  ))
  await cardHeightHandle.dblclick()
  expect((await cardResetResponse).status()).toBe(200)
  expect(cardHeightPatchRequests).toBe(2)
  expect(await cardContent.evaluate((element) => (element as HTMLElement).style.height)).toBe("")
  expect(await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")).toContain('height = "auto"')
  expect(await first.getAttribute("data-neoview-image-instance")).toBe("before-card-resize")

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
  await page.mouse.move(viewport.width / 2, viewport.height - 1)
  await expect(bottomEdge).toBeVisible()
  await expect(bottomEdge).toHaveAttribute("data-pinned", "false")
  await page.locator('[data-reader-viewport="true"]').click({ position: { x: viewport.width / 2, y: viewport.height / 2 }, force: true })
  await page.mouse.move(viewport.width / 2, viewport.height / 2)
  await expect(bottomEdge).toHaveCount(0, { timeout: 1_500 })
  await expect(page.getByTestId("neoview-thumbnail-viewport")).toHaveCount(0)
  await expect.poll(() => page.evaluate(({ mark, pageIndex }) => (
    performance.getEntriesByName(mark).some((entry) => (entry as PerformanceMark).detail === pageIndex)
  ), { mark: READER_PREFETCH_READY_MARK, pageIndex: 1 })).toBe(true)
  await page.mouse.move(viewport.width / 2, viewport.height - 1)
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

test("[neoview.folder.delete-batch-e2e] keeps a sparse batch alive while the File Card auto-hides", async ({ page }) => {
  const operationRoot = join(fixture.directory, "zz-selection-operation")
  await mkdir(operationRoot, { recursive: true })
  await Promise.all(Array.from({ length: 3 }, (_, index) => writeFile(join(operationRoot, `batch-${index}.cbz`), "")))
  let selectionOperationRequest: Record<string, unknown> | undefined
  let selectionOperationPolls = 0
  let browserSessionOpens = 0
  const snapshot = (status: "running" | "completed", processed: number) => ({
    id: "e2e-selection-operation",
    kind: "trash",
    status,
    generation: 1,
    total: 3,
    processed,
    succeeded: status === "completed" ? 3 : processed,
    failed: 0,
    cancelled: 0,
    failureSamples: [],
    failureSamplesTruncated: false,
    startedAt: 1,
    ...(status === "completed" ? { completedAt: 2 } : {}),
  })

  try {
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/reader/browser/sessions") browserSessionOpens += 1
    })
    await page.route("**/reader/files/selection-operations**", async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      if (request.method() === "POST" && pathname === "/reader/files/selection-operations") {
        selectionOperationRequest = request.postDataJSON() as Record<string, unknown>
        await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(snapshot("running", 0)) })
        return
      }
      if (request.method() === "GET" && pathname === "/reader/files/selection-operations/e2e-selection-operation") {
        selectionOperationPolls += 1
        if (selectionOperationPolls === 1) await new Promise((resolve) => setTimeout(resolve, 1_500))
        const next = selectionOperationPolls < 2 ? snapshot("running", 1) : snapshot("completed", 3)
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(next) })
        return
      }
      await route.fallback()
    })

    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    const image = page.locator("img[data-reader-page-image]").first()
    await expect(image).toBeVisible({ timeout: 20_000 })
    await image.evaluate((element) => element.setAttribute("data-batch-image-instance", "stable"))
    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const leftPanelToggle = page.getByRole("button", { name: "左侧边栏", exact: true })
    if (await leftPanelToggle.getAttribute("aria-pressed") !== "true") await leftPanelToggle.click()
    await expect(leftPanelToggle).toHaveAttribute("aria-pressed", "true")
    let folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    const folderPane = page.locator('[data-neoview-folder-pane="true"]')
    await folderPane.evaluate((element) => element.setAttribute("data-batch-card-instance", "stable"))
    const breadcrumb = folderCard.locator('[data-neoview-folder-breadcrumb="true"]')
    const editPath = breadcrumb.getByRole("button", { name: "编辑路径" })
    await editPath.focus()
    await editPath.press("Enter")
    const input = breadcrumb.getByRole("textbox", { name: "浏览路径" })
    await input.fill(operationRoot)
    await input.press("Enter")
    await expect(folderCard).toHaveAttribute("data-selection-total", "3")

    await selectFolderHandleAction(page, folderCard, "多选模式")
    let selectionBar = folderCard.locator('[data-neoview-folder-selection-bar="true"]')
    await selectionBar.getByRole("button", { name: "选择全部项目" }).click()
    await expect(folderCard).toHaveAttribute("data-selection-count", "3")
    await selectionBar.getByRole("button", { name: "将所选项目移到回收站" }).click()
    const confirmation = page.getByRole("alertdialog")
    await expect(confirmation).toContainText("将 3 个项目移到回收站？")
    await confirmation.getByRole("button", { name: "移到回收站" }).click()
    await leftPanelToggle.click()
    await page.mouse.move(page.viewportSize()!.width - 1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeHidden()
    await expect(folderPane).toHaveAttribute("data-batch-card-instance", "stable")
    await leftPanelToggle.click()
    await expect(leftSidebar).toBeVisible()
    folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    selectionBar = folderCard.locator('[data-neoview-folder-selection-bar="true"]')
    await expect(folderCard).toHaveAttribute("data-batch-card-instance", "stable")
    await expect(selectionBar).toHaveAttribute("data-selection-operation", "running")

    await leftPanelToggle.click()
    await page.mouse.move(page.viewportSize()!.width - 1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeHidden()
    await expect(folderPane).toHaveAttribute("data-batch-card-instance", "stable")
    await page.waitForTimeout(1_800)
    await leftPanelToggle.click()
    await expect(leftSidebar).toBeVisible()
    folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    selectionBar = folderCard.locator('[data-neoview-folder-selection-bar="true"]')
    await expect(selectionBar.getByRole("status")).toContainText("已将 3 项移到回收站")
    await expect(folderCard).toHaveAttribute("data-selection-count", "0")
    await expect(folderCard).toHaveAttribute("data-batch-card-instance", "stable")
    expect(await image.getAttribute("data-batch-image-instance")).toBe("stable")
    expect(browserSessionOpens).toBe(1)
    expect(selectionOperationPolls).toBeGreaterThanOrEqual(2)
    expect(selectionOperationRequest).toMatchObject({
      sessionId: expect.stringMatching(/^browser-/),
      selection: { allSelected: true, ranges: [], explicit: [] },
      kind: "trash",
      confirmed: true,
    })
  } finally {
    await rm(operationRoot, { recursive: true, force: true })
  }
})

test("[neoview.folder.clipboard-e2e] copies and moves files across current-directory views without reloading the File Card", async ({ page }) => {
  const root = join(fixture.directory, "zz-folder-clipboard")
  const source = join(root, "source")
  const copyTarget = join(root, "copied")
  const moveTarget = join(root, "moved")
  const first = join(source, "first.cbz")
  const second = join(source, "second.cbz")
  await Promise.all([mkdir(source, { recursive: true }), mkdir(copyTarget, { recursive: true }), mkdir(moveTarget, { recursive: true })])
  await Promise.all([writeFile(first, "first"), writeFile(second, "second")])
  let browserSessionOpens = 0

  try {
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/reader/browser/sessions") browserSessionOpens += 1
    })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    const image = page.locator("img[data-reader-page-image]").first()
    await expect(image).toBeVisible({ timeout: 20_000 })
    await image.evaluate((element) => element.setAttribute("data-clipboard-image-instance", "stable"))
    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const folderPane = page.locator('[data-neoview-folder-pane="true"]')
    await folderPane.evaluate((element) => element.setAttribute("data-clipboard-card-instance", "stable"))
    const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')

    const navigatePath = async (path: string) => {
      const breadcrumb = folderCard.locator('[data-neoview-folder-breadcrumb="true"]')
      const editPath = breadcrumb.getByRole("button", { name: "编辑路径" })
      await editPath.focus()
      await editPath.press("Enter")
      const input = breadcrumb.getByRole("textbox", { name: "浏览路径" })
      await input.fill(path)
      await input.press("Enter")
      await expect(breadcrumb.locator('[aria-current="page"]')).toHaveAttribute("title", path)
    }

    await navigatePath(source)
    await expect(folderCard).toHaveAttribute("data-selection-total", "2")
    await selectFolderHandleAction(page, folderCard, "多选模式")
    let selectionBar = folderCard.locator('[data-neoview-folder-selection-bar="true"]')
    await selectionBar.getByRole("button", { name: "选择全部项目" }).click()
    await selectionBar.getByRole("button", { name: "复制所选项目" }).click()
    await expect(selectionBar.getByRole("button", { name: "粘贴到当前目录" })).toBeEnabled()
    await selectionBar.getByRole("button", { name: "关闭多选模式" }).click()

    await navigatePath(copyTarget)
    await folderCard.getByRole("button", { name: "粘贴到当前目录" }).click()
    await expect(folderCard.getByTitle(join(copyTarget, "first.cbz"), { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(folderCard.getByTitle(join(copyTarget, "second.cbz"), { exact: true })).toBeVisible()
    await expect.poll(() => pathExists(join(copyTarget, "first.cbz"))).toBe(true)
    await expect.poll(() => pathExists(first)).toBe(true)

    await selectFolderHandleAction(page, folderCard, "多选模式")
    await folderCard.getByTitle(join(copyTarget, "first.cbz"), { exact: true }).click({ modifiers: ["Control"] })
    selectionBar = folderCard.locator('[data-neoview-folder-selection-bar="true"]')
    await expect(folderCard).toHaveAttribute("data-selection-count", "1")
    await selectionBar.getByRole("button", { name: "剪切所选项目" }).click()
    await selectionBar.getByRole("button", { name: "关闭多选模式" }).click()

    await navigatePath(moveTarget)
    await folderCard.getByRole("button", { name: "粘贴到当前目录" }).click()
    await expect(folderCard.getByTitle(join(moveTarget, "first.cbz"), { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => pathExists(join(copyTarget, "first.cbz"))).toBe(false)
    await expect.poll(() => pathExists(join(moveTarget, "first.cbz"))).toBe(true)
    expect(await folderPane.getAttribute("data-clipboard-card-instance")).toBe("stable")
    expect(await image.getAttribute("data-clipboard-image-instance")).toBe("stable")
    expect(browserSessionOpens).toBe(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("[neoview.folder.filter-e2e] filters the current directory without reopening the File Card", async ({ page }) => {
  const root = join(fixture.directory, "zz-folder-filter")
  const folderPath = join(root, "folder")
  const archivePath = join(root, "book.cbz")
  const videoPath = join(root, "clip.mp4")
  const textPath = join(root, "note.txt")
  await mkdir(folderPath, { recursive: true })
  await Promise.all([writeFile(archivePath, ""), writeFile(videoPath, ""), writeFile(textPath, "")])
  let browserSessionOpens = 0
  const filterRequests: string[] = []

  try {
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname
      if (request.method() === "POST" && pathname === "/reader/browser/sessions") browserSessionOpens += 1
      if (request.method() === "PATCH" && pathname.endsWith("/filter")) {
        filterRequests.push((request.postDataJSON() as { filter: string }).filter)
      }
    })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    const image = page.locator("img[data-reader-page-image]").first()
    await expect(image).toBeVisible({ timeout: 20_000 })
    await image.evaluate((element) => element.setAttribute("data-filter-image-instance", "stable"))
    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const folderPane = page.locator('[data-neoview-folder-pane="true"]')
    await folderPane.evaluate((element) => element.setAttribute("data-filter-card-instance", "stable"))
    const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    const breadcrumb = folderCard.locator('[data-neoview-folder-breadcrumb="true"]')
    const editPath = breadcrumb.getByRole("button", { name: "编辑路径" })
    await editPath.focus()
    await editPath.press("Enter")
    const input = breadcrumb.getByRole("textbox", { name: "浏览路径" })
    await input.fill(root)
    await input.press("Enter")
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveAttribute("title", root)
    await expect(folderCard).toHaveAttribute("data-selection-total", "4")

    await selectFolderHandleAction(page, folderCard, "类型筛选")
    const filterBar = folderCard.locator('[data-folder-type-filter-bar="true"]')
    await expect(filterBar).toBeVisible()
    await expect(filterBar).toHaveCSS("overflow", "visible")

    await filterBar.getByRole("button", { name: "压缩包" }).click()
    await expect(folderCard).toHaveAttribute("data-selection-total", "1")
    await expect(folderCard.getByTitle(archivePath, { exact: true })).toBeVisible()
    await expect(folderCard.getByTitle(folderPath, { exact: true })).toHaveCount(0)

    await filterBar.getByRole("button", { name: "文件夹" }).click()
    await expect(folderCard.getByTitle(folderPath, { exact: true })).toBeVisible()
    await expect(folderCard.getByTitle(archivePath, { exact: true })).toHaveCount(0)

    await filterBar.getByRole("button", { name: "视频" }).click()
    await expect(folderCard.getByTitle(videoPath, { exact: true })).toBeVisible()
    await expect(folderCard.getByTitle(textPath, { exact: true })).toHaveCount(0)

    await filterBar.getByRole("button", { name: "全部" }).click()
    await expect(folderCard).toHaveAttribute("data-selection-total", "4")
    expect(filterRequests).toEqual(["archive", "directory", "video", "all"])
    expect(browserSessionOpens).toBe(1)
    expect(await folderPane.getAttribute("data-filter-card-instance")).toBe("stable")
    expect(await image.getAttribute("data-filter-image-instance")).toBe("stable")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("[neoview.folder.single-click-open-e2e] opens folders and files while modified clicks select", async ({ page }) => {
  const clickRoot = join(fixture.directory, "zz-single-click-open")
  const nested = join(clickRoot, "nested")
  const book = join(clickRoot, "book.cbz")
  await mkdir(nested, { recursive: true })
  await writeFile(book, "")
  let readerOpenRequests = 0

  try {
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/reader/sessions") readerOpenRequests += 1
    })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    await expect(page.locator("img[data-reader-page-image]").first()).toBeVisible({ timeout: 20_000 })

    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    const breadcrumb = folderCard.locator('[data-neoview-folder-breadcrumb="true"]')
    const editPath = breadcrumb.getByRole("button", { name: "编辑路径" })
    await editPath.focus()
    await editPath.press("Enter")
    const input = breadcrumb.getByRole("textbox", { name: "浏览路径" })
    await input.fill(clickRoot)
    await input.press("Enter")
    await expect(folderCard).toHaveAttribute("data-selection-total", "2")

    await folderCard.getByTitle(nested, { exact: true }).click()
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveAttribute("title", nested)
    expect(readerOpenRequests).toBe(1)

    await folderCard.getByRole("button", { name: "后退" }).click()
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveAttribute("title", clickRoot)
    const bookEntry = folderCard.getByTitle(book, { exact: true })
    await bookEntry.click({ modifiers: ["Control"] })
    await expect(folderCard).toHaveAttribute("data-selection-count", "1")
    expect(readerOpenRequests).toBe(1)

    const openedBook = page.waitForRequest((request) => request.method() === "POST"
      && new URL(request.url()).pathname === "/reader/sessions"
      && request.postDataJSON().path === book)
    await bookEntry.click()
    await openedBook
    expect(readerOpenRequests).toBe(2)
  } finally {
    await rm(clickRoot, { recursive: true, force: true })
  }
})

test("[neoview.folder.path-navigation] keeps breadcrumb navigation scoped to the current directory", async ({ page }) => {
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()
  await expect(page.locator("img[data-reader-page-image]").first()).toBeVisible({ timeout: 15_000 })

  const leftSidebar = page.locator('[data-reader-sidebar="left"]')
  if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
  await expect(leftSidebar).toBeVisible()
  const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
  const breadcrumb = folderCard.locator('[data-neoview-folder-breadcrumb="true"]')
  const currentBreadcrumb = breadcrumb.locator('[aria-current="page"]')
  await expect(currentBreadcrumb).toHaveAttribute("title", fixture.directory)
  const startPathEdit = async () => {
    const edit = breadcrumb.getByRole("button", { name: "编辑路径" })
    await edit.focus()
    await edit.press("Enter")
  }

  await startPathEdit()
  const pathInput = breadcrumb.getByRole("textbox", { name: "浏览路径" })
  await expect(pathInput).toHaveValue(fixture.directory)
  await pathInput.fill(join(fixture.directory, "cancelled"))
  await pathInput.press("Escape")
  await expect(currentBreadcrumb).toHaveAttribute("title", fixture.directory)

  const nestedPath = join(fixture.directory, "nested-search")
  await startPathEdit()
  await breadcrumb.getByRole("textbox", { name: "浏览路径" }).fill(nestedPath)
  await breadcrumb.getByRole("textbox", { name: "浏览路径" }).press("Enter")
  await expect(currentBreadcrumb).toHaveAttribute("title", nestedPath)
  const folderList = folderCard.getByRole("listbox", { name: "文件项目" })
  await expect(folderList.getByText("recursive-result.png", { exact: true })).toBeVisible()
  await expect(folderList.getByText("xiranite.config.toml", { exact: true })).toHaveCount(0)

  const parentName = fixture.directory.split(/[\\/]/).at(-1)!
  const parentSegment = breadcrumb.getByRole("button", { name: parentName })
  if (await parentSegment.count()) {
    await parentSegment.focus()
    await parentSegment.press("Enter")
  } else {
    const collapsed = breadcrumb.getByRole("button", { name: "显示折叠路径" })
    await collapsed.focus()
    await collapsed.press("Enter")
    const parentMenuItem = page.getByRole("menuitem", { name: parentName })
    await parentMenuItem.focus()
    await parentMenuItem.press("Enter")
  }
  await expect(currentBreadcrumb).toHaveAttribute("title", fixture.directory)
  await startPathEdit()
  await breadcrumb.getByRole("textbox", { name: "浏览路径" }).fill(nestedPath)
  await breadcrumb.getByRole("textbox", { name: "浏览路径" }).press("Enter")
  await expect(currentBreadcrumb).toHaveAttribute("title", nestedPath)
  await currentBreadcrumb.focus()
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(currentBreadcrumb).toHaveAttribute("title", fixture.directory)

  await startPathEdit()
  await breadcrumb.getByRole("textbox", { name: "浏览路径" }).fill(join(fixture.directory, "missing-breadcrumb"))
  await breadcrumb.getByRole("textbox", { name: "浏览路径" }).press("Enter")
  await expect(folderCard.getByRole("alert")).toBeVisible()
  await expect(currentBreadcrumb).toHaveAttribute("title", fixture.directory)
})

test("[neoview.folder.parent-locate-e2e] selects the departed child across sparse virtual renderers", async ({ page }) => {
  const parentPath = join(fixture.directory, "zz-parent-locate")
  const childName = "zz-selected-child"
  const childPath = join(parentPath, childName)
  const nestedMarker = "nested-only.png"
  await mkdir(childPath, { recursive: true })
  await writeFile(join(childPath, nestedMarker), ONE_PIXEL_PNG)
  await Promise.all(Array.from({ length: 400 }, (_, index) => (
    mkdir(join(parentPath, `item-${String(index).padStart(3, "0")}`))
  )))

  try {
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    await expect(page.locator("img[data-reader-page-image]").first()).toBeVisible()

    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    const breadcrumb = folderCard.locator('[data-neoview-folder-breadcrumb="true"]')
    const currentBreadcrumb = breadcrumb.locator('[aria-current="page"]')
    const navigatePath = async (path: string) => {
      const edit = breadcrumb.getByRole("button", { name: "编辑路径" })
      await edit.focus()
      await edit.press("Enter")
      const input = breadcrumb.getByRole("textbox", { name: "浏览路径" })
      await input.fill(path)
      await input.press("Enter")
      await expect(currentBreadcrumb).toHaveAttribute("title", path)
    }
    const goUp = async () => {
      await currentBreadcrumb.focus()
      await page.keyboard.press("Alt+ArrowUp")
      await expect(currentBreadcrumb).toHaveAttribute("title", parentPath)
      await expect(folderCard).toHaveAttribute("data-selection-count", "1")
      await expect(folderCard.getByRole("listbox", { name: "文件项目" })).toHaveAttribute("data-focused-index", "400")
    }

    await navigatePath(childPath)
    await expect(folderCard.getByText(nestedMarker, { exact: true })).toBeVisible()
    await selectFolderViewMode(page, folderCard, "紧凑列表")
    const sparsePage = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname.endsWith("/entries") && url.searchParams.get("cursor") === "384"
    })
    await goUp()
    expect((await sparsePage).status()).toBe(200)
    const compactChild = folderCard.getByTitle(childPath, { exact: true })
    await expect(compactChild).toBeVisible()
    await expect(compactChild).toHaveAttribute("aria-selected", "true")
    await expect(folderCard.getByText(nestedMarker, { exact: true })).toHaveCount(0)

    await navigatePath(childPath)
    await selectFolderViewMode(page, folderCard, "封面网格")
    await goUp()
    const gridChild = folderCard.getByTitle(childPath, { exact: true })
    await expect(gridChild).toBeVisible()
    await expect(gridChild).toHaveAttribute("aria-selected", "true")
    await expect(gridChild).toHaveAttribute("data-preview-mode", "cover-grid")

    await navigatePath(childPath)
    await selectFolderViewMode(page, folderCard, "详细信息")
    await goUp()
    const detailsHost = folderCard.getByTestId("folder-details-host")
    const detailsChild = detailsHost.getByText(childName, { exact: true }).locator("xpath=ancestor::tr")
    await expect(detailsChild).toBeVisible()
    await expect(detailsChild).toHaveAttribute("data-state", "selected")
  } finally {
    await rm(parentPath, { recursive: true, force: true })
  }
})

test("[neoview.folder.nav-history-e2e] restores each Explorer-style directory visit independently", async ({ page }) => {
  const historyRoot = join(fixture.directory, "zz-history")
  const firstPath = join(historyRoot, "A")
  const secondPath = join(historyRoot, "B")
  await mkdir(firstPath, { recursive: true })
  await mkdir(secondPath, { recursive: true })
  await Promise.all([
    ...Array.from({ length: 120 }, (_, index) => writeFile(join(firstPath, `history-${String(index).padStart(3, "0")}.cbz`), "")),
    ...Array.from({ length: 40 }, (_, index) => writeFile(join(secondPath, `branch-${String(index).padStart(3, "0")}.cbz`), "")),
  ])

  try {
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    const image = page.locator("img[data-reader-page-image]").first()
    await expect(image).toBeVisible()
    await image.evaluate((element) => element.setAttribute("data-folder-restore-image-instance", "stable"))

    const navigationFocusPaths: Array<string | undefined> = []
    page.on("request", (request) => {
      if (!request.url().includes("/reader/browser/s/") || !request.url().endsWith("/navigate") || request.method() !== "POST") return
      navigationFocusPaths.push((request.postDataJSON() as { focusPath?: string }).focusPath)
    })

    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    const breadcrumb = folderCard.locator('[data-neoview-folder-breadcrumb="true"]')
    const currentBreadcrumb = breadcrumb.locator('[aria-current="page"]')
    const navigatePath = async (path: string) => {
      const edit = breadcrumb.getByRole("button", { name: "编辑路径" })
      await edit.focus()
      await edit.press("Enter")
      const input = breadcrumb.getByRole("textbox", { name: "浏览路径" })
      await input.fill(path)
      await input.press("Enter")
      await expect(currentBreadcrumb).toHaveAttribute("title", path)
    }

    await navigatePath(firstPath)
    const folderList = folderCard.getByRole("listbox", { name: "文件项目" })
    await expect(folderList.getByText("history-000.cbz", { exact: true })).toBeVisible()
    await expect(folderList.getByText("branch-000.cbz", { exact: true })).toHaveCount(0)
    await selectFolderViewMode(page, folderCard, "详细信息")
    const detailsHost = folderCard.getByTestId("folder-details-host")
    const detailsScroll = detailsHost.locator('[data-slot="table-container"]')
    await expect(detailsScroll).toBeVisible()
    await detailsScroll.evaluate((element) => {
      element.scrollTop = 960
      element.dispatchEvent(new Event("scroll"))
    })
    await expect.poll(() => detailsScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(900)
    const firstVisitRow = detailsHost.getByText("history-030.cbz", { exact: true }).locator("xpath=ancestor::tr")
    await expect(firstVisitRow).toBeVisible()
    await firstVisitRow.click({ modifiers: ["Control"] })
    await expect(firstVisitRow).toHaveAttribute("data-state", "selected")
    await detailsScroll.evaluate((element) => {
      element.scrollTop = 960
      element.dispatchEvent(new Event("scroll"))
    })
    const savedScrollTop = await detailsScroll.evaluate((element) => element.scrollTop)

    await navigatePath(secondPath)
    await expect(folderCard.getByText("branch-000.cbz", { exact: true })).toBeVisible()
    await expect(folderCard.getByText("history-000.cbz", { exact: true })).toHaveCount(0)
    await navigatePath(firstPath)
    await selectFolderViewMode(page, folderCard, "紧凑列表")
    const secondVisitItem = folderCard.getByTitle(join(firstPath, "history-000.cbz"), { exact: true })
    await secondVisitItem.click({ modifiers: ["Control"] })
    await expect(secondVisitItem).toHaveAttribute("aria-selected", "true")

    await currentBreadcrumb.focus()
    await page.keyboard.press("Alt+ArrowLeft")
    await expect(currentBreadcrumb).toHaveAttribute("title", secondPath)
    await currentBreadcrumb.focus()
    await page.keyboard.press("Alt+ArrowLeft")
    await expect(currentBreadcrumb).toHaveAttribute("title", firstPath)
    await expect(folderCard).toHaveAttribute("data-folder-view-mode", "details")
    await expect(detailsScroll).toBeVisible()
    await expect.poll(async () => Math.abs(
      await detailsScroll.evaluate((element) => element.scrollTop) - savedScrollTop,
    )).toBeLessThanOrEqual(40)
    await expect(firstVisitRow).toHaveAttribute("data-state", "selected")
    await expect(folderCard).toHaveAttribute("data-selection-count", "1")

    await currentBreadcrumb.focus()
    await page.keyboard.press("Alt+ArrowRight")
    await expect(currentBreadcrumb).toHaveAttribute("title", secondPath)

    await writeFile(join(firstPath, "history-000a.cbz"), "")
    await currentBreadcrumb.focus()
    await page.keyboard.press("Alt+ArrowLeft")
    await expect(currentBreadcrumb).toHaveAttribute("title", firstPath)
    await expect(folderCard.getByRole("listbox", { name: "文件项目" })).toHaveAttribute("data-focused-index", "31")
    await expect(firstVisitRow).toBeVisible()
    await expect(firstVisitRow).toHaveAttribute("data-state", "selected")
    expect(navigationFocusPaths).toContain(join(firstPath, "history-030.cbz"))
    expect(await image.getAttribute("data-folder-restore-image-instance")).toBe("stable")

    await currentBreadcrumb.focus()
    await page.keyboard.press("Alt+ArrowRight")
    await expect(currentBreadcrumb).toHaveAttribute("title", secondPath)
    await navigatePath(historyRoot)
    await expect(folderCard.getByRole("button", { name: "前进" })).toBeDisabled()
  } finally {
    await rm(historyRoot, { recursive: true, force: true })
  }
})

test("[neoview.folder.nav-visual-state-e2e] restores grid position and cached thumbnails before revalidation", async ({ page }) => {
  const root = join(fixture.directory, "zz-navigation-visual-state")
  const firstPath = join(root, "A")
  const secondPath = join(root, "B")
  await Promise.all([mkdir(firstPath, { recursive: true }), mkdir(secondPath, { recursive: true })])
  await Promise.all([
    ...Array.from({ length: 80 }, (_, index) => writeFile(join(firstPath, `image-${String(index).padStart(3, "0")}.png`), ONE_PIXEL_PNG)),
    writeFile(join(secondPath, "other.png"), ONE_PIXEL_PNG),
  ])
  const thumbnailRegistrations: string[][] = []

  try {
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    page.on("request", (request) => {
      if (request.method() !== "POST" || new URL(request.url()).pathname !== "/reader/library/thumbnails") return
      const body = request.postDataJSON() as { items?: Array<{ path?: string }> }
      thumbnailRegistrations.push(body.items?.flatMap((item) => item.path ? [item.path] : []) ?? [])
    })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    const breadcrumb = folderCard.locator('[data-neoview-folder-breadcrumb="true"]')
    const currentBreadcrumb = breadcrumb.locator('[aria-current="page"]')
    const navigatePath = async (path: string) => {
      const edit = breadcrumb.getByRole("button", { name: "编辑路径" })
      await edit.focus()
      await edit.press("Enter")
      const input = breadcrumb.getByRole("textbox", { name: "浏览路径" })
      await input.fill(path)
      await input.press("Enter")
      await expect(currentBreadcrumb).toHaveAttribute("title", path)
    }

    await navigatePath(firstPath)
    await selectFolderViewMode(page, folderCard, "封面网格")
    const gridScroll = folderCard.locator('[data-testid="virtuoso-scroller"]')
    await expect(gridScroll).toBeVisible()
    await gridScroll.evaluate((element) => { element.scrollTop = 1_500; element.dispatchEvent(new Event("scroll")) })
    await expect.poll(() => gridScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(1_200)
    await expect.poll(() => folderCard.locator('[data-folder-entry="true"] img').count()).toBeGreaterThan(0)
    await expect.poll(async () => Number(await folderCard.getAttribute("data-thumbnail-cache-size"))).toBeGreaterThan(0)
    const savedScrollTop = await gridScroll.evaluate((element) => element.scrollTop)
    const savedNavigationEntryId = await gridScroll.getAttribute("data-folder-navigation-entry-id")
    const savedThumbnails = await folderCard.locator('[data-folder-entry="true"]').evaluateAll((entries) => Object.fromEntries(entries.flatMap((entry) => {
      const path = (entry as HTMLElement).dataset.folderPath
      const source = entry.querySelector<HTMLImageElement>("img")?.src
      return path && source ? [[path, source]] : []
    })))
    const savedThumbnailPaths = Object.keys(savedThumbnails)

    await navigatePath(secondPath)
    await expect.poll(() => folderCard.locator('[data-folder-entry="true"] img').count()).toBeGreaterThan(0)
    const secondThumbnails = await folderCard.locator('[data-folder-entry="true"]').evaluateAll((entries) => Object.fromEntries(entries.flatMap((entry) => {
      const path = (entry as HTMLElement).dataset.folderPath
      const source = entry.querySelector<HTMLImageElement>("img")?.src
      return path && source ? [[path, source]] : []
    })))
    const registrationsBeforeBack = thumbnailRegistrations.filter((batch) => batch.some((path) => savedThumbnailPaths.includes(path))).length
    await folderCard.getByRole("button", { name: "后退" }).click()
    await expect(currentBreadcrumb).toHaveAttribute("title", firstPath)
    await expect(gridScroll).toHaveAttribute("data-folder-navigation-entry-id", savedNavigationEntryId!)
    await expect(gridScroll).toHaveAttribute("data-folder-restore-scroll-top", String(savedScrollTop))
    await expect.poll(async () => Number(await folderCard.getAttribute("data-restored-thumbnail-cache-size"))).toBeGreaterThan(0)
    await expect.poll(async () => Math.abs(await gridScroll.evaluate((element) => element.scrollTop) - savedScrollTop)).toBeLessThanOrEqual(40)
    await expect.poll(async () => folderCard.locator('[data-folder-entry="true"]').evaluateAll((entries, expected) => entries.some((entry) => {
      const path = (entry as HTMLElement).dataset.folderPath
      const source = entry.querySelector<HTMLImageElement>("img")?.src
      return Boolean(path && source && expected[path] === source)
    }), savedThumbnails)).toBe(true)
    const savedCapability = Object.values(savedThumbnails)[0]
    expect(savedCapability).toBeTruthy()
    expect((await page.request.get(savedCapability!)).status()).toBe(200)
    await page.waitForTimeout(250)
    expect(thumbnailRegistrations.filter((batch) => batch.some((path) => savedThumbnailPaths.includes(path)))).toHaveLength(registrationsBeforeBack)

    await folderCard.getByRole("button", { name: "前进" }).click()
    await expect(currentBreadcrumb).toHaveAttribute("title", secondPath)
    await expect.poll(async () => folderCard.locator('[data-folder-entry="true"]').evaluateAll((entries, expected) => entries.some((entry) => {
      const path = (entry as HTMLElement).dataset.folderPath
      const source = entry.querySelector<HTMLImageElement>("img")?.src
      return Boolean(path && source && expected[path] === source)
    }), secondThumbnails)).toBe(true)

    await folderCard.getByRole("button", { name: "后退" }).click()
    await expect(currentBreadcrumb).toHaveAttribute("title", firstPath)
    await expect.poll(async () => Math.abs(await gridScroll.evaluate((element) => element.scrollTop) - savedScrollTop)).toBeLessThanOrEqual(40)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("[neoview.folder.home-refresh-e2e] persists Home and refreshes only the current directory", async ({ page }) => {
  const homeRoot = join(fixture.directory, "zz-home-refresh")
  const homePath = join(homeRoot, "A")
  const otherPath = join(homeRoot, "B")
  const nestedPath = join(homePath, "nested")
  await mkdir(nestedPath, { recursive: true })
  await mkdir(otherPath, { recursive: true })
  await Promise.all([
    ...Array.from({ length: 96 }, (_, index) => writeFile(join(homePath, `home-${String(index).padStart(3, "0")}.cbz`), "")),
    writeFile(join(otherPath, "other.cbz"), ""),
    writeFile(join(nestedPath, "nested-only.cbz"), ""),
  ])

  try {
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    const image = page.locator("img[data-reader-page-image]").first()
    await expect(image).toBeVisible()
    await image.evaluate((element) => element.setAttribute("data-home-refresh-image-instance", "stable"))

    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    const breadcrumb = folderCard.locator('[data-neoview-folder-breadcrumb="true"]')
    const currentBreadcrumb = breadcrumb.locator('[aria-current="page"]')
    const navigatePath = async (path: string) => {
      const edit = breadcrumb.getByRole("button", { name: "编辑路径" })
      await edit.focus()
      await edit.press("Enter")
      const input = breadcrumb.getByRole("textbox", { name: "浏览路径" })
      await input.fill(path)
      await input.press("Enter")
      await expect(currentBreadcrumb).toHaveAttribute("title", path)
    }

    await navigatePath(homePath)
    const homeButton = folderCard.getByRole("button", { name: "主页（单击返回主页，右键设置当前路径为主页）" })
    const savedHome = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
      && response.request().method() === "PATCH"
      && response.request().postData()?.includes('"homePath"') === true)
    await homeButton.click({ button: "right", force: true })
    expect((await savedHome).status()).toBe(200)
    await expect(homeButton).toHaveAttribute("aria-pressed", "true")
    const config = await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")
    expect(config).toContain("home_path")
    expect(config).toContain("zz-home-refresh")

    await navigatePath(otherPath)
    await homeButton.focus()
    await homeButton.press("Enter")
    await expect(currentBreadcrumb).toHaveAttribute("title", homePath)
    await expect(folderCard.getByRole("button", { name: "后退" })).toBeEnabled()

    const list = folderCard.getByRole("listbox", { name: "文件项目" })
    await list.focus()
    await page.keyboard.press("End")
    const selected = folderCard.getByTitle(join(homePath, "home-095.cbz"), { exact: true })
    await expect(selected).toBeVisible()
    await expect(selected).toHaveAttribute("aria-selected", "true")
    await writeFile(join(homePath, "new-direct.cbz"), "")

    await page.route("**/reader/browser/s/*/navigate", async (route) => {
      const body = route.request().postDataJSON() as { action?: string }
      if (body.action === "refresh") await new Promise((resolve) => setTimeout(resolve, 150))
      await route.continue()
    })
    await list.focus()
    await page.keyboard.press("F5")
    await expect(folderCard.getByRole("button", { name: "刷新" })).toBeDisabled()
    await expect(folderCard).toHaveAttribute("data-selection-count", "1")
    await expect(list).toHaveAttribute("data-focused-index", "96")
    await expect(folderCard.getByTitle(join(homePath, "home-095.cbz"), { exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(folderCard.getByText("new-direct.cbz", { exact: true })).toHaveCount(1)
    await expect(folderCard.getByText("nested-only.cbz", { exact: true })).toHaveCount(0)
    expect(await image.getAttribute("data-home-refresh-image-instance")).toBe("stable")
    expect(await folderCard.getByRole("tree").count()).toBe(0)
  } finally {
    await fetch(`${backend.url}/reader/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-xiranite-token": backend.token },
      body: JSON.stringify({ folderView: { homePath: "" } }),
    }).catch(() => undefined)
    await rm(homeRoot, { recursive: true, force: true })
  }
})

test("[neoview.folder.selection-virtual-e2e] preserves sparse selection and focus across real virtual unmounts", async ({ page }) => {
  const selectionRoot = join(fixture.directory, "zz-selection-virtual")
  await mkdir(selectionRoot, { recursive: true })
  await Promise.all(Array.from({ length: 260 }, (_, index) => (
    writeFile(join(selectionRoot, `item-${String(index).padStart(3, "0")}.cbz`), "")
  )))

  try {
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    const image = page.locator("img[data-reader-page-image]").first()
    await expect(image).toBeVisible()
    await image.evaluate((element) => element.setAttribute("data-selection-image-instance", "stable"))

    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    const breadcrumb = folderCard.locator('[data-neoview-folder-breadcrumb="true"]')
    const editPath = breadcrumb.getByRole("button", { name: "编辑路径" })
    await editPath.focus()
    await editPath.press("Enter")
    const input = breadcrumb.getByRole("textbox", { name: "浏览路径" })
    await input.fill(selectionRoot)
    await input.press("Enter")
    await expect(folderCard).toHaveAttribute("data-selection-total", "260")
    await selectFolderViewMode(page, folderCard, "紧凑列表")

    const list = folderCard.getByRole("listbox", { name: "文件项目" })
    const first = folderCard.getByTitle(join(selectionRoot, "item-000.cbz"), { exact: true })
    const last = folderCard.getByTitle(join(selectionRoot, "item-259.cbz"), { exact: true })
    await first.click()
    await list.focus()
    await list.press("Control+End")
    await expect(folderCard).toHaveAttribute("data-selection-count", "1")
    await expect(list).toHaveAttribute("data-focused-index", "259")
    await expect(last).toHaveAttribute("data-focused", "true")
    await expect(last).toHaveAttribute("aria-selected", "false")
    await expect(first).toHaveCount(0)
    await expect(list).toHaveAttribute("aria-activedescendant", await last.getAttribute("id") ?? "")

    await list.press("Control+Home")
    await expect(first).toHaveAttribute("data-focused", "true")
    await expect(first).toHaveAttribute("aria-selected", "true")
    await expect(folderCard).toHaveAttribute("data-selection-count", "1")
    await expect(last).toHaveCount(0)

    await list.press("Shift+End")
    await expect(folderCard).toHaveAttribute("data-selection-count", "260")
    await expect(last).toHaveAttribute("aria-selected", "true")
    expect(await image.getAttribute("data-selection-image-instance")).toBe("stable")
  } finally {
    await rm(selectionRoot, { recursive: true, force: true })
  }
})

test("[neoview.folder.panel-keepalive-e2e] keeps the File Card alive across panel and edge visibility changes", async ({ page }) => {
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()
  const activeImage = page.locator("img[data-reader-page-image]").first()
  await expect(activeImage).toBeVisible()
  await activeImage.evaluate((element) => element.setAttribute("data-panel-keepalive-image", "stable"))

  await page.mouse.move(1, page.viewportSize()!.height / 2)
  const leftSidebar = page.locator('[data-reader-sidebar="left"]')
  await expect(leftSidebar).toBeVisible()
  await page.mouse.move(24, page.viewportSize()!.height / 2)
  const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
  const entry = folderCard.getByTitle(fixture.path, { exact: true })
  await expect(entry).toBeVisible()
  await entry.click()
  await expect(folderCard).toHaveAttribute("data-selection-count", "1")
  await entry.evaluate((element) => element.setAttribute("data-file-card-instance", "stable"))
  const cachedEntry = page.locator('[data-file-card-instance="stable"]')
  const cachedFolderPanel = leftSidebar.locator('[data-reader-panel-cache="folder"]')
  let browserSessionReopens = 0
  page.on("request", (request) => {
    if (request.url() === `${backend.url}/reader/browser/sessions` && request.method() === "POST") browserSessionReopens += 1
  })

  await leftSidebar.getByRole("button", { name: "页面列表", exact: true }).evaluate((button: HTMLButtonElement) => button.click())
  await expect(cachedFolderPanel).toBeHidden()
  await expect(cachedEntry).toHaveAttribute("data-file-card-instance", "stable")
  await leftSidebar.getByRole("button", { name: "文件夹", exact: true }).evaluate((button: HTMLButtonElement) => button.click())
  await expect(cachedFolderPanel).toBeVisible()
  await expect(entry).toHaveAttribute("data-file-card-instance", "stable")
  await expect(entry).toHaveAttribute("aria-selected", "true")
  await expect(folderCard).toHaveAttribute("data-selection-count", "1")

  await page.mouse.move(page.viewportSize()!.width / 2, page.viewportSize()!.height / 2)
  await expect(leftSidebar).toBeHidden()
  await expect(cachedEntry).toHaveAttribute("data-file-card-instance", "stable")
  await page.mouse.move(1, page.viewportSize()!.height / 2)
  await expect(leftSidebar).toBeVisible()
  await expect(entry).toHaveAttribute("data-file-card-instance", "stable")
  expect(browserSessionReopens).toBe(0)
  expect(await activeImage.getAttribute("data-panel-keepalive-image")).toBe("stable")
})

test("[neoview.folder.context-actions-e2e] keeps Explorer item context actions consistent across list and details", async ({ page }) => {
  const contextRoot = join(fixture.directory, "zz-context-actions")
  const childDirectory = join(contextRoot, "nested")
  await mkdir(childDirectory, { recursive: true })
  await writeFile(join(contextRoot, "book.cbz"), "")
  try {
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    const image = page.locator("img[data-reader-page-image]").first()
    await expect(image).toBeVisible()
    await image.evaluate((element) => element.setAttribute("data-context-actions-image", "stable"))

    await page.mouse.move(1, page.viewportSize()!.height / 2)
    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    await expect(leftSidebar).toBeVisible()
    const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    const rootEntry = folderCard.getByTitle(contextRoot, { exact: true })
    await rootEntry.click({ button: "right" })
    await expect(folderCard).toHaveAttribute("data-selection-count", "1")
    await expect(page.getByRole("menuitem", { name: "在新标签页中打开" })).toBeVisible()
    await page.getByRole("menuitem", { name: "在新标签页中打开" }).click()
    await expect(leftSidebar.locator('[data-folder-tab-count="2"]')).toBeVisible()
    await expect(folderCard.locator('[data-neoview-folder-breadcrumb="true"] [aria-current="page"]')).toHaveAttribute("title", contextRoot)

    await selectFolderViewMode(page, folderCard, "详细信息")
    const detailsRow = folderCard.locator('tr[data-context-menu="neoview-folder-entry"]').filter({ hasText: "nested" })
    await expect(detailsRow).toBeVisible()
    await detailsRow.click({ button: "right" })
    await expect(page.getByRole("menuitem", { name: "作为书籍打开" })).toBeVisible()
    await page.keyboard.press("Escape")

    const bookmarkRequests: Array<{ source?: unknown; name?: string; kind?: string }> = []
    let directoryRefreshes = 0
    page.on("request", (request) => {
      if (request.url().includes("/reader/browser/s/") && request.url().endsWith("/navigate")) directoryRefreshes += 1
    })
    await folderCard.evaluate((element) => element.setAttribute("data-emm-file-card-instance", "stable"))
    const bookRow = folderCard.locator('tr[data-context-menu="neoview-folder-entry"]').filter({ hasText: "book.cbz" })
    await bookRow.click({ button: "right" })
    await page.getByRole("menuitem", { name: "编辑标签与评分" }).click()
    const editor = page.locator('[data-neoview-folder-emm-editor="true"]')
    await expect(editor).toBeVisible()
    await editor.getByRole("radio", { name: "5 星" }).click()
    const emmUpdate = page.waitForResponse((response) => response.url().endsWith("/emm-metadata")
      && response.request().method() === "PATCH")
    await editor.getByRole("button", { name: "保存" }).click()
    expect((await emmUpdate).status()).toBe(200)
    await expect(editor).toHaveCount(0)
    await expect(bookRow.getByText("5.0", { exact: true })).toBeVisible()
    await expect(folderCard).toHaveAttribute("data-emm-file-card-instance", "stable")
    expect(directoryRefreshes).toBe(0)
    expect(await image.getAttribute("data-context-actions-image")).toBe("stable")

    await page.route("**/reader/library/bookmarks", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue()
        return
      }
      const request = route.request().postDataJSON() as { source?: unknown; name?: string; kind?: string }
      bookmarkRequests.push(request)
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        id: "folder-context-bookmark",
        source: request.source,
        name: request.name,
        kind: request.kind,
        starred: false,
        createdAt: 1,
        updatedAt: 1,
        listIds: [],
      }) })
    })
    const refreshesBeforeBookmark = directoryRefreshes
    await detailsRow.click({ button: "right" })
    await page.getByRole("menuitem", { name: "添加/移除书签" }).click()
    await expect.poll(() => bookmarkRequests).toEqual([{
      source: { kind: "path", path: childDirectory },
      name: "nested",
      kind: "folder",
    }])
    expect(directoryRefreshes).toBe(refreshesBeforeBookmark)
    await expect(folderCard.getByText("已将 nested 添加到书签", { exact: true })).toHaveAttribute("role", "status")
    expect(await image.getAttribute("data-context-actions-image")).toBe("stable")

    const trashRequests: Array<{ operations?: unknown[]; confirmed?: boolean }> = []
    await page.route("**/reader/files/operations", async (route) => {
      trashRequests.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        results: [{ index: 0, operation: { kind: "trash", sourcePath: childDirectory }, status: "succeeded" }],
        succeeded: 1,
        failed: 0,
        cancelled: 0,
        undoable: 0,
      }) })
    })
    await page.route("**/reader/browser/s/*/navigate", async (route) => {
      const response = await route.fetch()
      const body = await response.json() as { entries: Array<{ path: string }>; total: number; generation: number }
      await route.fulfill({ response, json: {
        ...body,
        entries: body.entries.filter((entry) => entry.path !== childDirectory),
        total: Math.max(0, body.total - 1),
        generation: body.generation + 1,
      } })
    })

    await detailsRow.click({ button: "right" })
    await page.getByRole("menuitem", { name: "移到回收站" }).click()
    const confirmation = page.getByRole("alertdialog")
    await expect(confirmation).toContainText("NeoView 无法直接撤销此操作")
    await confirmation.getByRole("button", { name: "取消" }).click()
    expect(trashRequests).toHaveLength(0)
    await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const folderList = folderCard.locator('[data-neoview-folder-list="true"]')
    await expect(folderList).toBeFocused()

    await folderList.press("Delete")
    await expect(confirmation).toContainText("nested")
    await confirmation.getByRole("button", { name: "移到回收站" }).click()
    await expect.poll(() => trashRequests).toEqual([{
      operations: [{ kind: "trash", sourcePath: childDirectory }],
      confirmed: true,
    }])
    await expect(detailsRow).toHaveCount(0)
    await expect(folderCard.getByText("已将 nested 移到回收站", { exact: true })).toHaveAttribute("role", "status")
    await expect.poll(async () => stat(childDirectory).then(() => true, () => false)).toBe(true)
    expect(await image.getAttribute("data-context-actions-image")).toBe("stable")
    await page.screenshot({ path: "artifacts/playwright/neoview-folder-trash-confirmed.png", fullPage: true })
  } finally {
    await rm(contextRoot, { recursive: true, force: true })
  }
})

test("[neoview.folder.blank-action-e2e] [neoview.folder.bottom-return-e2e] persists Explorer empty-area actions without changing entry indexes", async ({ page }) => {
  const root = join(fixture.directory, "zz-empty-area")
  const parentPath = join(root, "parent")
  const childPath = join(parentPath, "child")
  await mkdir(childPath, { recursive: true })
  await writeFile(join(childPath, "only.cbz"), "")

  try {
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    const image = page.locator("img[data-reader-page-image]").first()
    await expect(image).toBeVisible()
    await image.evaluate((element) => element.setAttribute("data-empty-area-image-instance", "stable"))

    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    const breadcrumb = folderCard.locator('[data-neoview-folder-breadcrumb="true"]')
    const currentBreadcrumb = breadcrumb.locator('[aria-current="page"]')
    const navigatePath = async (path: string) => {
      const edit = breadcrumb.getByRole("button", { name: "编辑路径" })
      await edit.focus()
      await edit.press("Enter")
      const input = breadcrumb.getByRole("textbox", { name: "浏览路径" })
      await input.fill(path)
      await input.press("Enter")
      await expect(currentBreadcrumb).toHaveAttribute("title", path)
    }
    const chooseAction = async (label: "单击空白" | "双击空白", action: "无操作" | "返回上级" | "后退") => {
      await folderCard.getByRole("button", { name: "空白区域操作" }).click()
      await page.getByRole("menuitem", { name: label }).hover()
      const saved = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
        && response.request().method() === "PATCH"
        && response.request().postData()?.includes("emptyArea") === true)
      await page.getByRole("menuitemradio", { name: action }).click()
      expect((await saved).status()).toBe(200)
    }

    await navigatePath(childPath)
    await chooseAction("单击空白", "后退")
    await chooseAction("双击空白", "无操作")
    await chooseAction("双击空白", "返回上级")

    const list = folderCard.getByRole("listbox", { name: "文件项目" })
    await expect(folderCard).toHaveAttribute("data-selection-total", "1")
    await expect(folderCard.getByTitle(join(childPath, "only.cbz"), { exact: true })).toHaveCount(1)

    const navigationActions: string[] = []
    page.on("request", (request) => {
      if (request.method() !== "POST" || !request.url().endsWith("/navigate")) return
      navigationActions.push((request.postDataJSON() as { action: string }).action)
    })
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const blankPoint = await list.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const blocked = '[data-folder-entry="true"], [data-folder-return-footer="true"], [data-row-id], [data-index], button, input, select, textarea, a, [role="menu"]'
      for (let y = bounds.bottom - 8; y > bounds.top + 8; y -= 8) {
        for (let x = bounds.left + 8; x < bounds.right - 8; x += 8) {
          const target = document.elementFromPoint(x, y)
          if (target && element.contains(target) && !target.closest(blocked)) return { x, y }
        }
      }
      throw new Error("folder list has no clickable blank area")
    })
    await page.mouse.dblclick(blankPoint.x, blankPoint.y)
    await expect.poll(() => navigationActions).toEqual(["up"])
    await page.waitForTimeout(260)
    expect(navigationActions).toEqual(["up"])
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    await expect(currentBreadcrumb).toHaveAttribute("title", parentPath)

    await navigatePath(childPath)
    await folderCard.getByRole("button", { name: "空白区域操作" }).click()
    const footerSaved = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
      && response.request().method() === "PATCH"
      && response.request().postData()?.includes("showBackButton") === true)
    await page.getByRole("menuitemcheckbox", { name: "显示底部返回按钮" }).click()
    expect((await footerSaved).status()).toBe(200)
    await expect(folderCard).toHaveAttribute("data-selection-total", "1")
    await expect(folderCard.getByTitle(join(childPath, "only.cbz"), { exact: true })).toHaveCount(1)
    await expect(folderCard.getByRole("button", { name: "返回上级目录" })).toBeVisible()
    navigationActions.length = 0
    await folderCard.getByRole("button", { name: "返回上级目录" }).click()
    await expect(currentBreadcrumb).toHaveAttribute("title", parentPath)
    expect(navigationActions).toEqual(["back"])
    expect(await image.getAttribute("data-empty-area-image-instance")).toBe("stable")

    const config = await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")
    expect(config).toContain("[nodes.neoview.folder]")
    expect(config).toContain('single_click_action = "goBack"')
    expect(config).toContain('double_click_action = "goUp"')
    expect(config).toContain("show_back_button = true")
  } finally {
    await fetch(`${backend.url}/reader/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-xiranite-token": backend.token },
      body: JSON.stringify({ folderView: { emptyArea: { singleClickAction: "none", doubleClickAction: "goUp", showBackButton: false } } }),
    }).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test("[neoview.folder.tabs-lifecycle-e2e] [neoview.folder.tabs-navigation-history-e2e] [neoview.folder.tabs-bulk-close-e2e] [neoview.folder.tabs-pin-duplicate-e2e] [neoview.folder.tabs-reopen-e2e] [neoview.folder.selection-tab-isolation-e2e] keeps Explorer folder tabs isolated and releases closed sessions", async ({ page }) => {
  const tabsRoot = join(fixture.directory, "zz-folder-tabs")
  const firstPath = join(tabsRoot, "A")
  const secondPath = join(tabsRoot, "B")
  const thirdPath = join(tabsRoot, "C")
  const fourthPath = join(tabsRoot, "D")
  const fifthPath = join(tabsRoot, "E")
  const sixthPath = join(tabsRoot, "F")
  await mkdir(firstPath, { recursive: true })
  await mkdir(secondPath, { recursive: true })
  await mkdir(thirdPath, { recursive: true })
  await mkdir(fourthPath, { recursive: true })
  await mkdir(fifthPath, { recursive: true })
  await mkdir(sixthPath, { recursive: true })
  await writeFile(join(firstPath, "a.cbz"), "")
  await writeFile(join(firstPath, "a-1.cbz"), "")
  await writeFile(join(firstPath, "a-2.cbz"), "")
  await writeFile(join(secondPath, "b.cbz"), "")
  await writeFile(join(thirdPath, "c.cbz"), "")
  const configured = await fetch(`${backend.url}/reader/config`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-xiranite-token": backend.token },
    body: JSON.stringify({ folderView: { homePath: secondPath, tabs: { pinned: [] } } }),
  })
  expect(configured.status).toBe(200)

  try {
    let browserOpens = 0
    let browserCloses = 0
    page.on("request", (request) => {
      if (request.url() === `${backend.url}/reader/browser/sessions` && request.method() === "POST") browserOpens += 1
      if (request.url().includes("/reader/browser/s/") && request.method() === "DELETE") browserCloses += 1
    })
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    const image = page.locator("img[data-reader-page-image]").first()
    await expect(image).toBeVisible()
    await image.evaluate((element) => element.setAttribute("data-folder-tabs-image-instance", "stable"))

    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    await expect(leftSidebar).toBeVisible()
    const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    const revealFolderSidebar = async () => {
      await page.mouse.move(1, page.viewportSize()!.height / 2)
      await expect(leftSidebar).toBeVisible()
      await expect(folderCard).toBeVisible()
    }
    const currentBreadcrumb = () => folderCard.locator('[data-neoview-folder-breadcrumb="true"] [aria-current="page"]')
    const navigatePath = async (path: string) => {
      await revealFolderSidebar()
      const breadcrumb = folderCard.locator('[data-neoview-folder-breadcrumb="true"]')
      const edit = breadcrumb.getByRole("button", { name: "编辑路径" })
      await edit.focus()
      await edit.press("Enter")
      const input = breadcrumb.getByRole("textbox", { name: "浏览路径" })
      await input.fill(path)
      await input.press("Enter")
      await expect(currentBreadcrumb()).toHaveAttribute("title", path)
    }

    await navigatePath(firstPath)
    const firstItem = folderCard.getByTitle(join(firstPath, "a.cbz"), { exact: true })
    await firstItem.click()
    await selectFolderHandleAction(page, folderCard, "多选模式")
    const firstSelectionBar = folderCard.locator('[data-neoview-folder-selection-bar="true"]')
    await firstSelectionBar.getByRole("button", { name: "链接选中模式" }).click()
    await folderCard.getByTitle(join(firstPath, "a-1.cbz"), { exact: true }).click()
    await folderCard.getByTitle(join(firstPath, "a-2.cbz"), { exact: true }).click()
    await expect(folderCard).toHaveAttribute("data-selection-count", "3")
    await selectFolderViewMode(page, folderCard, "详细信息")
    await expect(folderCard).toHaveAttribute("data-folder-view-mode", "details")

    await openFolderMoreActions(page, folderCard)
    await folderCard.getByRole("button", { name: "新建文件夹标签" }).focus()
    await folderCard.getByRole("button", { name: "新建文件夹标签" }).press("Enter")
    await expect(currentBreadcrumb()).toHaveAttribute("title", secondPath)
    await expect(folderCard.locator('[data-neoview-folder-selection-bar="true"]')).toHaveCount(0)
    await expect(folderCard).toHaveAttribute("data-selection-count", "0")
    await selectFolderViewMode(page, folderCard, "紧凑列表")
    const secondItem = folderCard.getByTitle(join(secondPath, "b.cbz"), { exact: true })
    await secondItem.click()
    await expect(folderCard).toHaveAttribute("data-selection-count", "1")

    await navigatePath(thirdPath)
    const thirdItem = folderCard.getByTitle(join(thirdPath, "c.cbz"), { exact: true })
    await thirdItem.click()
    await openFolderMoreActions(page, folderCard)
    await folderCard.getByRole("button", { name: "新建文件夹标签" }).focus()
    await folderCard.getByRole("button", { name: "新建文件夹标签" }).press("Enter")
    await expect(currentBreadcrumb()).toHaveAttribute("title", secondPath)
    await expect(folderCard.getByRole("tab", { name: "B" })).toHaveAttribute("aria-selected", "true")
    expect(browserOpens).toBe(3)

    await folderCard.getByRole("tab", { name: "A" }).focus()
    await folderCard.getByRole("tab", { name: "A" }).press("Enter")
    await expect(currentBreadcrumb()).toHaveAttribute("title", firstPath)
    await expect(folderCard).toHaveAttribute("data-folder-view-mode", "details")
    await expect(folderCard).toHaveAttribute("data-selection-count", "3")
    await expect(folderCard.getByRole("button", { name: "链接选中模式" })).toHaveAttribute("aria-pressed", "true")

    const clonedResponse = page.waitForResponse((response) => response.url().endsWith("/clone") && response.request().method() === "POST")
    await folderCard.getByRole("button", { name: "标签操作 A" }).click()
    await page.getByRole("menuitem", { name: "复制标签" }).click()
    expect((await clonedResponse).status()).toBe(201)
    await expect(folderCard.getByRole("tab", { name: "A (2)" })).toHaveAttribute("aria-selected", "true")
    await expect(folderCard).toHaveAttribute("data-folder-view-mode", "details")
    await expect(folderCard).toHaveAttribute("data-selection-count", "3")
    expect(browserOpens).toBe(3)
    const closedClone = page.waitForResponse((response) => response.url().includes("/reader/browser/s/")
      && response.request().method() === "DELETE")
    const closeCloneTab = folderCard.getByRole("button", { name: "关闭标签 A (2)" })
    await closeCloneTab.focus()
    await closeCloneTab.press("Enter")
    expect((await closedClone).status()).toBe(204)
    await expect(folderCard.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true")

    await folderCard.getByRole("tab", { name: "C" }).focus()
    await folderCard.getByRole("tab", { name: "C" }).press("Enter")
    await expect(currentBreadcrumb()).toHaveAttribute("title", thirdPath)
    await expect(folderCard).toHaveAttribute("data-folder-view-mode", "compact")
    await expect(folderCard).toHaveAttribute("data-selection-count", "1")
    expect(browserOpens).toBe(3)

    const closed = page.waitForResponse((response) => response.url().includes("/reader/browser/s/")
      && response.request().method() === "DELETE")
    const closeSecondTab = folderCard.getByRole("button", { name: "关闭标签 C" })
    await closeSecondTab.focus()
    await closeSecondTab.press("Enter")
    const closedResponse = await closed
    expect(closedResponse.status()).toBe(204)
    expect(closedResponse.url()).toContain("?remember=1")
    await expect(currentBreadcrumb()).toHaveAttribute("title", firstPath)
    await expect(folderCard.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true")
    await expect(folderCard.getByRole("tab", { name: "B" })).toHaveAttribute("aria-selected", "false")
    await expect(folderCard.getByRole("button", { name: /^关闭标签/ })).toHaveCount(2)
    await expect(folderCard.locator('[data-folder-tab-bar="true"]')).toBeVisible()
    expect(await image.getAttribute("data-folder-tabs-image-instance")).toBe("stable")
    expect(browserOpens).toBe(3)

    const reopened = page.waitForResponse((response) => response.url().endsWith("/reopen")
      && response.request().method() === "POST")
    await revealFolderSidebar()
    const reopenButton = folderCard.getByRole("button", { name: "重新打开关闭的页签" })
    await reopenButton.focus()
    await reopenButton.press("Enter")
    await page.getByRole("menuitem", { name: "C" }).click()
    expect((await reopened).status()).toBe(201)
    await expect(folderCard.getByRole("tab", { name: "C" })).toHaveAttribute("aria-selected", "true")
    await expect(currentBreadcrumb()).toHaveAttribute("title", thirdPath)
    await expect(folderCard.getByTitle(join(thirdPath, "c.cbz"), { exact: true })).toBeVisible()
    await expect(folderCard.getByTitle(join(firstPath, "a.cbz"), { exact: true })).toHaveCount(0)
    await expect(folderCard).toHaveAttribute("data-folder-view-mode", "compact")
    await expect(folderCard).toHaveAttribute("data-selection-count", "1")
    expect(browserOpens).toBe(3)
    expect(await image.getAttribute("data-folder-tabs-image-instance")).toBe("stable")

    const reclosed = page.waitForResponse((response) => response.url().includes("/reader/browser/s/")
      && response.request().method() === "DELETE")
    const recloseButton = folderCard.getByRole("button", { name: "关闭标签 C" })
    await recloseButton.focus()
    await recloseButton.press("Enter")
    expect((await reclosed).status()).toBe(204)
    await expect(folderCard.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true")

    await revealFolderSidebar()
    await folderCard.getByRole("button", { name: "标签操作 B" }).focus()
    await folderCard.getByRole("button", { name: "标签操作 B" }).press("Enter")
    await page.getByRole("menuitem", { name: "固定标签" }).click()
    await expect(folderCard.getByRole("tab", { name: "B" }).locator("..")).toHaveAttribute("data-pinned", "true")

    await navigatePath(thirdPath)
    await newTabButton.focus()
    await newTabButton.press("Enter")
    await expect(currentBreadcrumb()).toHaveAttribute("title", secondPath)
    const activeTabMenu = folderCard.locator('[data-folder-tab-bar="true"] [data-active="true"]').getByRole("button", { name: /^标签操作/ })
    await activeTabMenu.focus()
    await activeTabMenu.press("Enter")
    await page.getByRole("menuitem", { name: "关闭左侧标签" }).click()
    await expect.poll(() => browserCloses).toBe(4)
    await expect(folderCard.getByRole("tab", { name: "B" })).toHaveCount(2)

    await navigatePath(fifthPath)
    await newTabButton.focus()
    await newTabButton.press("Enter")
    await navigatePath(fourthPath)
    await revealFolderSidebar()
    await folderCard.getByRole("button", { name: "标签操作 E" }).focus()
    await folderCard.getByRole("button", { name: "标签操作 E" }).press("Enter")
    await page.getByRole("menuitem", { name: "关闭右侧标签" }).click()
    await expect.poll(() => browserCloses).toBe(5)
    await expect(currentBreadcrumb()).toHaveAttribute("title", fifthPath)

    await newTabButton.focus()
    await newTabButton.press("Enter")
    await navigatePath(sixthPath)
    await newTabButton.focus()
    await newTabButton.press("Enter")
    await revealFolderSidebar()
    await folderCard.getByRole("button", { name: "标签操作 F" }).focus()
    await folderCard.getByRole("button", { name: "标签操作 F" }).press("Enter")
    await page.getByRole("menuitem", { name: "关闭其他标签" }).click()
    await expect.poll(() => browserCloses).toBe(7)
    await expect(folderCard.getByRole("tab", { name: "B" })).toHaveCount(1)
    await expect(folderCard.getByRole("tab", { name: "F" })).toHaveAttribute("aria-selected", "true")
    await expect(leftSidebar.locator('[data-folder-tab-count="2"]')).toBeVisible()
    expect(await image.getAttribute("data-folder-tabs-image-instance")).toBe("stable")
    expect(browserOpens).toBe(7)

    await page.reload({ waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    const restoredSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await restoredSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    const restoredFolderCard = restoredSidebar.locator('[data-neoview-folder-card="true"]')
    await expect(restoredFolderCard.getByRole("tab", { name: "B", exact: true })).toBeVisible()
    await expect(restoredFolderCard.getByRole("tab", { name: "B", exact: true }).locator("..")).toHaveAttribute("data-pinned", "true")
    await expect(restoredSidebar.locator('[data-folder-tab-count="2"]')).toBeVisible()
  } finally {
    await fetch(`${backend.url}/reader/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-xiranite-token": backend.token },
      body: JSON.stringify({ folderView: { homePath: "", tabs: { pinned: [] } } }),
    }).catch(() => undefined)
    await rm(tabsRoot, { recursive: true, force: true })
  }
})

test("[neoview.folder.compact-chrome-e2e] keeps single-card chrome compact and reveals tabs below breadcrumbs", async ({ page }, testInfo) => {
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()
  await expect(page.locator("img[data-reader-page-image]").first()).toBeVisible()

  await page.mouse.move(1, page.viewportSize()!.height / 2)
  const sidebar = page.locator('[data-reader-sidebar="left"]')
  const folderPanel = sidebar.locator('[data-reader-panel-cache="folder"]')
  const residentCard = folderPanel.locator('[data-reader-card="文件浏览"]')
  const folderCard = folderPanel.locator('[data-neoview-folder-card="true"]')
  await expect(folderCard).toBeVisible()
  await residentCard.evaluate((element) => element.setAttribute("data-compact-card-instance", "stable"))
  await expect(residentCard).toHaveAttribute("data-reader-card-chrome", "none")
  await expect(folderPanel.getByRole("heading", { name: "文件夹" })).toHaveCount(0)
  await expect(folderPanel.getByRole("button", { name: "折叠文件浏览" })).toHaveCount(0)
  await expect(folderPanel.locator('[data-folder-tab-count="1"]')).toBeVisible()
  await expect(folderPanel.locator('[data-folder-tab-bar="true"]')).toHaveCount(0)
  await expect(folderCard.locator('[data-folder-toolbar-row="operations"]')).toContainText(/\d+ \/ \d+/)
  await expect(folderCard.getByRole("button", { name: "文件操作手柄" })).toBeVisible()

  const singleOrder = await folderCard.evaluate((element) => {
    const breadcrumb = element.querySelector('[data-folder-layout-region="breadcrumb"]')
    const toolbar = element.querySelector('[data-folder-layout-region="toolbar"]')
    return Boolean(breadcrumb && toolbar && (breadcrumb.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING))
  })
  expect(singleOrder).toBe(true)

  await folderCard.getByRole("button", { name: "文件操作手柄" }).click()
  const palette = page.locator('[data-action-palette="true"]')
  await expect(palette).toBeVisible()
  await expect(palette).toHaveAttribute("data-action-placement", /top|right|bottom|left/)
  await palette.getByRole("menuitem", { name: "视图" }).hover()
  await expect(page.locator('[data-action-preview="true"]')).toContainText("显示六种文件视图切换栏")
  await page.screenshot({ path: testInfo.outputPath(`neoview-folder-compact-${testInfo.project.name}.png`) })

  await palette.getByRole("menuitem", { name: "更多操作" }).click()
  await folderCard.getByRole("button", { name: "新建文件夹标签" }).click()
  await expect(folderPanel.locator('[data-folder-tab-count="2"]')).toBeVisible()
  await expect(folderPanel.locator('[data-folder-tab-bar="true"]')).toBeVisible()
  const multiOrder = await folderCard.evaluate((element) => {
    const breadcrumb = element.querySelector('[data-folder-layout-region="breadcrumb"]')
    const tabs = element.querySelector('[data-folder-layout-region="tabs"]')
    const toolbar = element.querySelector('[data-folder-layout-region="toolbar"]')
    return Boolean(
      breadcrumb && tabs && toolbar
      && (breadcrumb.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (tabs.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING)
    )
  })
  expect(multiOrder).toBe(true)
  await expect(residentCard).toHaveAttribute("data-compact-card-instance", "stable")
  await folderCard.screenshot({ path: testInfo.outputPath(`neoview-folder-tabs-${testInfo.project.name}.png`) })
})

test("[neoview.folder.tabs-layout-e2e] persists nested folder chrome without changing current-directory listing semantics", async ({ page }) => {
  const resetLayout = async () => fetch(`${backend.url}/reader/config`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-xiranite-token": backend.token },
    body: JSON.stringify({ folderView: { tabs: { layout: "top", width: 160, breadcrumbPosition: "top", toolbarPosition: "top" } } }),
  })
  expect((await resetLayout()).status).toBe(200)
  try {
    let layoutPatches = 0
    page.on("request", (request) => {
      if (request.url() !== `${backend.url}/reader/config` || request.method() !== "PATCH") return
      if (request.postData()?.includes('"tabs"')) layoutPatches += 1
    })
    await page.addInitScript(({ baseUrl, token }) => {
      window.__XIRANITE_BACKEND__ = { baseUrl, token }
    }, { baseUrl: backend.url, token: backend.token })
    await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "打开书籍" }).click()
    const image = page.locator("img[data-reader-page-image]").first()
    await expect(image).toBeVisible()
    await image.evaluate((element) => element.setAttribute("data-folder-layout-image-instance", "stable"))

    const leftSidebar = page.locator('[data-reader-sidebar="left"]')
    if (!await leftSidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
    const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
    await expect(folderCard).toBeVisible()
    const chooseLayout = async (name: string) => {
      const settings = folderCard.getByRole("button", { name: "标签栏布局设置" })
      await settings.focus()
      await settings.press("Enter")
      await page.getByRole("button", { name }).click()
      await expect(page.getByRole("menu")).toHaveCount(0)
    }
    await chooseLayout("标签栏位置：左侧")
    await chooseLayout("面包屑位置：右侧")
    await chooseLayout("工具栏位置：底部")

    await expect(folderCard).toHaveAttribute("data-folder-tab-position", "left")
    await expect(folderCard).toHaveAttribute("data-folder-breadcrumb-position", "right")
    await expect(folderCard).toHaveAttribute("data-folder-toolbar-position", "bottom")
    await expect(folderCard.locator('[data-neoview-folder-breadcrumb="true"]')).toHaveAttribute("data-orientation", "vertical")
    await expect(folderCard.locator('[data-folder-layout-region="toolbar"]')).toHaveCSS("order", "2")

    const separator = folderCard.getByRole("separator", { name: "调整标签栏宽度" })
    await separator.hover()
    const box = await separator.boundingBox()
    expect(box).toBeTruthy()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    for (let offset = 4; offset <= 40; offset += 4) await page.mouse.move(box!.x + box!.width / 2 + offset, box!.y + box!.height / 2)
    expect(layoutPatches).toBe(3)
    await page.mouse.up()
    await expect.poll(() => layoutPatches).toBe(4)
    await expect(folderCard.locator('[data-folder-tab-layout="left"]')).toHaveCSS("width", "200px")

    const persisted = await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")
    expect(persisted).toMatch(/\[nodes\.neoview\.folder\.tabs\][\s\S]*layout = "left"/)
    expect(persisted).toMatch(/\[nodes\.neoview\.folder\.tabs\][\s\S]*width = 200/)
    expect(persisted).toMatch(/\[nodes\.neoview\.folder\.tabs\][\s\S]*breadcrumb_position = "right"/)
    expect(persisted).toMatch(/\[nodes\.neoview\.folder\.tabs\][\s\S]*toolbar_position = "bottom"/)
    await expect(folderCard.getByText("recursive-result.png", { exact: true })).toHaveCount(0)
    expect(await image.getAttribute("data-folder-layout-image-instance")).toBe("stable")
    const cardBox = await folderCard.boundingBox()
    expect(cardBox!.x).toBeGreaterThanOrEqual(0)
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  } finally {
    await resetLayout().catch(() => undefined)
  }
})

test("[neoview.time-information.e2e] renders source-aware archive times in the real Reader", async ({ page }, testInfo) => {
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  const openedResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/sessions` && response.request().method() === "POST"
  ))
  await page.getByRole("button", { name: "打开书籍" }).click()
  const opened = await (await openedResponse).json() as { sessionId: string }
  const image = page.locator("img[data-reader-page-image]").first()
  await expect(image).toBeVisible()
  await image.evaluate((element) => element.setAttribute("data-neoview-time-card-image-instance", "stable"))

  let metadataRequests = 0
  page.on("request", (request) => {
    if (request.url().endsWith(`/reader/s/${opened.sessionId}/metadata`)) metadataRequests += 1
  })
  const metadataResponse = page.waitForResponse((response) => response.url().endsWith(`/reader/s/${opened.sessionId}/metadata`))
  const viewport = page.viewportSize()!
  await page.mouse.move(viewport.width - 1, viewport.height / 2)
  const rightSidebar = page.locator('[data-reader-sidebar="right"]')
  await expect(rightSidebar).toBeVisible()
  const timeCard = rightSidebar.locator('[data-reader-card="时间信息"]')
  await expect(timeCard.locator('[data-time-source="archive-entry"]')).toBeVisible()
  await expect(timeCard.getByText("压缩包条目")).toBeVisible()
  await expect(timeCard.getByText("访问时间")).toBeVisible()
  await expect(timeCard.getByText("—")).toHaveCount(2)
  const metadata = await (await metadataResponse).json() as {
    page: { timeSource?: string; createdAtMs?: number; modifiedAtMs?: number; accessedAtMs?: number }
  }
  expect(metadata.page).toMatchObject({ timeSource: "archive-entry", modifiedAtMs: expect.any(Number) })
  expect(metadata.page.createdAtMs).toBeUndefined()
  expect(metadata.page.accessedAtMs).toBeUndefined()
  expect(metadataRequests).toBe(1)
  expect(await timeCard.locator("dd").evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth + 1))).toBe(true)
  expect(await image.getAttribute("data-neoview-time-card-image-instance")).toBe("stable")
  await timeCard.scrollIntoViewIfNeeded()
  await timeCard.screenshot({ path: testInfo.outputPath(`neoview-time-information-${testInfo.project.name}.png`) })

  const closed = await fetch(`${backend.url}/reader/s/${opened.sessionId}`, {
    method: "DELETE",
    headers: { "x-xiranite-token": backend.token },
  })
  expect(closed.status).toBe(204)
})

test("[neoview.sidebar-control.e2e] controls, drags and persists the shared Reader Shell", async ({ page }, testInfo) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message))
  const initialConfig = await fetch(`${backend.url}/reader/config`, { headers: { "x-xiranite-token": backend.token } })
    .then((response) => response.json()) as { shell: { revision: number } }
  const resetSetup = await fetch(`${backend.url}/reader/config`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-xiranite-token": backend.token },
    body: JSON.stringify({ expectedRevision: initialConfig.shell.revision, shellControl: { reset: "known-defaults" } }),
  })
  expect(resetSetup.status).toBe(200)
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })

  const sessionlessLeft = page.locator('[data-reader-sidebar="left"]')
  await expect(sessionlessLeft).toBeVisible()
  for (const panel of ["文件夹", "历史记录", "书签", "页面列表"] as const) {
    await expect(sessionlessLeft.getByRole("button", { name: panel, exact: true })).toBeVisible()
  }
  await sessionlessLeft.getByRole("button", { name: "页面列表", exact: true }).click()
  await expect(sessionlessLeft.getByText("打开书本后显示页面导航")).toBeVisible()

  const sessionlessViewport = page.viewportSize()!
  await page.mouse.move(sessionlessViewport.width - 1, sessionlessViewport.height / 2)
  const sessionlessRight = page.locator('[data-reader-sidebar="right"]')
  await expect(sessionlessRight).toBeVisible()
  for (const panel of ["信息", "属性", "控制"] as const) {
    await expect(sessionlessRight.getByRole("button", { name: panel, exact: true })).toBeVisible()
  }
  await page.screenshot({ path: testInfo.outputPath("neoview-resident-panels-sessionless-1920x1080.png") })

  await page.mouse.move(page.viewportSize()!.width / 2, 1)
  await expect(page.locator('[data-reader-edge="top"]')).toBeVisible()
  await page.getByRole("button", { name: "打开书籍" }).click()
  const image = page.locator("img[data-reader-page-image]").first()
  await expect(image).toBeVisible()
  await sessionlessLeft.getByRole("button", { name: "页面列表", exact: true }).click()
  await expect(sessionlessLeft.locator('[data-reader-card="页面导航"]')).toBeVisible()
  await expect(sessionlessLeft.getByText("打开书本后显示页面导航")).toHaveCount(0)
  const assetUrl = await image.getAttribute("src")
  await image.evaluate((element) => element.setAttribute("data-sidebar-control-image-instance", "stable"))

  const viewport = page.viewportSize()!
  await page.mouse.move(viewport.width - 1, viewport.height / 2)
  const rightSidebar = page.locator('[data-reader-sidebar="right"]')
  await expect(rightSidebar).toBeVisible()
  await rightSidebar.getByRole("button", { name: "控制", exact: true }).click()
  const card = rightSidebar.locator('[data-neoview-card="sidebar-control"]')
  await expect(card).toBeVisible()

  const pageTransitionCard = rightSidebar.locator('[data-neoview-card="page-transition"]')
  await pageTransitionCard.scrollIntoViewIfNeeded()
  const pageTransitionToggle = pageTransitionCard.getByRole("switch", { name: "启用翻页动画" })
  await expect(pageTransitionToggle).toBeEnabled()
  const transitionResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"pageTransition"') === true)
  await pageTransitionToggle.click()
  expect((await transitionResponse).status()).toBe(200)
  await expect(pageTransitionToggle).toBeChecked()
  await expect(pageTransitionCard.getByText("\u5df2\u4fdd\u5b58", { exact: true })).toBeVisible()
  expect(await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")).toMatch(/\[nodes\.neoview\.image\.page_transition\][\s\S]*enabled = true/)

  const colorFilterCard = rightSidebar.locator('[data-neoview-card="color-filter"]')
  await colorFilterCard.scrollIntoViewIfNeeded()
  const brightness = colorFilterCard.getByRole("slider", { name: "亮度" })
  await expect(brightness).toBeEnabled()
  let colorFilterPatches = 0
  page.on("request", (request) => {
    if (request.url() === `${backend.url}/reader/config` && request.method() === "PATCH" && request.postData()?.includes('"colorFilter"')) colorFilterPatches += 1
  })
  const filterResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"colorFilter"') === true)
  const brightnessBox = await brightness.boundingBox()
  expect(brightnessBox).not.toBeNull()
  await page.mouse.move(brightnessBox!.x + brightnessBox!.width / 2, brightnessBox!.y + brightnessBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(brightnessBox!.x + brightnessBox!.width * 0.7, brightnessBox!.y + brightnessBox!.height / 2, { steps: 12 })
  expect(colorFilterPatches).toBe(0)
  await page.mouse.up()
  expect((await filterResponse).status()).toBe(200)
  expect(colorFilterPatches).toBe(1)
  await expect(colorFilterCard.getByText("\u5df2\u4fdd\u5b58", { exact: true })).toBeVisible()
  expect(await brightness.getAttribute("aria-valuenow")).not.toBe("100")
  expect(await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")).toMatch(/\[nodes\.neoview\.image\.color_filter\][\s\S]*brightness = (?!100\b)\d+/)
  expect(await image.getAttribute("data-sidebar-control-image-instance")).toBe("stable")

  const keepOpenResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"right":{"pinned":true,"lockMode":"locked-open"}') === true)
  await card.getByRole("combobox", { name: "右边锁定模式" }).selectOption("locked-open")
  expect((await keepOpenResponse).status()).toBe(200)

  for (const edge of ["上", "下", "左"] as const) {
    const response = page.waitForResponse((candidate) => candidate.url() === `${backend.url}/reader/config`
      && candidate.request().method() === "PATCH"
      && candidate.request().postData()?.includes('"lockMode":"locked-open"') === true)
    await card.getByRole("combobox", { name: `${edge}边锁定模式` }).selectOption("locked-open")
    expect((await response).status()).toBe(200)
  }
  const edgeChrome = page.locator("[data-reader-edge-chrome]")
  await expect(edgeChrome).toHaveCount(4)
  for (const edge of ["top", "right", "bottom", "left"] as const) {
    const chrome = page.locator(`[data-reader-edge-chrome="${edge}"]`)
    await expect(chrome).toBeVisible()
    expect(await chrome.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  }
  const topChrome = page.locator('[data-reader-edge-chrome="top"]')
  const windowBar = topChrome.locator('[data-reader-window-bar="true"]')
  const breadcrumbBar = topChrome.locator('[data-reader-breadcrumb-bar="true"]')
  const breadcrumbPath = breadcrumbBar.locator('[data-reader-breadcrumb-path="true"]')
  await expect(windowBar).toBeVisible()
  await expect(breadcrumbBar).toBeVisible()
  const fixtureName = basename(fixture.path)
  await expect(windowBar).not.toContainText(fixtureName)
  await expect(breadcrumbBar).toContainText(fixtureName)
  const windowBarBox = await windowBar.boundingBox()
  const breadcrumbBarBox = await breadcrumbBar.boundingBox()
  expect(windowBarBox).not.toBeNull()
  expect(breadcrumbBarBox).not.toBeNull()
  expect(breadcrumbBarBox!.y).toBeGreaterThanOrEqual(windowBarBox!.y + windowBarBox!.height - 1)
  const breadcrumbPathBox = await breadcrumbPath.boundingBox()
  expect(breadcrumbPathBox).not.toBeNull()
  expect(Math.abs(
    breadcrumbPathBox!.x + breadcrumbPathBox!.width / 2
      - (breadcrumbBarBox!.x + breadcrumbBarBox!.width / 2),
  )).toBeLessThanOrEqual(2)
  await topChrome.getByRole("button", { name: "展开缩放设置" }).click()
  await expect(topChrome.locator('[data-reader-toolbar-panel="zoom"]')).toBeVisible()
  await topChrome.getByRole("button", { name: "展开旋转设置" }).click()
  await expect(topChrome.locator('[data-reader-toolbar-panel="zoom"]')).toHaveCount(0)
  await expect(topChrome.locator('[data-reader-toolbar-panel="rotate"]')).toBeVisible()

  let materialPatches = 0
  page.on("request", (request) => {
    if (request.url() === `${backend.url}/reader/config` && request.method() === "PATCH" && request.postData()?.includes('"material"')) materialPatches += 1
  })
  await windowBar.getByRole("button", { name: "打开 NeoView 设置" }).click()
  const settingsDialog = page.getByRole("dialog")
  await settingsDialog.getByRole("button", { name: "外观" }).click()
  await expect(settingsDialog.getByRole("heading", { name: "界面材质" })).toBeVisible()
  const blurSlider = settingsDialog.getByRole("slider", { name: "顶栏背景模糊" })
  await blurSlider.evaluate((element: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(element, "6")
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await expect(settingsDialog.getByText("6px", { exact: true })).toBeVisible()
  expect(materialPatches).toBe(0)
  await expect(topChrome).toHaveCSS("backdrop-filter", /blur\(6px\)/)
  const materialResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"material"') === true)
  await blurSlider.dispatchEvent("pointerup")
  expect((await materialResponse).status()).toBe(200)
  expect(materialPatches).toBe(1)
  const materialConfig = await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")
  expect(materialConfig).toContain("top_toolbar_blur = 6")
  expect(materialConfig).toContain("[nodes.neoview.panels]")
  const shadowSlider = settingsDialog.getByRole("slider", { name: "顶栏阴影强度" })
  await shadowSlider.scrollIntoViewIfNeeded()
  await expect(shadowSlider).toBeVisible()
  expect(await settingsDialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await settingsDialog.screenshot({ path: testInfo.outputPath(`neoview-material-settings-${testInfo.project.name}.png`) })
  await page.keyboard.press("Escape")
  await expect(settingsDialog).toHaveCount(0)

  const bottomChrome = page.locator('[data-reader-edge-chrome="bottom"]')
  const bottomControls = bottomChrome.locator('[data-reader-bottom-controls="true"]')
  await expect(bottomControls.getByRole("button", { name: "显示页码" })).toBeVisible()
  await expect(bottomControls.getByRole("button", { name: "显示区域参考线" })).toBeVisible()
  await expect(bottomControls.getByRole("button", { name: "显示边栏触发区" })).toBeVisible()
  await expect(bottomControls.getByRole("button", { name: "进度条荧光" })).toBeVisible()
  await expect(bottomChrome.getByRole("slider", { name: "阅读进度" })).toHaveValue("0")
  const pageNumberButton = bottomControls.getByRole("button", { name: "显示页码" })
  if (testInfo.project.name === "chromium-card") {
    await pageNumberButton.evaluate((element: HTMLButtonElement) => element.click())
  } else {
    await pageNumberButton.click()
  }
  await expect(bottomControls.getByRole("button", { name: "显示页码" })).toHaveAttribute("aria-pressed", "false")
  await page.screenshot({ path: testInfo.outputPath(`neoview-four-edge-shell-${testInfo.project.name}.png`) })
  await topChrome.getByRole("button", { name: "展开旋转设置" }).click()
  await expect(topChrome.locator('[data-reader-toolbar-row="expanded"]')).toHaveCount(0)
  const hideTopResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"top":{"pinned":false,"lockMode":"locked-hidden"}') === true)
  await card.getByRole("combobox", { name: "上边锁定模式" }).selectOption("locked-hidden")
  expect((await hideTopResponse).status()).toBe(200)
  await expect(page.locator('[data-reader-edge="top"]')).toBeHidden()

  const floating = page.locator('[data-layer-id="sidebar-control"]')
  await expect(floating).toBeVisible()
  const disableResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"floating":{"enabled":false') === true)
  await card.getByRole("switch", { name: "启用浮动控制器" }).click()
  expect((await disableResponse).status()).toBe(200)
  await expect(floating).toHaveCount(0)

  const enableResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"floating":{"enabled":true') === true)
  await card.getByRole("switch", { name: "启用浮动控制器" }).click()
  expect((await enableResponse).status()).toBe(200)
  await expect(floating).toBeVisible()

  const hideLeftForDragResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"left"') === true
    && response.request().postData()?.includes('"lockMode":"locked-hidden"') === true)
  await card.getByRole("combobox", { name: "左边锁定模式" }).selectOption("locked-hidden")
  expect((await hideLeftForDragResponse).status()).toBe(200)
  await expect(page.locator('[data-reader-sidebar="left"]')).toBeHidden()
  const hideRightForDragResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"right"') === true
    && response.request().postData()?.includes('"lockMode":"locked-hidden"') === true)
  await card.getByRole("combobox", { name: "右边锁定模式" }).selectOption("locked-hidden")
  expect((await hideRightForDragResponse).status()).toBe(200)
  await expect(rightSidebar).toBeHidden()

  const floatingRightButton = floating.getByRole("button", { name: /^右侧边栏：/ })
  await expect(floatingRightButton).toHaveAttribute("aria-pressed", "false")

  let positionPatches = 0
  page.on("request", (request) => {
    if (request.url() === `${backend.url}/reader/config` && request.method() === "PATCH" && request.postData()?.includes('"position"')) positionPatches += 1
  })
  const dragResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"position"') === true)
  const handle = floating.getByRole("button", { name: "拖动侧栏控制器" })
  const handleBox = await handle.boundingBox()
  expect(handleBox).not.toBeNull()
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x + 48, handleBox!.y + 36, { steps: 40 })
  expect(positionPatches).toBe(0)
  await page.mouse.up()
  expect((await dragResponse).status()).toBe(200)
  expect(positionPatches).toBe(1)

  const reopenRightResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"right"') === true
    && response.request().postData()?.includes('"lockMode":"locked-open"') === true)
  await floating.getByRole("button", { name: "右侧边锁定模式" }).click()
  await page.getByRole("menuitemradio", { name: "锁定展开" }).click()
  expect((await reopenRightResponse).status()).toBe(200)
  await expect(floatingRightButton).toHaveAttribute("aria-pressed", "true")
  await expect(rightSidebar).toBeVisible()

  const unlockLeftResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"left"') === true
    && response.request().postData()?.includes('"lockMode":"auto"') === true)
  await card.getByRole("combobox", { name: "左边锁定模式" }).selectOption("auto")
  expect((await unlockLeftResponse).status()).toBe(200)
  const lockResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"lockMode":"locked-hidden"') === true)
  await card.getByRole("combobox", { name: "左边锁定模式" }).selectOption("locked-hidden")
  expect((await lockResponse).status()).toBe(200)
  await expect(page.locator('[data-reader-edge="left"]')).toBeHidden()

  const triggerResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"triggerSize":48') === true)
  await card.getByRole("spinbutton", { name: "右边触发区大小" }).fill("48")
  expect((await triggerResponse).status()).toBe(200)
  await page.screenshot({ path: testInfo.outputPath(`neoview-sidebar-control-${testInfo.project.name}.png`) })

  const resetResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"reset":"known-defaults"') === true)
  await card.getByRole("button", { name: "恢复边栏默认布局" }).click()
  expect((await resetResponse).status()).toBe(200)
  await expect(page.locator('[data-reader-edge="left"]')).toBeVisible()

  expect(await image.getAttribute("data-sidebar-control-image-instance")).toBe("stable")
  expect(await image.getAttribute("src")).toBe(assetUrl)
  const config = await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")
  expect(config).toContain("[nodes.neoview.panels]")
  expect(config).not.toContain("[nodes.neoview.panels.edges.left]")
  expect(pageErrors).toEqual([])
  const finalConfig = await fetch(`${backend.url}/reader/config`, { headers: { "x-xiranite-token": backend.token } })
    .then((response) => response.json()) as { shell: { revision: number } }
  const cleanupResponse = await fetch(`${backend.url}/reader/config`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-xiranite-token": backend.token },
    body: JSON.stringify({
      expectedRevision: finalConfig.shell.revision,
      shellControl: { edges: { left: { pinned: false, initialVisible: false, lockMode: "auto" } } },
    }),
  })
  expect(cleanupResponse.status).toBe(200)
})

test("[neoview.shell.pin-e2e] persists pin state and restores sidebar auto-hide", async ({ page }) => {
  const startupErrors: string[] = []
  page.on("pageerror", (error) => startupErrors.push(error.stack ?? error.message))
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1_000)
  expect(startupErrors).toEqual([])
  await page.getByRole("button", { name: "打开书籍" }).click()
  await expect(page.locator("img[data-reader-page-image]").first()).toBeVisible()

  const leftSidebar = page.locator('[data-reader-sidebar="left"]')
  const leftEdge = page.getByRole("region", { name: "NeoView 左侧面板" })
  await page.mouse.move(1, page.viewportSize()!.height / 2)
  await expect(leftSidebar).toBeVisible()

  const pinResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"side":"left"') === true
    && response.request().postData()?.includes('"pinned":true') === true
  ))
  await leftSidebar.getByRole("button", { name: "固定左侧栏" }).click()
  expect((await pinResponse).status()).toBe(200)
  await expect(leftEdge).toHaveAttribute("data-pinned", "true")
  const viewport = page.viewportSize()!
  await page.mouse.move(viewport.width - 1, viewport.height / 2)
  await expect(leftSidebar).toBeVisible()

  const unpinResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"side":"left"') === true
    && response.request().postData()?.includes('"pinned":false') === true
  ))
  await leftSidebar.getByRole("button", { name: "取消固定左侧栏" }).click()
  expect((await unpinResponse).status()).toBe(200)
  await page.mouse.move(viewport.width - 1, viewport.height / 2)
  await expect(leftSidebar).toHaveCount(0, { timeout: 1_500 })
  expect(await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")).toContain("pinned = false")

  await page.mouse.move(1, viewport.height / 2)
  await expect(leftSidebar).toBeVisible()
  await expect(leftEdge).toHaveAttribute("data-pinned", "false")
  await expect(leftSidebar.getByRole("button", { name: "固定左侧栏" })).toBeVisible()
})

test("[neoview.slideshow.config-e2e] loads and persists slideshow controls", async ({ page }) => {
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()
  await expect(page.locator("img[data-reader-page-image]").first()).toBeVisible()

  const interval = page.getByRole("spinbutton", { name: "幻灯片间隔" })
  await expect(interval).toHaveValue("7")
  await expect(page.getByRole("button", { name: "随机播放" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "循环播放" })).toHaveAttribute("aria-pressed", "false")

  const intervalResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"intervalSeconds":9') === true
  ))
  await interval.fill("9")
  expect((await intervalResponse).status()).toBe(200)

  const loopResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/config`
    && response.request().method() === "PATCH"
    && response.request().postData()?.includes('"loop":true') === true
  ))
  await page.getByRole("button", { name: "循环播放" }).click()
  expect((await loopResponse).status()).toBe(200)
  const persisted = await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")
  expect(persisted).toContain("[nodes.neoview.slideshow]")
  expect(persisted).toContain("interval_seconds = 9")
  expect(persisted).toContain("loop = true")
  expect(persisted).toContain("random = true")
  expect(persisted).toContain("fade_transition = false")
})

test("[neoview.slideshow.fade-e2e] fades the decoded slideshow frame without changing manual page turns", async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === "chromium-card"
    ? { width: 420, height: 360 }
    : { width: 1920, height: 1080 })
  const runtimeErrors: string[] = []
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()
  await expect(page.getByRole("img", { name: "001.jpg" })).toBeVisible()

  await page.getByRole("button", { name: "打开 NeoView 设置" }).click()
  const settings = page.getByRole("dialog")
  await settings.getByRole("button", { name: "通用" }).click()
  const interval = settings.getByRole("spinbutton", { name: "幻灯片间隔秒数" })
  await interval.fill("1")
  const random = settings.getByRole("switch", { name: "随机顺序" })
  if (await random.getAttribute("data-state") === "checked") await random.click()
  const fade = settings.getByRole("switch", { name: "淡入淡出" })
  if (await fade.getAttribute("data-state") !== "checked") await fade.click()
  await expect(fade).toHaveAttribute("data-state", "checked")
  await page.keyboard.press("Escape")

  await page.evaluate(() => {
    const marker = "__neoviewSlideshowFadeObserved"
    ;(window as unknown as Record<string, unknown>)[marker] = false
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-reader-page-transition-source="slideshow"]')) return
      ;(window as unknown as Record<string, unknown>)[marker] = true
      observer.disconnect()
    })
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-reader-page-transition-source"] })
  })
  const toolbar = page.locator('[data-reader-view-toolbar="true"]')
  await toolbar.getByRole("button", { name: "展开幻灯片设置" }).click()
  await toolbar.getByRole("button", { name: "播放幻灯片" }).click()
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__neoviewSlideshowFadeObserved === true, undefined, { timeout: 3_000 })
  await expect(page.getByRole("img", { name: "002.png" })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath(`neoview-slideshow-fade-${testInfo.project.name}.png`) })
  await toolbar.getByRole("button", { name: "暂停幻灯片" }).click()

  await page.locator("[data-reader-app]").focus()
  await page.keyboard.press("ArrowLeft")
  await expect(page.getByRole("img", { name: "001.jpg" })).toBeVisible()
  await expect(page.locator('[data-reader-page-transition-source="slideshow"]')).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code !== "ENOENT")
  }
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
