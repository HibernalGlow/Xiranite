import { expect, test } from "@playwright/test"

test("[neoview.super-resolution.cards-browser] preserves the legacy upscale Card controls and constrained geometry", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("console", (message) => { if ((message.type() === "error" || message.type() === "warning") && !message.text().startsWith("Failed to load resource:")) errors.push(message.text()) })
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("response", (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`) })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto("/tests/e2e/neoview/neoview-upscale-cards-harness.html", { waitUntil: "commit" })
  await expect(page).toHaveTitle("NeoView Upscale Cards Harness")
  await expect(page.getByRole("heading", { name: "超分设置与状态" })).toBeVisible()
  await expect(page.locator("[data-neoview-upscale-status=true]")).toContainText("已完成")
  await page.getByLabel("模型", { exact: true }).selectOption("manga")
  await page.locator('[data-harness-card="缓存管理"]').scrollIntoViewIfNeeded()
  await page.getByRole("button", { name: "全部" }).click()
  await page.getByRole("button", { name: "清理", exact: true }).click()
  await expect.poll(() => page.locator("html").getAttribute("data-cache-cleanup")).toBe("all")
  await page.locator('[data-harness-card="条件超分"]').scrollIntoViewIfNeeded()
  await page.getByRole("button", { name: /展开条件编辑器/ }).click()
  await expect(page.getByLabel("条件名称")).toBeVisible()
  await expect.poll(() => page.locator("html").getAttribute("data-upscale-writes")).not.toBeNull()
  await page.screenshot({ path: testInfo.outputPath("neoview-upscale-cards-1920x1080.png"), fullPage: false })

  await page.setViewportSize({ width: 420, height: 360 })
  const conditions = page.locator('[data-harness-card="条件超分"]')
  await conditions.scrollIntoViewIfNeeded()
  await expect(conditions).toBeVisible()
  const cardBox = await conditions.boundingBox()
  expect(cardBox).not.toBeNull()
  for (const control of await conditions.locator("button:visible,input:visible,select:visible,textarea:visible").all()) {
    const box = await control.boundingBox()
    expect(box, "visible control has stable geometry").not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1)
  }
  await page.screenshot({ path: testInfo.outputPath("neoview-upscale-cards-420x360.png"), fullPage: false })
  expect(errors.filter((message) => !message.includes("Download the React DevTools"))).toEqual([])
})
