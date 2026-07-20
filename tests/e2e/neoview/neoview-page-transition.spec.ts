import { expect, test } from "@playwright/test"

test("[neoview.page-transition.ui] [neoview.page-transition.ui-1920x1080] [neoview.page-transition.image-identity] [neoview.page-transition.zero-duplicate-request] [neoview.page-transition.navigation-performance] keeps the animation switch interactive and stable", async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === "chromium-card"
    ? { width: 420, height: 360 }
    : { width: 1920, height: 1080 })
  const consoleErrors: string[] = []
  const requests = new Map<string, number>()
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  await page.route("**/__neoview-page-transition/page-*.svg", async (route) => {
    const url = route.request().url()
    requests.set(url, (requests.get(url) ?? 0) + 1)
    const index = url.includes("page-1.svg") ? 1 : 0
    const color = index === 0 ? "#c7353c" : "#326a55"
    await route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#111318"/><rect x="80" y="70" width="1040" height="660" rx="8" fill="${color}" stroke="#f1eee8" stroke-width="10"/><text x="600" y="410" text-anchor="middle" font-family="sans-serif" font-size="72" fill="#fff">Page ${index + 1}</text></svg>`,
    })
  })
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.fulfill({
    contentType: "text/css",
    body: "",
  }))
  await page.goto("/tests/e2e/neoview/neoview-page-transition-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Page Transition Harness")
  const image = page.locator('[data-reader-page-image="page-0"]')
  await expect(image).toBeVisible()
  await image.evaluate((element) => { (window as typeof window & { __originalPageTransitionImage?: Element }).__originalPageTransitionImage = element })
  const originalSource = await image.getAttribute("src")
  await page.getByRole("switch", { name: "启用翻页动画" }).click()
  await page.getByLabel("动画类型").selectOption("slide")
  const duration = page.getByRole("slider", { name: "动画时长" })
  await duration.focus()
  await duration.press("ArrowRight")
  await expect.poll(() => page.locator("html").getAttribute("data-page-transition-writes")).toBe("3")
  expect(await image.evaluate((element) => (window as typeof window & { __originalPageTransitionImage?: Element }).__originalPageTransitionImage === element)).toBe(true)
  expect(await image.getAttribute("src")).toBe(originalSource)
  expect(requests.get(new URL(originalSource!, page.url()).href)).toBe(1)
  const navigationStartedAt = Date.now()
  await page.getByRole("button", { name: "下一页" }).click()
  const layer = page.locator("[data-reader-page-transition-layer]")
  await expect(layer).toHaveAttribute("data-reader-page-transition-direction", "next")
  expect(Date.now() - navigationStartedAt).toBeLessThan(250)
  await expect.poll(() => layer.getAttribute("data-reader-page-transition-direction")).toBeNull()
  await expect(page.locator('[data-reader-page-image="page-1"]')).toBeVisible()
  for (const count of requests.values()) expect(count).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`neoview-page-transition-${testInfo.project.name}.png`), fullPage: false })
})
