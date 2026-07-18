import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1920, height: 1080 } })
test.setTimeout(60_000)

test("[neoview.sidebar-height.ui-1920x1080] [neoview.sidebar-height.geometry] preserves legacy geometry controls and one completion write", async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort())
  await page.goto("/tests/e2e/neoview/neoview-sidebar-height-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Sidebar Height Harness")

  await expect(page.getByText("自由调整侧边栏的尺寸与位置。高度 100% 时位置控制禁用。")).toBeVisible()
  await expect(page.getByRole("switch", { name: "显示拖拽手柄" })).toBeVisible()
  await expect(page.getByRole("switch", { name: "空白区点击收回侧边栏" })).toBeChecked()
  await expect(page.getByRole("button", { name: "单击" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("slider", { name: "Y轴" }).first()).toBeDisabled()
  await page.screenshot({ path: "output/playwright/neoview-sidebar-height-1920x1080.png", fullPage: false })

  const writesBefore = Number(await page.locator("html").getAttribute("data-sidebar-height-writes") ?? "0")
  const leftHeight = page.getByRole("slider", { name: "高度" }).first()
  await leftHeight.focus()
  await leftHeight.press("ArrowLeft")
  await expect.poll(() => page.locator("html").getAttribute("data-sidebar-height-writes")).toBe(String(writesBefore + 1))
  await expect(page.getByRole("slider", { name: "Y轴" }).first()).toBeEnabled()

  await page.getByRole("switch", { name: "显示拖拽手柄" }).click()
  await page.getByRole("switch", { name: "空白区点击收回侧边栏" }).click()
  await expect(page.getByRole("button", { name: "单击" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "双击" })).toBeDisabled()
  await expect(page.getByRole("slider", { name: "左边缘" })).toHaveValue("32")
  await expect(page.getByRole("slider", { name: "右边缘" })).toHaveValue("32")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.screenshot({ path: "output/playwright/neoview-sidebar-height-interaction-1920x1080.png", fullPage: false })
})
