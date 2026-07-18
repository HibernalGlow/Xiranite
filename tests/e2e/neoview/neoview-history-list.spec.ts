import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1920, height: 1080 } })

test("[neoview.history.ui-1920x1080] preserves the resident history toolbar and compact virtual list hierarchy", async ({ page }, testInfo) => {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort())
  await page.goto("/tests/e2e/neoview/neoview-history-list-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView History List Harness")
  const card = page.getByTestId("history-card")
  await expect(card).toHaveAttribute("data-history-state", "ready")
  await expect(card.getByRole("listbox", { name: "阅读历史" })).toBeVisible()
  await expect(card.locator('[data-history-id]')).toHaveCount(3)
  await expect(card.getByRole("button", { name: "列表" })).toHaveAttribute("aria-pressed", "true")
  await page.screenshot({ path: testInfo.outputPath("neoview-history-list-1920x1080.png"), fullPage: false })
})
