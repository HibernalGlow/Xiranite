import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1920, height: 1080 } })

test("[neoview.image-trim.ui-1920x1080] [neoview.image-trim.resident] [neoview.image-trim.image-stability] keeps the resident Card interactive before and after opening", async ({ page }, testInfo) => {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort())
  await page.goto("/tests/e2e/neoview/neoview-image-trim-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Image Trim Harness")

  const card = page.locator('[data-neoview-card="image-trim"]')
  await expect(card).toHaveAttribute("data-image-trim-state", "ready")
  await expect(card.getByRole("switch", { name: "启用图像裁剪" })).toBeVisible()

  const image = page.locator('[data-reader-page-image="image-trim-page"]')
  await expect(image).toBeVisible()
  const originalSource = await image.getAttribute("src")
  await image.evaluate((element) => { (window as typeof window & { __originalImageTrimImage?: Element }).__originalImageTrimImage = element })

  await card.getByRole("switch", { name: "启用图像裁剪" }).click()
  await expect(card.getByRole("slider", { name: "上" })).toBeVisible()
  const top = card.getByRole("slider", { name: "上" })
  const topBox = await top.boundingBox()
  expect(topBox).toBeTruthy()
  await page.mouse.move(topBox!.x + 2, topBox!.y + topBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(topBox!.x + topBox!.width * 0.35, topBox!.y + topBox!.height / 2)
  await page.mouse.up()
  await expect.poll(() => page.locator("html").getAttribute("data-image-trim-writes")).toBe("2")
  await expect(image).toHaveCSS("clip-path", /inset\(/)

  await page.getByRole("button", { name: "打开书本" }).click()
  await expect(page.locator('[data-reader-book-state="open"]')).toBeVisible()
  await card.getByRole("slider", { name: "容差" }).focus()
  await page.keyboard.press("ArrowRight")
  await expect.poll(() => page.locator("html").getAttribute("data-image-trim-writes")).toBe("3")

  expect(await image.evaluate((element) => (window as typeof window & { __originalImageTrimImage?: Element }).__originalImageTrimImage === element)).toBe(true)
  expect(await image.getAttribute("src")).toBe(originalSource)
  await expect(page.locator("html")).toHaveAttribute("data-image-trim-writes", "3")
  await page.screenshot({ path: testInfo.outputPath("neoview-image-trim-1920x1080.png"), fullPage: false })
})
