import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import { DEFAULT_READER_INPUT_BINDINGS, type ReaderInputBinding } from "@xiranite/node-neoview/ui-core"

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

  await page.getByRole("button", { name: "打开 NeoView 设置" }).click()
  await page.getByRole("button", { name: "操作绑定" }).click()
  await page.getByRole("textbox", { name: "搜索操作绑定" }).focus()
  await page.keyboard.press("n")
  await expect(page.locator('img[alt="003.png"]')).toBeVisible()
})

test("[neoview.bindings.rollback-e2e] keeps the edited binding when persistence fails", async ({ page }) => {
  const reset = await fetch(`${backend.url}/reader/config`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-xiranite-token": backend.token },
    body: JSON.stringify({ inputBindings: DEFAULT_READER_INPUT_BINDINGS }),
  })
  expect(reset.ok).toBe(true)
  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-book-information-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()
  await expect(page.locator('img[alt="001.png"]')).toBeVisible()
  await page.getByRole("button", { name: "打开 NeoView 设置" }).click()
  await page.getByRole("button", { name: "操作绑定" }).click()
  const card = page.locator('[data-neoview-settings-card="input-bindings"]')
  await card.getByRole("textbox", { name: "搜索操作绑定" }).fill("ArrowRight")
  const row = card.getByRole("listitem")
  await expect(row).toHaveCount(1)
  const code = row.getByRole("textbox", { name: "键盘代码" })
  await code.fill("KeyZ")

  await page.route(`${backend.url}/reader/config`, async (route) => {
    if (route.request().method() !== "PATCH" || !(route.request().postDataJSON() as { inputBindings?: unknown } | null)?.inputBindings) {
      await route.continue()
      return
    }
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "simulated input binding failure" }) })
  })
  await card.getByRole("button", { name: "保存" }).click()
  await expect(card.getByRole("alert")).toContainText("simulated input binding failure")
  await card.getByRole("textbox", { name: "搜索操作绑定" }).fill("KeyZ")
  const retainedRow = card.getByRole("listitem")
  await expect(retainedRow).toHaveCount(1)
  await expect(retainedRow.getByRole("textbox", { name: "键盘代码" })).toHaveValue("KeyZ")
  await page.unroute(`${backend.url}/reader/config`)
})

test("[neoview.bindings.devices-e2e] routes mouse, hold, modified wheel and area input", async ({ page }) => {
  const bindings: ReaderInputBinding[] = [
    ...DEFAULT_READER_INPUT_BINDINGS.bindings,
    { id: "e2e-mouse-next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "mouse", button: 0, action: "click" } },
    { id: "e2e-mouse-hold-previous", action: "reader.previous-page", context: "reader", enabled: true, input: { device: "mouse", button: 1, action: "hold", durationMs: 120, moveTolerancePx: 12 } },
    { id: "e2e-wheel-control-next", action: "reader.next-page", context: "reader", enabled: true, input: { device: "wheel", direction: "down", ctrl: true } },
    { id: "e2e-area-first", action: "reader.first-page", context: "reader", enabled: true, input: { device: "area", area: "top-left", button: 0, action: "press" } },
  ]
  const configured = await fetch(`${backend.url}/reader/config`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-xiranite-token": backend.token },
    body: JSON.stringify({ inputBindings: { bindings } }),
  })
  expect(configured.ok).toBe(true)

  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-book-information-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()
  const reader = page.locator('[data-reader-app="true"]')
  await expect(page.locator('img[alt="001.png"]')).toBeVisible()
  const box = await reader.boundingBox()
  expect(box).toBeTruthy()
  const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }

  await page.mouse.click(center.x, center.y)
  await expect(page.locator('img[alt="002.png"]')).toBeVisible()

  await page.mouse.move(center.x, center.y)
  await page.mouse.down({ button: "middle" })
  await page.waitForTimeout(170)
  await page.mouse.up({ button: "middle" })
  await expect(page.locator('img[alt="001.png"]')).toBeVisible()

  await page.keyboard.down("Control")
  await page.mouse.wheel(0, 120)
  await page.keyboard.up("Control")
  await expect(page.locator('img[alt="002.png"]')).toBeVisible()

  await page.mouse.move(box!.x + box!.width * 0.1, box!.y + box!.height * 0.25)
  await page.mouse.down({ button: "left" })
  await page.mouse.up({ button: "left" })
  await expect(page.locator('img[alt="001.png"]')).toBeVisible()

})

test("[neoview.bindings.gamepad-e2e] routes a connected standard gamepad button through the shared binding runtime", async ({ page }) => {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }))
    const pad = {
      id: "XR virtual standard gamepad",
      index: 0,
      connected: true,
      mapping: "standard",
      timestamp: 0,
      buttons,
      axes: [0, 0, 0, 0],
      vibrationActuator: null,
    }
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] })
    Object.defineProperty(window, "__setFakeGamepadButton", {
      configurable: true,
      value: (index: number, pressed: boolean) => {
        const button = buttons[index]
        if (!button) return
        button.pressed = pressed
        button.touched = pressed
        button.value = pressed ? 1 : 0
        pad.timestamp += 1
      },
    })
  })
  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-book-information-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()
  await expect(page.locator('img[alt="001.png"]')).toBeVisible()
  await expect(page.locator('[data-reader-input-runtime="ready"]')).toHaveCount(1)

  await page.evaluate(() => (window as unknown as { __setFakeGamepadButton(index: number, pressed: boolean): void }).__setFakeGamepadButton(5, true))
  await expect(page.locator('img[alt="002.png"]')).toBeVisible()
  await page.evaluate(() => (window as unknown as { __setFakeGamepadButton(index: number, pressed: boolean): void }).__setFakeGamepadButton(5, false))
  await page.waitForTimeout(80)
  await expect(page.locator('img[alt="002.png"]')).toBeVisible()
})

test("[neoview.bindings.radial-pointer-e2e] opens the copied ray menu from the configured right-button press", async ({ page }) => {
  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-book-information-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()
  const reader = page.locator('[data-reader-app="true"]')
  const box = await reader.boundingBox()
  expect(box).toBeTruthy()
  await expect(page.locator('[data-reader-input-runtime="ready"]')).toHaveCount(1)
  const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
  await page.mouse.move(center.x, center.y)
  await page.mouse.down({ button: "right" })
  const radial = page.locator("neoview-ray-menu")
  await expect(radial).toBeAttached()
  await page.mouse.up({ button: "right" })
  await expect.poll(() => radial.evaluate((element) => Boolean((element as HTMLElement & { isOpen?: boolean }).isOpen))).toBe(true)
  const radialGeometry = await radial.evaluate((element) => {
    const menu = element.shadowRoot?.querySelector<HTMLElement>('[aria-label="Menu"]')
    const rect = menu?.getBoundingClientRect()
    return rect ? { width: rect.width, height: rect.height } : undefined
  })
  expect(radialGeometry?.width).toBeGreaterThan(0)
  expect(radialGeometry?.height).toBeGreaterThan(0)
  await page.keyboard.press("Escape")
  await expect(radial).toHaveCount(0)
})
