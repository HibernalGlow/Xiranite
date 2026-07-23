import { expect, test } from "@playwright/test"

test("NeoView static card frames preserve appearance controls and remain interactive", async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await page.goto("/tests/e2e/neoview/neoview-card-appearance-harness.html")
  await expect(page).toHaveTitle("NeoView Card Appearance Harness")
  const grid = page.locator("[data-neoview-card-appearance-grid]")
  await expect(grid).toBeVisible()
  await expect(grid.locator(".neoview-card-frame")).toHaveCount(9)
  await expect(grid.locator('[data-slot="magic-card"]')).toHaveCount(0)
  await expect(grid.locator('[data-slot="reader-card-title"] h3 svg')).toHaveCount(9)
  await expect(grid.getByRole("heading", { name: "界面材质" })).toHaveCount(1)

  const solidFrame = grid.locator('[data-module-panel-style="solid"] .neoview-card-frame').first()
  const outlineFrame = grid.locator('[data-module-panel-style="outline"] .neoview-card-frame').first()
  await expect(solidFrame).toBeVisible()
  await expect(outlineFrame).toBeVisible()
  expect(await solidFrame.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)")
  expect(await outlineFrame.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)")
  await page.screenshot({ path: testInfo.outputPath("neoview-card-appearance-3x3.png"), fullPage: true })

  const navigation = grid.locator('[data-reader-card="页面导航"]')
  await navigation.locator('[data-slot="reader-card-title"] button').last().click()
  await expect(navigation.locator('[data-reader-card-content="页面导航"]')).toHaveCount(0)
  expect(consoleErrors).toEqual([])
})
