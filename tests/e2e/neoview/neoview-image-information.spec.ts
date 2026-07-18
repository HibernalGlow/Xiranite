import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1920, height: 1080 } })

test("[neoview.image-information.resident-empty-1920x1080] keeps the media information Card visible before a book opens", async ({ page }, testInfo) => {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort())
  await page.goto("/tests/e2e/neoview/neoview-image-information-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Image Information Harness")
  const card = page.locator('[data-neoview-card="image-information"]')
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute("data-image-information-state", "empty")
  await expect(card.getByText("暂无媒体信息")).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("neoview-image-information-1920x1080.png"), fullPage: false })
})
