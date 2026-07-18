import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"
import { createZipFixture, type ZipFixture } from "../../../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"))
let fixture: ZipFixture
let backend: Awaited<ReturnType<typeof startBackend>>

test.setTimeout(90_000)

test.beforeAll(async () => {
  fixture = await createZipFixture({ entries: [{ path: "pages/001.png", bytes: ONE_PIXEL_PNG, level: 0 }] })
  const configPath = join(fixture.directory, "xiranite.config.toml")
  await writeFile(configPath, [
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.panels]",
    "left_sidebar_visible = true",
    "right_sidebar_visible = true",
    "[nodes.neoview.panels.sidebars.left]",
    "pinned = true",
    "open = true",
    "width = 240",
    "[nodes.neoview.panels.sidebars.right]",
    "pinned = true",
    "open = true",
    "width = 240",
    "",
  ].join("\n"), "utf8")
  backend = await startBackend({
    token: "neoview-panel-dnd-e2e",
    repository: createMemoryWorkspaceRepository(),
    configPath,
    legacyThumbnailDatabasePath: join(fixture.directory, "thumbnails.db"),
  })
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.sidebar.panel-dnd-e2e] reorders and moves panel icons through one shared board", async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on("pageerror", (error) => runtimeErrors.push(error.stack ?? error.message))
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()) })
  await openReader(page)
  expect(runtimeErrors, "NeoView harness runtime errors").toEqual([])
  const image = page.locator('img[alt="001.png"]')
  await expect(image).toBeVisible()
  await image.evaluate((node) => node.setAttribute("data-panel-dnd-image-instance", "stable"))

  const left = page.locator('[data-reader-panel-rail="left"]')
  const right = page.locator('[data-reader-panel-rail="right"]')
  await expect(left).toBeVisible()
  await expect(right).toBeVisible()

  let boardPatches = 0
  page.on("request", (request) => {
    if (request.url() === `${backend.url}/reader/config` && request.method() === "PATCH" && request.postData()?.includes('"board"')) boardPatches += 1
  })

  const history = left.getByRole("button", { name: "历史记录", exact: true })
  const bookmark = left.getByRole("button", { name: "书签", exact: true })
  const reorderResponse = page.waitForResponse(isBoardResponse)
  await dragPanel(history, bookmark)
  expect((await reorderResponse).status()).toBe(200)
  expect(runtimeErrors, "NeoView runtime errors after a panel reorder").toEqual([])
  await expect.poll(() => panelButtonNames(left)).toEqual(expect.arrayContaining(["文件夹", "书签", "页面列表", "历史记录"]))
  await expect.poll(() => panelButtonNames(left)).toHaveLength(4)
  expect(await indexOfPanel(left, "历史记录")).toBeGreaterThan(await indexOfPanel(left, "书签"))
  expect(boardPatches).toBe(1)

  const moveResponse = page.waitForResponse(isBoardResponse)
  await dragPanel(left.getByRole("button", { name: "历史记录", exact: true }), right.getByRole("button", { name: "信息", exact: true }))
  const moved = await moveResponse
  expect(moved.status()).toBe(200)
  expect((await moved.json() as { shell: { panelLayout: Record<string, { position: string }> } }).shell.panelLayout.history?.position).toBe("right")
  expect(runtimeErrors, "NeoView runtime errors after a cross-sidebar drop").toEqual([])
  await expect(right.getByRole("button", { name: "历史记录", exact: true })).toBeVisible()
  await expect(left.getByRole("button", { name: "历史记录", exact: true })).toHaveCount(0)
  expect(boardPatches).toBe(2)
  if (testInfo.project.name === "chromium-desktop") {
    expect(await image.getAttribute("data-panel-dnd-image-instance")).toBe("stable")
  } else {
    await expect(page.locator('[data-reader-frame-viewport="true"]')).toBeAttached()
  }

  if (testInfo.project.name === "chromium-desktop") {
    const viewport = page.viewportSize()!
    await page.mouse.move(viewport.width / 2, 1)
    const windowBar = page.locator('[data-reader-window-bar="true"]')
    await expect(windowBar).toBeVisible()
    await windowBar.getByRole("button", { name: "打开 NeoView 设置" }).click()
    await page.getByRole("button", { name: "卡片管理" }).click()
    await expect(page.locator('[data-panel-layout-column="history"]')).toContainText("右侧栏")
    await page.getByRole("button", { name: "边栏管理", exact: true }).click()
    await expect(page.getByRole("combobox", { name: "历史记录位置" })).toHaveValue("right")
    await page.keyboard.press("Escape")
  }
  await page.screenshot({ path: testInfo.outputPath(`neoview-panel-dnd-${testInfo.project.name}.png`) })

  await page.reload({ waitUntil: "domcontentloaded" })
  await openBook(page)
  await expect(page.locator('[data-reader-panel-rail="right"]').getByRole("button", { name: "历史记录", exact: true })).toBeVisible()
  const app = page.locator('[data-reader-app="true"]')
  await expect.poll(() => app.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)

  function isBoardResponse(response: import("@playwright/test").Response): boolean {
    return response.url() === `${backend.url}/reader/config`
      && response.request().method() === "PATCH"
      && response.request().postData()?.includes('"board"') === true
  }
})

async function openReader(page: Page): Promise<void> {
  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("button", { name: /^fixture\.cbz/ })).toBeVisible({ timeout: 20_000 })
  await openBook(page)
}

async function openBook(page: Page): Promise<void> {
  const response = page.waitForResponse((value) => value.url() === `${backend.url}/reader/sessions` && value.request().method() === "POST")
  await page.getByRole("button", { name: /^fixture\.cbz/ }).dblclick()
  expect((await response).status()).toBe(201)
  await expect(page.locator('img[alt="001.png"]')).toBeVisible()
}

async function dragPanel(source: Locator, target: Locator): Promise<void> {
  const page = source.page()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error("Panel drag source or target is not rendered.")
  const sourceX = sourceBox.x + sourceBox.width / 2
  const sourceY = sourceBox.y + sourceBox.height / 2
  const targetX = targetBox.x + targetBox.width / 2
  const targetY = targetBox.y + targetBox.height * 0.82
  await page.mouse.move(sourceX, sourceY)
  await page.mouse.down()
  await page.mouse.move(sourceX, sourceY + 8, { steps: 2 })
  await page.mouse.move(targetX, targetY, { steps: 16 })
  await page.waitForTimeout(120)
  await page.mouse.up()
}

async function panelButtonNames(rail: Locator): Promise<string[]> {
  return rail.locator('button[aria-roledescription="sortable"]').evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""))
}

async function indexOfPanel(rail: Locator, name: string): Promise<number> {
  return (await panelButtonNames(rail)).indexOf(name)
}
