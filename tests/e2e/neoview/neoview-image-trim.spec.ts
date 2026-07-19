import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1920, height: 1080 } })

test("[neoview.image-trim.ui-1920x1080] [neoview.image-trim.resident] [neoview.image-trim.enable] [neoview.image-trim.reset] [neoview.image-trim.threshold] [neoview.image-trim.target] [neoview.image-trim.auto-detect] [neoview.image-trim.link-vertical] [neoview.image-trim.link-horizontal] [neoview.image-trim.chunk] [neoview.image-trim.zero-duplicate-request] [neoview.image-trim.image-stability] keeps the resident Card interactive before and after opening", async ({ page }, testInfo) => {
  const imageRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().endsWith("/tests/e2e/neoview/neoview-image-trim-fixture.svg")) imageRequests.push(request.url())
  })
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort())
  await page.goto("/tests/e2e/neoview/neoview-image-trim-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Image Trim Harness")

  const card = page.locator('[data-neoview-card="image-trim"]')
  await expect(card).toHaveAttribute("data-image-trim-state", "ready")
  await expect(card.getByRole("switch", { name: "启用图像裁剪" })).toBeVisible()

  const image = page.locator('[data-reader-page-image="image-trim-page"]')
  await expect(image).toBeVisible()
  await expect(image).toHaveAttribute("data-reader-page-image-decoded", "image-trim-page")
  const originalSource = await image.getAttribute("src")
  await image.evaluate((element) => { (window as typeof window & { __originalImageTrimImage?: Element }).__originalImageTrimImage = element })

  await card.getByRole("switch", { name: "启用图像裁剪" }).click()
  await expect(card.getByRole("slider", { name: "上" })).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("data-image-trim-writes", "1")
  expect(await detectorResourceCount(page)).toBe(0)
  await card.locator('[data-image-trim-action="auto-detect"]').click()
  await expect(card.getByText(/检测完成:/)).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("data-image-trim-writes", "2")
  expect(await detectorResourceCount(page)).toBe(1)
  expect(imageRequests).toHaveLength(1)
  expect(await image.evaluate((element) => (window as typeof window & { __originalImageTrimImage?: Element }).__originalImageTrimImage === element)).toBe(true)
  expect(await image.getAttribute("src")).toBe(originalSource)

  await card.getByRole("button", { name: "上联动" }).click()
  await expect(card.getByRole("button", { name: "上取消联动" })).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("data-image-trim-writes", "3")
  const top = card.getByRole("slider", { name: "上" })
  const topBox = await top.boundingBox()
  expect(topBox).toBeTruthy()
  await page.mouse.move(topBox!.x + 2, topBox!.y + topBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(topBox!.x + topBox!.width * 0.35, topBox!.y + topBox!.height / 2)
  await page.mouse.up()
  await expect.poll(() => page.locator("html").getAttribute("data-image-trim-writes")).toBe("4")
  await expect(card.getByRole("slider", { name: "下" })).toHaveValue(await top.inputValue())

  await card.getByRole("button", { name: "左联动" }).click()
  await expect(card.getByRole("button", { name: "左取消联动" })).toBeVisible()
  await expect(page.locator("html")).toHaveAttribute("data-image-trim-writes", "5")
  const left = card.getByRole("slider", { name: "左" })
  const leftBox = await left.boundingBox()
  expect(leftBox).toBeTruthy()
  await page.mouse.move(leftBox!.x + leftBox!.width * 0.1, leftBox!.y + leftBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(leftBox!.x + leftBox!.width * 0.3, leftBox!.y + leftBox!.height / 2)
  await page.mouse.up()
  await expect.poll(() => page.locator("html").getAttribute("data-image-trim-writes")).toBe("6")
  await expect(card.getByRole("slider", { name: "右" })).toHaveValue(await left.inputValue())
  await expect(image).toHaveCSS("clip-path", /inset\(/)

  await card.getByRole("combobox", { name: "目标颜色" }).selectOption("white")
  await expect(card.getByRole("combobox", { name: "目标颜色" })).toHaveValue("white")
  await expect(page.locator("html")).toHaveAttribute("data-image-trim-writes", "7")

  await page.getByRole("button", { name: "打开书本" }).click()
  await expect(page.locator('[data-reader-book-state="open"]')).toBeVisible()
  await card.getByRole("slider", { name: "容差" }).focus()
  await page.keyboard.press("ArrowRight")
  await expect.poll(() => page.locator("html").getAttribute("data-image-trim-writes")).toBe("8")

  await card.getByRole("button", { name: "重置所有裁剪" }).click()
  await expect(page.locator("html")).toHaveAttribute("data-image-trim-writes", "9")
  await expect(card.getByRole("switch", { name: "启用图像裁剪" })).not.toBeChecked()
  await expect(card.getByRole("slider", { name: "上" })).toHaveCount(0)
  await expect(image).toHaveCSS("clip-path", "none")

  expect(await image.evaluate((element) => (window as typeof window & { __originalImageTrimImage?: Element }).__originalImageTrimImage === element)).toBe(true)
  expect(await image.getAttribute("src")).toBe(originalSource)
  await expect(page.locator("html")).toHaveAttribute("data-image-trim-writes", "9")
  expect(imageRequests).toHaveLength(1)
  await page.screenshot({ path: testInfo.outputPath("neoview-image-trim-1920x1080.png"), fullPage: false })
})

function detectorResourceCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => performance.getEntriesByType("resource")
    .filter((entry) => entry.name.includes("ReaderImageTrimDetector")).length)
}

