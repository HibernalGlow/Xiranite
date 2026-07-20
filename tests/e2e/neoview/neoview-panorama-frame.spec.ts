import { expect, test } from "@playwright/test"

test("[neoview.viewer.panorama-rendered] keeps the panorama frame attached to the reader viewport", async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === "chromium-card"
    ? { width: 420, height: 360 }
    : { width: 1920, height: 1080 })
  const runtimeErrors: string[] = []
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  await page.route("**/__neoview-panorama/page-*.svg", async (route) => {
    const index = Number(/page-(\d+)\.svg/.exec(route.request().url())?.[1] ?? 0)
    await route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#111318"/><rect x="80" y="70" width="1040" height="660" fill="#326a55"/><text x="600" y="420" text-anchor="middle" font-family="sans-serif" font-size="72" fill="white">Page ${index + 1}</text></svg>`,
    })
  })
  await page.goto("/tests/e2e/neoview/neoview-panorama-frame-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Panorama Frame Harness")
  await expect(page.getByRole("img", { name: "page-1.svg" })).toBeVisible()

  await page.getByRole("button", { name: "Toggle panorama" }).click()
  await expect(page.getByRole("button", { name: "Toggle panorama" })).toHaveAttribute("aria-pressed", "true")
  const viewport = page.getByRole("region", { name: "Reader viewport" })
  const transitionLayer = viewport.locator("[data-reader-page-transition-layer]")
  const panorama = viewport.locator('[data-reader-panorama="true"]')
  await expect(panorama).toBeVisible()
  await expect(page.getByRole("img", { name: "page-1.svg" })).toBeVisible()
  const [viewportBox, layerBox, panoramaBox] = await Promise.all([
    viewport.boundingBox(),
    transitionLayer.boundingBox(),
    panorama.boundingBox(),
  ])
  expect(viewportBox?.height).toBeGreaterThan(0)
  expect(layerBox?.height).toBeCloseTo(viewportBox!.height, 0)
  expect(panoramaBox?.height).toBeCloseTo(viewportBox!.height, 0)
  expect(runtimeErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`neoview-panorama-frame-${testInfo.project.name}.png`) })
})
