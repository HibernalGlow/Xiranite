import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"
import { createZipFixture, type ZipFixture } from "../../../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
))

let fixture: ZipFixture
let backend: Awaited<ReturnType<typeof startBackend>>

test.setTimeout(90_000)

test.beforeAll(async () => {
  const sharpModule = await import("sharp")
  const sharp = (sharpModule as unknown as { default?: typeof import("sharp") }).default ?? sharpModule
  const largeJpeg = await sharp({
    create: { width: 2000, height: 3000, channels: 3, background: { r: 130, g: 85, b: 190 } },
  }).jpeg({ quality: 90 }).toBuffer()
  fixture = await createZipFixture({
    entries: [
      { path: "pages/001.jpg", bytes: largeJpeg, level: 6 },
      { path: "pages/002.png", bytes: ONE_PIXEL_PNG, level: 0 },
    ],
  })
  backend = await startBackend({
    token: "neoview-e2e-token",
    repository: createMemoryWorkspaceRepository(),
    configPath: join(fixture.directory, "xiranite.config.toml"),
  })
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.react.cbz-e2e] decodes and navigates a real CBZ through React img and loopback streaming", async ({ page }) => {
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

  const first = page.getByRole("img", { name: "001.jpg" })
  await expect(first).toBeVisible()
  await expect.poll(() => first.getAttribute("src")).toContain("format=webp")
  await expect.poll(() => first.evaluate((image: HTMLImageElement) => (
    image.complete && image.naturalWidth > 1 && image.naturalWidth < 2000
  ))).toBe(true)
  await expect(page.locator("canvas")).toHaveCount(0)

  await page.getByRole("button", { name: "下一页" }).click()
  const second = page.getByRole("img", { name: "002.png" })
  await expect(second).toBeVisible()
  await expect.poll(() => second.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
  await expect(page.getByText("2 / 2")).toBeVisible()

  await page.getByRole("button", { name: "关闭书籍" }).click()
  await expect.poll(async () => (await fetch(`${backend.url}/reader/s/${opened.sessionId}`, {
    headers: { "x-xiranite-token": backend.token },
  })).status).toBe(404)
})
