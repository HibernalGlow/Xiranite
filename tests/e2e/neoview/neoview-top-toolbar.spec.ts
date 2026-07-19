import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1920, height: 1080 } })

test("[neoview.toolbar.ui-1920x1080] preserves legacy toolbar hierarchy, icons and independent layout/rotation states", async ({ page }, testInfo) => {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort())
  await page.goto("/tests/e2e/neoview/neoview-top-toolbar-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView TopToolbar Harness")
  const toolbar = page.locator('[data-reader-view-toolbar="true"]')
  await expect(toolbar).toBeVisible()
  for (const icon of ["panels-top-left", "arrow-left-right", "columns-2", "arrow-right", "rotate-cw"]) await expect(toolbar.locator(`.lucide-${icon}`).first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("neoview-top-toolbar-main-1920x1080.png"), fullPage: false })

  await toolbar.getByRole("button", { name: "全景模式" }).click()
  await expect(toolbar.getByRole("button", { name: "全景模式" })).toHaveAttribute("aria-pressed", "true")
  await toolbar.getByRole("button", { name: "切换横向或纵向布局" }).click()
  await expect(toolbar.locator(".lucide-arrow-down-up").first()).toBeVisible()
  await toolbar.getByRole("button", { name: "双页模式" }).click()
  await expect(toolbar.getByRole("button", { name: "单页模式" })).toBeVisible()
  await toolbar.getByRole("button", { name: "切换阅读方向" }).click()
  await expect(toolbar.locator(".lucide-arrow-left").first()).toBeVisible()

  await toolbar.getByRole("button", { name: "展开缩放设置" }).click()
  for (const name of ["适应窗口", "铺满整个窗口", "适应宽度", "适应高度", "原始大小", "居左适应窗口", "居右适应窗口", "自动分割横向页", "横向页视为双页", "首页独立显示", "尾页独立显示", "无对齐", "双页高度统一", "双页宽度统一"]) await expect(toolbar.getByRole("button", { name, exact: true }).locator("svg")).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("neoview-top-toolbar-zoom-1920x1080.png"), fullPage: false })

  await toolbar.getByRole("button", { name: "展开旋转设置" }).click()
  await expect(toolbar.locator('[data-reader-toolbar-panel="zoom"]')).toHaveCount(0)
  for (const name of ["关闭自动旋转", "纵向页左旋", "纵向页右旋", "横屏左旋", "横屏右旋", "始终左旋", "始终右旋"]) await expect(toolbar.getByRole("button", { name })).toBeVisible()
  await toolbar.getByRole("button", { name: "横屏右旋" }).click()
  await expect(toolbar.getByRole("button", { name: "横屏右旋" })).toHaveAttribute("aria-pressed", "true")
  await expect(toolbar.getByRole("button", { name: "切换横向或纵向布局" })).toHaveAttribute("aria-pressed", "true")
  await page.screenshot({ path: testInfo.outputPath("neoview-top-toolbar-rotate-1920x1080.png"), fullPage: false })
})
