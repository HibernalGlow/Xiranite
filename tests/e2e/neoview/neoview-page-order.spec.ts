import { expect, test } from "@playwright/test"
import { writeFile } from "node:fs/promises"

import { startBackend } from "../../../packages/backend/src/index"
import { createZipFixture, type ZipFixture } from "../../../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1eJrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
))

let fixture: ZipFixture
let backend: Awaited<ReturnType<typeof startBackend>>

test.setTimeout(60_000)

test.beforeAll(async () => {
  fixture = await createZipFixture({
    entries: ["1.png", "2.png", "10.png"].map((path) => ({ path, bytes: ONE_PIXEL_PNG, level: 0 })),
  })
  const configPath = `${fixture.directory}/xiranite.config.toml`
  await writeFile(configPath, [
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.panels]",
    "left_sidebar_visible = false",
    "right_sidebar_visible = false",
    "bottom_panel_visible = false",
    "auto_hide_toolbar = false",
    "",
  ].join("\n"), "utf8")
  backend = await startBackend({
    token: "neoview-page-order-token",
    repository: createMemoryWorkspaceRepository(),
    configPath,
    legacyThumbnailDatabasePath: false,
  })
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.toolbar.page-order-e2e] preserves physical page identity and stable navigation order", async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })

  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  const openedResponse = page.waitForResponse((response) => (
    response.url() === `${backend.url}/reader/sessions` && response.request().method() === "POST"
  ))
  await page.getByRole("textbox", { name: "漫画、图片或目录路径" }).press("Enter")
  const opened = await (await openedResponse).json() as { sessionId: string; visiblePages: Array<{ id: string; name: string }>; pageOrder: { sortMode: string } }
  expect(opened.pageOrder.sortMode).toBe("fileName")
  const physicalId = opened.visiblePages[0]!.id
  const firstImage = page.getByRole("img", { name: "1.png" })
  await expect(firstImage).toBeVisible()
  await firstImage.evaluate((image) => image.setAttribute("data-page-order-identity", "stable"))

  await page.getByRole("button", { name: "页面排序" }).click()
  const panel = page.locator('[data-reader-page-order-panel="true"]')
  await expect(panel).toBeVisible()
  const descendingResponse = page.waitForResponse((response) => response.url().endsWith("/page-order") && response.request().method() === "PATCH")
  await panel.getByRole("button", { name: "文件名" }).click()
  const descending = await (await descendingResponse).json() as {
    visiblePages: Array<{ id: string; index: number; name: string }>
    pageOrder: { sortMode: string; mediaPriority: string }
  }
  expect(descending).toMatchObject({
    visiblePages: [{ id: physicalId, index: 2, name: "1.png" }],
    pageOrder: { sortMode: "fileNameDescending", mediaPriority: "none" },
  })
  await expect(page.getByRole("img", { name: "1.png" })).toBeVisible()
  await expect(page.getByRole("img", { name: "1.png" })).toHaveAttribute("data-page-order-identity", "stable")

  const reader = page.locator('[data-reader-app="true"]')
  await reader.focus()
  await reader.press("ArrowLeft")
  await expect(page.getByRole("img", { name: "2.png" })).toBeVisible()
  const randomResponse = page.waitForResponse((response) => response.url().endsWith("/page-order") && response.request().method() === "PATCH")
  await panel.getByRole("button", { name: "随机" }).click()
  const random = await (await randomResponse).json() as { frame: { anchorPageIndex: number }; pageOrder: { sortMode: string; randomSeed: string } }
  expect(random.pageOrder.sortMode).toBe("random")
  expect(random.pageOrder.randomSeed).toMatch(/^[a-f0-9]{32}$/)
  const beforeNavigation = await pageNames(opened.sessionId)
  const navigationResponse = page.waitForResponse((response) => response.url().endsWith("/navigate") && response.request().method() === "POST")
  await reader.focus()
  await reader.press(random.frame.anchorPageIndex < beforeNavigation.length - 1 ? "ArrowRight" : "ArrowLeft")
  expect((await navigationResponse).ok()).toBe(true)
  expect(await pageNames(opened.sessionId)).toEqual(beforeNavigation)

  const lockResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/config` && response.request().method() === "PATCH")
  await panel.getByRole("button", { name: "锁定页面排序" }).click()
  expect(await (await lockResponse).json()).toMatchObject({ book: { lockedSortMode: "random", lockedMediaPriority: null } })
  await expect(panel.getByRole("button", { name: "解锁页面排序" })).toHaveAttribute("aria-pressed", "true")

  const bounds = await panel.boundingBox()
  const viewport = page.viewportSize()!
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
  await page.screenshot({ path: testInfo.outputPath(`neoview-page-order-${testInfo.project.name}.png`) })
  expect(runtimeErrors).toEqual([])
})

async function pageNames(sessionId: string): Promise<string[]> {
  const response = await fetch(`${backend.url}/reader/s/${encodeURIComponent(sessionId)}/pages?cursor=0&limit=10`, {
    headers: { "x-xiranite-token": backend.token },
  })
  expect(response.ok).toBe(true)
  const payload = await response.json() as { pages: Array<{ name: string }> }
  return payload.pages.map((page) => page.name)
}
