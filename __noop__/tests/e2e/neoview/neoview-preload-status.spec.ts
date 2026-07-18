import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1920, height: 1080 } })

test("[neoview.preload-status.resident-1920x1080] keeps the legacy summary resident and hydrates diagnostics after opening", async ({ page }, testInfo) => {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort())
  await page.goto("/tests/e2e/neoview/neoview-preload-status-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Preload Status Harness")

  const card = page.locator('[data-neoview-preload-status="true"]')
  await expect(card).toHaveAttribute("data-preload-empty", "true")
  await expect(card.getByText("0 / 0", { exact: true })).toBeVisible()
  await expect(card.getByText("--", { exact: true })).toBeVisible()
  await expect(card.getByText("附近页缓存", { exact: true })).toBeVisible()
  await expect(card.getByText("等待书本", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "打开书本" }).click()
  await expect(page.locator('[data-preload-book-state="open"]')).toBeVisible()
  await expect(card).not.toHaveAttribute("data-preload-empty", "true")
  await expect(card.getByText("4 / 20", { exact: true })).toBeVisible()
  await expect(card.getByText("12 项", { exact: true })).toBeVisible()
  await expect(card.getByRole("progressbar", { name: "服务端呈现缓存使用率" })).toHaveAttribute("aria-valuenow", "25")
  await expect(card.locator('[data-server-cache-state="cached"]')).toBeVisible()
  await expect(card.locator('[data-server-cache-state="failed"]')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("neoview-preload-status-1920x1080.png"), fullPage: false })
})
