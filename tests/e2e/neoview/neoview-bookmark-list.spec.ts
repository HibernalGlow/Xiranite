import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1920, height: 1080 } })

test("[neoview.bookmark.ui-1920x1080] preserves the resident bookmark lists, view controls and compact entries", async ({ page }, testInfo) => {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort())
  await page.goto("/tests/e2e/neoview/neoview-bookmark-list-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Bookmark List Harness")
  const card = page.getByTestId("bookmark-card")
  await expect(card).toHaveAttribute("data-bookmark-state", "ready")
  await expect(card.locator('[aria-label="书签列表"]')).toBeVisible()
  await expect(card.locator('[data-neoview-library-list="bookmarks:all"]')).toBeVisible()
  await expect(card.locator('[data-bookmark-id]')).toHaveCount(3)
  await expect(card.getByRole("button", { name: "列表", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.screenshot({ path: testInfo.outputPath("neoview-bookmark-list-1920x1080.png"), fullPage: false })
})
