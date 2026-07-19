import { expect, test } from "@playwright/test"

test("[neoview.viewer.hover-scroll-runtime] scrolls native Reader overflow and stops without RAF-driven React renders", async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()) })
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
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height - 8)
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(20)
  expect(await page.locator("main").getAttribute("data-harness-renders")).toBe(renderCount)

  await toggle.click()
  await expect(viewport).toHaveAttribute("data-reader-hover-scroll", "disabled")
  const stoppedAt = await viewport.evaluate((element) => element.scrollTop)
  await page.waitForTimeout(120)
  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(stoppedAt)
  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`neoview-hover-scroll-${testInfo.project.name}.png`), fullPage: false })
})
