import { expect, test } from "@playwright/test"

test("[neoview.color-filter.ui] [neoview.color-filter.ui-1920x1080] keeps the color filter interactive and stable", async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === "chromium-card"
    ? { width: 420, height: 360 }
    : { width: 1920, height: 1080 })
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.fulfill({ contentType: "text/css", body: "" }))
  await page.goto("/tests/e2e/neoview/neoview-color-filter-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Color Filter Harness")
  const image = page.locator('[data-reader-page-image="gray-page"]')
  await expect(image).toBeVisible()
  await image.evaluate((element) => { (window as typeof window & { __originalColorFilterImage?: Element }).__originalColorFilterImage = element })
  const originalSource = await image.getAttribute("src")
  await page.getByRole("switch", { name: "着色" }).click()
  await expect(page.getByLabel("着色预设", { exact: true })).toBeVisible()
  const writesBeforeSlider = Number(await page.locator("html").getAttribute("data-color-filter-writes"))
  const brightness = page.getByRole("slider", { name: "亮度" })
  await brightness.focus()
  await brightness.press("ArrowRight")
  await expect.poll(() => page.locator("html").getAttribute("data-color-filter-writes")).toBe(String(writesBeforeSlider + 1))
  expect(await image.evaluate((element) => (window as typeof window & { __originalColorFilterImage?: Element }).__originalColorFilterImage === element)).toBe(true)
  expect(await image.getAttribute("src")).toBe(originalSource)
  await expect(image).toHaveCSS("filter", /url\(.+neoview-color-filter/)
  await expect(page.locator("svg filter")).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`neoview-color-filter-${testInfo.project.name}.png`), fullPage: false })
})
