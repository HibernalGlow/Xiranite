import { expect, test } from "@playwright/test"

test("[neoview.viewer.hover-scroll-runtime] scrolls native Reader overflow and stops without RAF-driven React renders", async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const consoleErrors: string[] = []
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()) })
  await page.route("**/__neoview-hover-scroll/page.svg", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1800"><rect width="600" height="1800" fill="#315b72"/><rect x="24" y="24" width="552" height="1752" fill="none" stroke="#f4efe2" stroke-width="18"/><text x="300" y="900" text-anchor="middle" font-family="sans-serif" font-size="64" fill="white">Hover scroll</text></svg>',
  }))
  await page.goto("/tests/e2e/neoview/neoview-hover-scroll-harness.html", { waitUntil: "networkidle" })
  await expect(page).toHaveTitle("NeoView Hover Scroll Harness")

  const toolbar = page.locator('[data-reader-view-toolbar="true"]')
  const toggle = toolbar.getByRole("button", { name: "悬停滚动" })
  const viewport = page.locator('[data-reader-frame-viewport="true"]')
  await expect(viewport).toHaveAttribute("data-reader-hover-scroll", "enabled")
  await toggle.click({ button: "right" })
  const slider = toolbar.getByRole("slider", { name: "悬停滚动倍率" })
  await expect(slider).toHaveValue("2")
  await slider.fill("4.5")
  await slider.press("ArrowRight")
  await expect(viewport).toHaveAttribute("data-reader-hover-scroll-speed", "5")
  await toggle.click({ button: "right" })

  const renderCount = await page.locator("main").getAttribute("data-harness-renders")
  const box = await viewport.boundingBox()
  expect(box).toBeTruthy()
  await page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2)
  await expect.poll(() => viewport.evaluate((element) => element.scrollWidth - element.clientWidth - element.scrollLeft)).toBeLessThan(2)
  expect(await page.locator("main").getAttribute("data-harness-renders")).toBe(renderCount)

  await toggle.click()
  await expect(viewport).toHaveAttribute("data-reader-hover-scroll", "disabled")
  const stoppedAt = await viewport.evaluate((element) => element.scrollLeft)
  await page.waitForTimeout(120)
  expect(await viewport.evaluate((element) => element.scrollLeft)).toBe(stoppedAt)

  await toggle.click()
  await toolbar.getByRole("button", { name: "全景模式" }).click()
  const panorama = page.locator('[data-reader-panorama="true"]')
  const panoramaScroller = panorama.locator('[data-virtuoso-scroller="true"]')
  await expect(panorama).toHaveAttribute("data-reader-hover-scroll", "enabled", { timeout: 15_000 })
  const panoramaBox = await panoramaScroller.boundingBox()
  expect(panoramaBox).toBeTruthy()
  await page.mouse.move(panoramaBox!.x + panoramaBox!.width - 2, panoramaBox!.y + panoramaBox!.height / 2)
  await expect.poll(() => panoramaScroller.evaluate((element) => element.scrollWidth - element.clientWidth - Math.abs(element.scrollLeft))).toBeLessThan(2)
  await expect(panorama.locator('[data-reader-page-image="hover-scroll-page"]')).toBeInViewport()
  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`neoview-hover-scroll-${testInfo.project.name}.png`), fullPage: false })
})
