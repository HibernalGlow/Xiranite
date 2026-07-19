import { expect, test, type Locator } from "@playwright/test"

test.use({ viewport: { width: 550, height: 740 } })

test("[neoview.card.exclusive-height] fills history and bookmark panels in every view", async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  await page.goto("/tests/e2e/neoview/neoview-exclusive-library-cards-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Exclusive Library Cards Harness")

  const sidebar = page.locator('[data-reader-sidebar="left"]')
  const historyPanel = sidebar.locator('[data-reader-panel-cache="history"]')
  const historyCard = historyPanel.locator('[data-reader-card="历史记录"]')
  await expect(historyCard.locator('[data-history-id="history-1"]')).toBeVisible()
  await expectExclusiveCardToFillPanel(historyPanel, historyCard)
  await historyCard.screenshot({ path: testInfo.outputPath("history-list-full-height.png") })

  await historyCard.getByRole("button", { name: "缩略图" }).click()
  await expect(historyCard.locator('[data-neoview-history-card="true"]')).toHaveAttribute("data-history-view-mode", "thumbnail")
  await expectExclusiveCardToFillPanel(historyPanel, historyCard)
  await historyCard.screenshot({ path: testInfo.outputPath("history-thumbnail-full-height.png") })

  await sidebar.getByRole("button", { name: "书签", exact: true }).click()
  const bookmarkPanel = sidebar.locator('[data-reader-panel-cache="bookmark"]')
  const bookmarkCard = bookmarkPanel.locator('[data-reader-card="书签列表"]')
  await expect(bookmarkCard.locator('[data-bookmark-id="bookmark-1"]')).toBeVisible()
  await expectExclusiveCardToFillPanel(bookmarkPanel, bookmarkCard)
  await bookmarkCard.screenshot({ path: testInfo.outputPath("bookmark-list-full-height.png") })

  expect(consoleErrors).toEqual([])
})

async function expectExclusiveCardToFillPanel(panel: Locator, card: Locator): Promise<void> {
  const [panelBox, cardBox, viewportBox] = await Promise.all([
    panel.boundingBox(),
    card.boundingBox(),
    card.locator('[data-neoview-library-viewport="true"]').boundingBox(),
  ])
  if (!panelBox || !cardBox || !viewportBox) throw new Error("Unable to measure exclusive library card")
  expect(Math.abs(cardBox.height - panelBox.height)).toBeLessThanOrEqual(2)
  expect(viewportBox.height).toBeGreaterThan(cardBox.height * 0.5)
  expect(Math.abs(viewportBox.y + viewportBox.height - (cardBox.y + cardBox.height))).toBeLessThanOrEqual(4)
}
