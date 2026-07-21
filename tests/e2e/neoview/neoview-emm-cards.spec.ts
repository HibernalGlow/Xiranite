import { expect, test } from "@playwright/test"

test("[neoview.emm-auxiliary.e2e] [neoview.emm-raw-data.geometry] [neoview.emm-raw-data.accessibility] renders the restored property cards without overflow", async ({ page }, testInfo) => {
  await page.goto("/tests/e2e/neoview/neoview-emm-cards-harness.html", { waitUntil: "domcontentloaded" })
  const board = page.locator('[data-emm-card-board="true"]')
  await expect(page.locator('[data-emm-sync-card="true"]')).toContainText("外部 EMM 数据已连接")
  await expect(page.locator('[data-emm-raw-data-card="true"]')).toContainText("artist:Alice")
  await page.getByRole("button", { name: "打开 来源链接" }).focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("status")).toContainText("已交给系统浏览器打开")
  await expect(page.locator('[data-favorite-tags-card="true"]')).toContainText("爱丽丝")
  await expect(page.locator('[data-folder-ratings-card="true"]')).toContainText("4.50")
  for (const card of await page.locator("[data-reader-card]").all()) {
    expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  }
  await board.screenshot({ path: testInfo.outputPath(`neoview-emm-cards-${testInfo.project.name}.png`) })
})
