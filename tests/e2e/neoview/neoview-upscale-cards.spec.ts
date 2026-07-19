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

  const modelCard = page.locator('[data-harness-card="模型选择"]')
  await expect(modelCard).toContainText("RealESRGAN / 动漫 / upscayl")
  await expect(modelCard).toContainText("倍率 2x/3x/4x")
  await expect(modelCard).toContainText("3.6 MiB")
  await expect(modelCard).toContainText("来源 D:/Python/realesrgan")
  await page.getByLabel("默认模型").selectOption("external-realcugan-pro")
  await expect(page.getByLabel("放大倍率").locator("option")).toHaveText(["2x", "3x"])
  await expect(page.getByLabel("降噪等级").locator("option")).toHaveText(["保守", "0", "3"])
  await page.getByPlaceholder("添加包含 models 的目录").fill("D:/Extra/models")
  await page.getByRole("button", { name: "添加来源" }).click()
  await expect(modelCard).toContainText("D:/Extra/models")
  await page.getByRole("button", { name: "移除模型来源 D:/Extra/models" }).click()
  await expect(modelCard).not.toContainText("D:/Extra/models")
  await modelCard.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath("neoview-upscale-models-1920x1080.png"), fullPage: false })

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
  await modelCard.scrollIntoViewIfNeeded()
  await expect(modelCard).toBeVisible()
  const modelCardBox = await modelCard.boundingBox()
  expect(modelCardBox).not.toBeNull()
  for (const control of await modelCard.locator("button:visible,input:visible,select:visible").all()) {
    const box = await control.boundingBox()
    expect(box, "visible model control has stable geometry").not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(modelCardBox!.x + modelCardBox!.width + 1)
  }
  await page.screenshot({ path: testInfo.outputPath("neoview-upscale-models-420x360.png"), fullPage: false })

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
