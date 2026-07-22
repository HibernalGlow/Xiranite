import { expect, test } from "@playwright/test"

test("NeoView card titles share appearance controls and remain interactive", async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await page.goto("/tests/e2e/neoview/neoview-card-appearance-harness.html")
  await expect(page).toHaveTitle("NeoView Card Appearance Harness")
  const grid = page.locator("[data-neoview-card-appearance-grid]")
  await expect(grid).toBeVisible()
  await expect(grid.locator('[data-slot="magic-card"]')).toHaveCount(9)
  await expect(grid.locator('[data-slot="reader-card-title"] h3 svg')).toHaveCount(9)
  await expect(grid.getByRole("heading", { name: "界面材质" })).toHaveCount(1)

  const magicCard = grid.locator('[data-module-card-effect="magic"]').first().locator('[data-slot="magic-card"]')
  const gradient = magicCard.locator('[data-slot="magic-card-gradient"]')
  const content = magicCard.locator('[data-slot="magic-card-content"]')
  await expect.poll(() => gradient.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity))).toBeLessThan(0.05)
  const restingBackground = await gradient.evaluate((element) => getComputedStyle(element).backgroundImage)

  await magicCard.hover({ position: { x: 220, y: 55 } })
  await expect.poll(() => gradient.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity))).toBeGreaterThan(0.45)
  const hoveredBackground = await gradient.evaluate((element) => getComputedStyle(element).backgroundImage)
  expect(hoveredBackground).not.toBe(restingBackground)
  expect(hoveredBackground).toContain("120px")
  expect(await gradient.evaluate((element) => getComputedStyle(element).filter)).toBe("opacity(0.5)")
  expect(await gradient.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0.3s")
  expect(Number.parseInt(await gradient.evaluate((element) => getComputedStyle(element).zIndex), 10))
    .toBeLessThan(Number.parseInt(await content.evaluate((element) => getComputedStyle(element).zIndex), 10))

  const solidMagicCard = grid.locator('[data-module-panel-style="solid"][data-module-card-effect="magic"] [data-slot="magic-card"]')
  const solidGradient = solidMagicCard.locator('[data-slot="magic-card-gradient"]')
  const solidSurface = solidMagicCard.locator('[data-slot="magic-card-surface"]')
  const solidPanel = solidMagicCard.locator('[data-reader-card]')
  await solidMagicCard.hover({ position: { x: 220, y: 55 } })
  await expect.poll(() => solidGradient.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity))).toBeGreaterThan(0.95)
  expect(await solidPanel.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)")
  expect(Number.parseInt(await solidSurface.evaluate((element) => getComputedStyle(element).zIndex), 10))
    .toBeLessThan(Number.parseInt(await solidGradient.evaluate((element) => getComputedStyle(element).zIndex), 10))

  const plainGradient = grid.locator('[data-module-card-effect="plain"]').first().locator('[data-slot="magic-card-gradient"]')
  await expect(plainGradient).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath("neoview-card-appearance-3x3.png"), fullPage: true })

  const navigation = grid.locator('[data-reader-card="页面导航"]')
  await navigation.locator('[data-slot="reader-card-title"] button').last().click()
  await expect(navigation.locator('[data-reader-card-content="页面导航"]')).toHaveCount(0)
  expect(consoleErrors).toEqual([])
})
