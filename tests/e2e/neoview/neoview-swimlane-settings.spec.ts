import { expect, test } from "@playwright/test"

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "swimlane settings are verified once")
})

test("shows the four shared swimlane interaction settings on the default NeoView lane page", async ({ page }) => {
  await page.goto("/tests/e2e/neoview/neoview-swimlane-settings-harness.html", { waitUntil: "domcontentloaded" })

  await expect(page.getByRole("heading", { name: "泳道与布局" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "泳道" })).toHaveAttribute("data-state", "active")
  await expect(page.getByRole("tab", { name: "交互" })).toHaveCount(0)
  await expect(page.getByText("泳道焦点与独占", { exact: true })).toBeVisible()
  await expect(page.getByRole("switch", { name: "Reader 聚焦时自动独占" })).toBeVisible()
  await expect(page.getByRole("switch", { name: "Reader 独占时显示泳道切换栏" })).toBeVisible()
  await expect(page.getByRole("spinbutton", { name: "左右泳道展开延迟" })).toBeVisible()
  await expect(page.getByRole("spinbutton", { name: "Reader 悬停重新聚焦延迟" })).toBeVisible()
  await expect(page.getByRole("switch", { name: "启用 Reader 悬停重新聚焦" })).toBeVisible()
  expect(await page.locator("main").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)

  await page.screenshot({ path: "output/playwright/neoview-swimlane-settings.png", fullPage: true })
})
