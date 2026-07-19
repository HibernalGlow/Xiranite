import { expect, test } from "@playwright/test"

test("[neoview.slideshow.toolbar-e2e] restores presets, countdown and constrained geometry", async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on("pageerror", (error) => runtimeErrors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 204, body: "" }))
  await page.goto("/tests/e2e/neoview/neoview-top-toolbar-harness.html", { waitUntil: "domcontentloaded" })

  const toolbar = page.locator('[data-reader-view-toolbar="true"]')
  await toolbar.getByRole("button", { name: "展开幻灯片设置" }).click()
  const panel = toolbar.locator('[data-reader-toolbar-panel="slideshow"]')
  await expect(panel).toBeVisible()
  const interval = panel.getByRole("slider", { name: "幻灯片间隔" })
  await expect(interval).toHaveValue("5")
  await panel.getByRole("button", { name: "幻灯片间隔 15 秒" }).click()
  await expect(interval).toHaveValue("15")

  await panel.getByRole("button", { name: "播放幻灯片" }).click()
  await expect(panel.getByRole("button", { name: "暂停幻灯片" })).toHaveAttribute("aria-pressed", "true")
  await expect(panel.getByRole("progressbar", { name: "幻灯片倒计时进度" })).toBeVisible()
  await expect(panel.getByRole("status", { name: "幻灯片剩余时间" })).toContainText("15s")
  await panel.getByRole("button", { name: "循环播放" }).click()
  await panel.getByRole("button", { name: "随机播放" }).click()
  await expect(panel.getByRole("button", { name: "循环播放" })).toHaveAttribute("aria-pressed", "true")
  await expect(panel.getByRole("button", { name: "随机播放" })).toHaveAttribute("aria-pressed", "true")

  const bounds = await panel.boundingBox()
  const viewport = page.viewportSize()!
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
  await page.screenshot({ path: testInfo.outputPath(`neoview-slideshow-${testInfo.project.name}.png`) })
  expect(runtimeErrors).toEqual([])
})
