import { expect, test } from "@playwright/test"

test("[neoview.switch-toast.ui-1920x1080] [neoview.switch-toast.resident] [neoview.switch-toast.image-identity] keeps the full Card interactive before and after opening", async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === "chromium-card"
    ? { width: 420, height: 360 }
    : { width: 1920, height: 1080 })
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.fulfill({ contentType: "text/css", body: "" }))
  await page.goto("/tests/e2e/neoview/neoview-switch-toast-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Switch Toast Harness")
  const card = page.locator('[data-neoview-card="switch-toast"]')
  await expect(card).toHaveAttribute("data-switch-toast-state", "ready")
  await expect(card.getByText("提示悬浮窗")).toBeVisible()
  await expect(card.getByRole("switch")).toHaveCount(5)

  const image = page.locator('[data-reader-page-image="switch-toast-page"]')
  await expect(image).toBeVisible()
  await image.evaluate((element) => { (window as typeof window & { __switchToastImage?: Element }).__switchToastImage = element })
  const originalSource = await image.getAttribute("src")

  await card.getByRole("button", { name: "显示测试提示" }).click()
  await expect(page.getByText("切换提示测试")).toBeVisible()
  await expect(page.getByText("X 20px / Y 20px / 透明度 92%" )).toBeVisible()

  await card.getByRole("switch", { name: "切换书籍时显示提示" }).click()
  await card.getByRole("switch", { name: "切换页面时显示提示" }).click()
  const writesBeforeSlider = Number(await page.locator("html").getAttribute("data-switch-toast-writes"))
  const opacity = card.getByRole("slider", { name: "透明度" })
  const track = card.locator('[data-slot="slider-track"]')
  const box = await track.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + box!.width * 0.7, box!.y + box!.height / 2)
  await expect(opacity).toHaveAttribute("aria-valuenow", /0\.7/)
  await expect.poll(() => page.locator("html").getAttribute("data-switch-toast-writes")).toBe(String(writesBeforeSlider + 1))

  await page.getByRole("button", { name: "打开书本" }).click()
  await expect(page.getByText("已切换到 Demo（第 1 / 2 页）")).toBeVisible()
  await page.getByRole("button", { name: "下一页" }).click()
  await expect(page.getByText("第 2 / 2 页")).toBeVisible()

  expect(await image.evaluate((element) => (window as typeof window & { __switchToastImage?: Element }).__switchToastImage === element)).toBe(true)
  expect(await image.getAttribute("src")).toBe(originalSource)
  const dismissButtons = page.getByRole("button", { name: "关闭切换提示" })
  while (await dismissButtons.count()) await dismissButtons.first().click()
  await expect(page.locator('[data-reader-switch-toast="true"]')).toHaveCount(0)
  await page.getByRole("complementary", { name: "控制面板" }).evaluate((element) => { element.scrollTop = 0 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`neoview-switch-toast-${testInfo.project.name}.png`), fullPage: false })
})
