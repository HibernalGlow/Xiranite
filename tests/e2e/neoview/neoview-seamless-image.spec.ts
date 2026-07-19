import { expect, test, type Page, type Route } from "@playwright/test"
import sharp from "sharp"

const BLUE = "#2563eb"
const GREEN = "#16a34a"

test.use({ viewport: { width: 1280, height: 800 } })

test("[neoview.viewer.seamless-browser-swap] keeps the decoded bitmap visible until page and upscale replacements are ready", async ({ page }, testInfo) => {
  const browserErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") browserErrors.push(`${message.type()}: ${message.text()}`)
  })
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`))
  const blue = deferredRoute(page, "**/delayed-blue.svg", BLUE)
  const green = deferredRoute(page, "**/delayed-green.svg", GREEN)
  await page.goto("/tests/e2e/neoview/neoview-seamless-image-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Seamless Image Harness")
  await expect(page.locator("vite-error-overlay")).toHaveCount(0)
  await expect(page.locator('[data-reader-page-image="red-page"]')).toBeVisible()
  await expectCenterColor(page, [220, 38, 38])

  await page.getByRole("button", { name: "下一页" }).click()
  await blue.requested
  await expect(page.locator('[data-reader-page-image-pending="blue-page"]')).toHaveCount(1)
  await expect(page.locator('[data-reader-page-image="red-page"]')).toBeVisible()
  await expectCenterColor(page, [220, 38, 38])
  blue.release()
  await expect(page.locator('[data-reader-page-image="blue-page"]')).toBeVisible()
  await expectCenterColor(page, [37, 99, 235])

  await page.getByRole("button", { name: "启用超分" }).click()
  await green.requested
  await expect(page.locator('[data-reader-page-image-pending="blue-page"]')).toHaveCount(1)
  await expect(page.locator('[data-reader-page-image="blue-page"]')).toBeVisible()
  await expectCenterColor(page, [37, 99, 235])
  green.release()
  await expect.poll(() => page.locator('[data-reader-page-image="blue-page"]').getAttribute("src")).toContain("delayed-green.svg")
  await expectCenterColor(page, [22, 163, 74])

  await page.getByRole("button", { name: "关闭超分" }).click()
  await expect.poll(() => page.locator('[data-reader-page-image="blue-page"]').getAttribute("src")).toContain("delayed-blue.svg")
  await expectCenterColor(page, [37, 99, 235])
  expect(browserErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath("neoview-seamless-image-final.png"), fullPage: false })
})

function deferredRoute(page: Page, pattern: string, color: string): { requested: Promise<void>; release(): void } {
  let markRequested!: () => void
  let release!: () => void
  const requested = new Promise<void>((resolve) => { markRequested = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  void page.route(pattern, async (route: Route) => {
    markRequested()
    await gate
    await route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${color}"/></svg>`,
    })
  })
  return { requested, release }
}

async function expectCenterColor(page: Page, expected: readonly [number, number, number]): Promise<void> {
  await expect.poll(async () => {
    const screenshot = await page.screenshot()
    const { data, info } = await sharp(screenshot)
      .extract({ left: 639, top: 359, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true })
    return [data[0], data[1], data[2], info.channels]
  }).toEqual([...expected, 3])
}
