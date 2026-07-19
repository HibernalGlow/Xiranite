import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1920, height: 1080 } })

test("[neoview.progressive-upscale.ui-1920x1080] [neoview.progressive-upscale.resident] keeps settings interactive without a book", async ({ page }, testInfo) => {
  await page.goto("/tests/e2e/neoview/neoview-progressive-upscale-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Progressive Upscale Harness")
  const card = page.locator("[data-neoview-progressive-upscale=true]")
  await expect(card).toBeVisible()
  await expect(page.getByRole("switch", { name: "预超分" })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "预加载页数" })).toBeVisible()

  await page.getByRole("switch", { name: "递进超分" }).click()
  await page.getByRole("combobox", { name: "停留时间" }).selectOption("5")
  await page.getByRole("combobox", { name: "最大页数" }).selectOption("999")
  await expect.poll(() => page.locator("html").getAttribute("data-upscale-writes")).toBe("3")
  await expect(card).toContainText("停留 5 秒后自动向后超分")
  await page.screenshot({ path: testInfo.outputPath("neoview-progressive-upscale-1920x1080.png"), fullPage: false })
})
