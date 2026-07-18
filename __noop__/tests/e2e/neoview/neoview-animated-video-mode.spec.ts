import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1920, height: 1080 } })
test.setTimeout(120_000)

test("[neoview.animated-video.ui-1920x1080] [neoview.animated-video.resident] [neoview.animated-video.image-stability] keeps controls interactive before and after opening", async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort())
  await page.goto("/tests/e2e/neoview/neoview-animated-video-mode-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Animated Video Mode Harness")

  const card = page.locator('[data-neoview-card="animated-video-mode"]')
  await expect(card).toHaveAttribute("data-animated-video-state", "ready")
  await expect(card.getByRole("switch", { name: "启用动图视频模式" })).toBeVisible()
  await expect(card.getByRole("textbox", { name: "动图关键词" })).toHaveValue("[#dyna]")

  const image = page.locator('[data-reader-page-image="animated-video-page"]')
  await expect(image).toBeVisible()
  await image.evaluate((element) => { (window as typeof window & { __animatedVideoImage?: Element }).__animatedVideoImage = element })
  const source = await image.getAttribute("src")

  await card.getByRole("switch", { name: "启用动图视频模式" }).click()
  await card.getByRole("textbox", { name: "动图关键词" }).fill(" [#GIF], #gif, [#dyna] ")
  await expect(card.getByRole("textbox", { name: "动图关键词" })).toHaveValue("[#gif], #gif, [#dyna]")
  await expect(page.locator("html")).toHaveAttribute("data-animated-video-writes", "2")

  await card.getByRole("button", { name: "重新检测 FFmpeg" }).click()
  await expect(card.getByText("当前运行时未提供 FFmpeg 探测")).toBeVisible()
  await expect(card.getByText("不可用", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "打开书本" }).click()
  await expect(page.locator('[data-reader-book-state="open"]')).toBeVisible()
  await card.getByRole("switch", { name: "启用动图视频模式" }).click()
  await expect(page.locator("html")).toHaveAttribute("data-animated-video-writes", "3")

  expect(await image.evaluate((element) => (window as typeof window & { __animatedVideoImage?: Element }).__animatedVideoImage === element)).toBe(true)
  expect(await image.getAttribute("src")).toBe(source)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: "output/playwright/neoview-animated-video-mode-1920x1080.png", fullPage: false })
})