test("[neoview.image-trim.bounds-browser] [neoview.image-trim.preview] [neoview.image-trim.preview-geometry] [neoview.image-trim.accessibility] preserves native range bounds and preview geometry", async ({ page }) => {
  await page.goto("/tests/e2e/neoview/neoview-image-trim-harness.html", { waitUntil: "domcontentloaded" })
  const card = page.locator('[data-neoview-card="image-trim"]')
  await card.getByRole("switch", { name: "启用图像裁剪" }).click()

  for (const label of ["上", "下", "左", "右"] as const) {
    const slider = card.getByRole("slider", { name: label })
    await expect(slider).toHaveAttribute("min", "0")
    await expect(slider).toHaveAttribute("max", "45")
    await expect(slider).toHaveAttribute("step", "0.5")
    await slider.focus()
    await page.keyboard.press("End")
    await expect(slider).toHaveValue("45")
  }
  await expect.poll(() => page.locator("html").getAttribute("data-image-trim-writes")).toBe("5")

  const preview = card.locator('[data-image-trim-preview="true"]')
  await expect(preview).toBeVisible()
  await expect(preview.getByText("10.0% × 10.0%")).toBeVisible()
  await expect(preview.locator(":scope > div").nth(1)).toHaveAttribute("style", "inset: 45%;")

  const verticalLink = card.getByRole("button", { name: "上联动" })
  await verticalLink.focus()
  await page.keyboard.press("Enter")
  await expect(card.getByRole("button", { name: "上取消联动" })).toBeFocused()
  await expect(page.locator("html")).toHaveAttribute("data-image-trim-writes", "6")
})

test.describe("constrained Card", () => {
  test.use({ viewport: { width: 860, height: 720 } })

  test("[neoview.image-trim.responsive] keeps all automatic controls usable without horizontal overflow", async ({ page }, testInfo) => {
    await page.goto("/tests/e2e/neoview/neoview-image-trim-harness.html", { waitUntil: "domcontentloaded" })
    const card = page.locator('[data-neoview-card="image-trim"]')
    await card.getByRole("switch", { name: "启用图像裁剪" }).click()

    await expect(card.locator('[data-image-trim-action="auto-detect"]')).toBeVisible()
    await expect(card.locator('[data-image-trim-action="preset-black"]')).toBeVisible()
    await expect(card.locator('[data-image-trim-action="preset-white"]')).toBeVisible()
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath("neoview-image-trim-constrained.png"), fullPage: false })
  })
})
