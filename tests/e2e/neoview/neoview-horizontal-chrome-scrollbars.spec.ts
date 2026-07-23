import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 420, height: 360 } })

test("[neoview.chrome.scrollbar-hidden] keeps overflowing bookmark categories scrollable without a visible rail", async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort())
  await page.goto("/tests/e2e/neoview/neoview-bookmark-list-harness.html", { waitUntil: "domcontentloaded" })

  const categories = page.locator('[data-neoview-bookmark-card="true"] [aria-label="书签列表"]')
  await expect(categories).toBeVisible()
  await categories.evaluate((list) => {
    const template = list.querySelector("button")
    if (!template) throw new Error("Bookmark category template is missing")
    for (let index = 0; index < 8; index += 1) {
      const clone = template.cloneNode(true) as HTMLButtonElement
      clone.textContent = `审计分类 ${index + 1}`
      list.append(clone)
    }
  })

  await expect.poll(() => categories.evaluate((list) => list.scrollWidth > list.clientWidth)).toBe(true)
  await expect(categories).toHaveAttribute("data-scrollbar", "hidden")
  await expect.poll(() => categories.evaluate((list) => getComputedStyle(list).scrollbarWidth)).toBe("none")
})
