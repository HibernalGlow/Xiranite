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
    { path: "001.png", bytes: ONE_PIXEL_PNG, level: 0 },
    { path: "002.png", bytes: ONE_PIXEL_PNG, level: 0 },
    { path: "003.png", bytes: ONE_PIXEL_PNG, level: 0 },
  ] })
  const configPath = join(fixture.directory, "xiranite.config.toml")
  await writeFile(configPath, [
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.panels.edges.top]",
    "enabled = true",
    "initial_visible = true",
    "pinned = true",
    'lock_mode = "locked-open"',
    "[nodes.neoview.panels.edges.left]",
    "enabled = false",
    "[nodes.neoview.panels.edges.right]",
    "enabled = false",
    "[nodes.neoview.panels.edges.bottom]",
    "enabled = false",
    "",
  ].join("\n"), "utf8")
  backend = await startBackend({
    token: "neoview-bindings-e2e",
    repository: createMemoryWorkspaceRepository(),
    configPath,
    legacyThumbnailDatabasePath: false,
  })
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.bindings.e2e] edits a contextual keyboard binding without leaking into editors", async ({ page }, testInfo) => {
  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-book-information-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  const openedResponse = page.waitForResponse((response) => response.url() === `${backend.url}/reader/sessions` && response.request().method() === "POST")
  await page.getByRole("button", { name: "打开书籍" }).click()
  await openedResponse
  const reader = page.locator('[data-reader-app="true"]')
  await expect(page.locator('img[alt="001.png"]')).toBeVisible()
  await reader.focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.locator('img[alt="002.png"]')).toBeVisible()

  await page.getByRole("button", { name: "打开 NeoView 设置" }).click()
  await page.getByRole("button", { name: "操作绑定" }).click()
  const card = page.locator('[data-neoview-settings-card="input-bindings"]')
  await expect(card.getByRole("heading", { name: "操作绑定" })).toBeVisible()
  await expect(card.getByRole("option", { name: "键盘" }).first()).toBeAttached()
  await expect(card.getByRole("option", { name: "鼠标" }).first()).toBeAttached()
  await expect(card.getByRole("option", { name: "触控" }).first()).toBeAttached()
  await expect(card.getByRole("option", { name: "手柄" }).first()).toBeAttached()
  await card.getByRole("textbox", { name: "搜索操作绑定" }).fill("ArrowRight")
  const row = card.getByRole("listitem")
  await expect(row).toHaveCount(1)
  await row.getByRole("textbox", { name: "键盘代码" }).fill("KeyN")

  const patchRequest = page.waitForRequest((request) => request.url() === `${backend.url}/reader/config` && request.method() === "PATCH" && Boolean((request.postDataJSON() as { inputBindings?: unknown } | null)?.inputBindings))
  await card.getByRole("button", { name: "保存" }).click()
  const request = await patchRequest
  expect((request.postDataJSON() as { inputBindings: { bindings: Array<{ input: { code?: string } }> } }).inputBindings.bindings.some((binding) => binding.input.code === "KeyN")).toBe(true)
  await expect(card.getByRole("status")).toContainText("立即生效")
  expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await card.screenshot({ path: testInfo.outputPath(`neoview-input-bindings-${testInfo.project.name}.png`) })

  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await reader.focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.locator('img[alt="002.png"]')).toBeVisible()
  await page.keyboard.press("n")
  await expect(page.locator('img[alt="003.png"]')).toBeVisible()

  await page.getByPlaceholder("选择 CBZ、ZIP、图片或目录").focus()
  await page.keyboard.press("n")
  await expect(page.locator('img[alt="003.png"]')).toBeVisible()
})
