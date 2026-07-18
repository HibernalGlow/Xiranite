import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1920, height: 1080 } })

test("[neoview.info-overlay.ui-1920x1080] [neoview.info-overlay.resident] keeps Card and overlay independent of book open", async ({ page }, testInfo) => {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort())
  await page.goto("/tests/e2e/neoview/neoview-info-overlay-harness.html", { waitUntil: "domcontentloaded" })
  const card = page.locator('[data-neoview-card="info-overlay"]')
  await expect(card).toHaveAttribute("data-info-overlay-state", "ready")
  await expect(card.getByRole("switch")).toHaveCount(2)
  await expect(card.getByRole("spinbutton", { name: "透明度百分比" })).toHaveValue("85")
  await expect(card.getByText("自动", { exact: true })).toHaveCount(2)
  await expect(page.locator('[data-reader-info-overlay="true"]')).toHaveCount(0)

  const image = page.locator('[data-reader-page-image="info-overlay-page"]')
  const originalSource = await image.getAttribute("src")
  await card.getByRole("switch", { name: "启用悬浮窗" }).click()
  await page.getByRole("button", { name: "打开书本" }).click()
  await expect(page.locator('[data-reader-info-overlay="true"]')).toBeVisible()
  await expect(page.getByText("001.jpg", { exact: true })).toBeVisible()
  await expect(page.getByText("1200×1800", { exact: true })).toBeVisible()

  const slider = card.getByRole("slider", { name: "宽度" })
  await slider.focus()
  await page.keyboard.press("ArrowRight")
  await expect(card.getByText("500 px", { exact: true })).toBeVisible()
  await expect.poll(() => page.locator("html").getAttribute("data-info-overlay-writes")).toBe("1")

  const overlay = page.locator('[data-reader-info-overlay="true"]')
  await overlay.getByRole("button", { name: "拖动以移动信息条" }).dragTo(page.locator("main"), { targetPosition: { x: 1000, y: 300 } })
  expect(await image.evaluate((element) => element === document.querySelector('[data-reader-page-image="info-overlay-page"]'))).toBe(true)
  expect(await image.getAttribute("src")).toBe(originalSource)
  await expect(page.locator("html")).toHaveAttribute("data-info-overlay-writes", "1")
  await page.screenshot({ path: testInfo.outputPath("neoview-info-overlay-1920x1080.png"), fullPage: false })
})
