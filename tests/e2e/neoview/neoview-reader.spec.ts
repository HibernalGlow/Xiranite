import { mkdir, readFile, writeFile } from "node:fs/promises"
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

test("[neoview.react.cbz-e2e] [neoview.thumbnail.react-e2e] [neoview.shell.e2e] [neoview.folder.tree-layout-e2e] [neoview.folder.tree-pins-e2e] [neoview.folder.tree-roots-e2e] decodes, virtualizes thumbnails and navigates a real CBZ", async ({ page }, testInfo) => {
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
  await page.locator('[data-reader-edge-trigger="bottom"]').hover()
  await expect(bottomEdge).toBeVisible()
  await expect(page.locator("[data-reader-sidebar]")).toHaveCount(0)
  await page.locator('[data-reader-edge-trigger="left"]').hover()
  const leftSidebar = page.locator('[data-reader-sidebar="left"]')
  await expect(leftSidebar).toBeVisible({ timeout: 20_000 })
  const folderCard = leftSidebar.locator('[data-neoview-folder-card="true"]')
  await expect(folderCard).toBeVisible()
  const folderEntries = folderCard.locator('button[aria-selected]')
  await expect.poll(() => folderEntries.count()).toBeGreaterThanOrEqual(3)
  await folderEntries.nth(0).click()
  await folderEntries.nth(2).click({ modifiers: ["Shift"] })
  await expect(folderCard).toHaveAttribute("data-selection-count", "3")
  await folderEntries.nth(1).click({ modifiers: ["Control"] })
  await expect(folderCard).toHaveAttribute("data-selection-count", "2")
  await folderCard.getByRole("button", { name: "多选模式" }).click()
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
  await folderCard.getByRole("button", { name: "文件树" }).click()
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
  expect(treeSettingsToml).toContain("[nodes.neoview.folder.tree_view]")
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
  expect(searchSettingsToml).toContain("[nodes.neoview.folder.search]")
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
  await leftSidebar.getByRole("radio", { name: "详细信息" }).click()
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
  const nameResizeBox = await nameResizeHandle.boundingBox()
  expect(nameResizeBox).not.toBeNull()
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
  expect(folderToml).toContain("[nodes.neoview.folder.details.column_widths]")
  expect(folderToml).toMatch(/name\s*=\s*2[5-9]\d/)
  expect(await first.getAttribute("data-neoview-settings-image-instance")).toBe("stable")
  await page.keyboard.press("Escape")
  await expect(page.locator('[cmdk-item]')).toHaveCount(0)
  if (!await leftSidebar.isVisible()) await page.locator('[data-reader-edge-trigger="left"]').hover()
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
  await page.locator('[data-reader-edge-trigger="bottom"]').hover()
  await expect(bottomEdge).toBeVisible()
  await expect(bottomEdge).toHaveAttribute("data-pinned", "false")
  await page.locator('[data-reader-viewport="true"]').click({ position: { x: viewport.width / 2, y: viewport.height / 2 }, force: true })
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
  const image = page.locator('img[alt="001.jpg"]')
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

  await page.locator('[data-reader-edge-trigger="left"]').hover()
  const leftSidebar = page.locator('[data-reader-sidebar="left"]')
  const leftEdge = page.getByRole("region", { name: "NeoView 左侧面板" })
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
  await expect(leftSidebar).toHaveCount(0, { timeout: 1_500 })
  expect(await readFile(join(fixture.directory, "xiranite.config.toml"), "utf8")).toContain("pinned = false")

  await page.locator('[data-reader-edge-trigger="left"]').hover()
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
