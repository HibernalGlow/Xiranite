import { expect, test, type Locator } from "@playwright/test"

test.use({ viewport: { width: 550, height: 740 } })

test("[neoview.card.exclusive-size] fills File, history, bookmark and Page List panels", async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    // The static harness does not serve a favicon; retain application console failures.
    if (message.type() === "error" && !message.text().includes("favicon.ico")) consoleErrors.push(message.text())
  })
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }))
  await page.goto("/tests/e2e/neoview/neoview-exclusive-library-cards-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Exclusive Library Cards Harness")

  const sidebar = page.locator('[data-reader-sidebar="left"]')
  const folderPanel = sidebar.locator('[data-reader-panel-cache="folder"]')
  const folderCard = folderPanel.locator('[data-reader-card="文件浏览"]')
  const folderContent = folderCard.locator('[data-neoview-folder-card="true"]')
  await expect(folderContent.getByTitle("C:/books/book.cbz")).toBeVisible()
  await expectExclusiveCardToFillPanel(folderPanel, folderCard, folderContent)
  await folderCard.screenshot({ path: testInfo.outputPath("folder-card-full-width.png") })

  await sidebar.getByRole("button", { name: "历史记录", exact: true }).click()
  const historyPanel = sidebar.locator('[data-reader-panel-cache="history"]')
  const historyCard = historyPanel.locator('[data-reader-card="历史记录"]')
  const historyContent = historyCard.locator('[data-neoview-history-card="true"]')
  await expect(historyCard.locator('[data-history-id="history-1"]')).toBeVisible()
  await expectExclusiveCardToFillPanel(historyPanel, historyCard, historyContent, historyCard.locator('[data-neoview-library-viewport="true"]'))
  await historyCard.screenshot({ path: testInfo.outputPath("history-list-full-height.png") })

  await historyCard.getByRole("button", { name: "视图：紧凑列表" }).click()
  await page.getByRole("menuitemradio", { name: "封面网格" }).click()
  await expect(historyCard.locator('[data-neoview-history-card="true"]')).toHaveAttribute("data-history-view-mode", "cover-grid")
  await expectExclusiveCardToFillPanel(historyPanel, historyCard, historyContent, historyCard.locator('[data-neoview-library-viewport="true"]'))
  await historyCard.screenshot({ path: testInfo.outputPath("history-thumbnail-full-height.png") })

  await sidebar.getByRole("button", { name: "书签", exact: true }).click()
  const bookmarkPanel = sidebar.locator('[data-reader-panel-cache="bookmark"]')
  const bookmarkCard = bookmarkPanel.locator('[data-reader-card="书签列表"]')
  const bookmarkContent = bookmarkCard.locator('[data-neoview-bookmark-card="true"]')
  await expect(bookmarkCard.locator('[data-bookmark-id="bookmark-1"]')).toBeVisible()
  await expectExclusiveCardToFillPanel(bookmarkPanel, bookmarkCard, bookmarkContent, bookmarkCard.locator('[data-neoview-library-viewport="true"]'))
  await bookmarkCard.screenshot({ path: testInfo.outputPath("bookmark-list-full-height.png") })

  await sidebar.getByRole("button", { name: "页面列表", exact: true }).click()
  const pageListPanel = sidebar.locator('[data-reader-panel-cache="pageList"]')
  const pageListCard = pageListPanel.locator('[data-reader-card="页面导航"]')
  const pageListContent = pageListCard.locator('[data-neoview-page-list="true"]')
  await expect(pageListContent).toHaveAttribute("data-page-list-state", "ready")
  await expectExclusiveCardToFillPanel(pageListPanel, pageListCard, pageListContent, pageListCard.locator('[data-neoview-page-list-viewport="true"]'))
  await pageListCard.screenshot({ path: testInfo.outputPath("page-list-card-full-width.png") })

  expect(consoleErrors).toEqual([])
})

async function expectExclusiveCardToFillPanel(panel: Locator, card: Locator, content: Locator, viewport?: Locator): Promise<void> {
  const [panelBox, magicContentBox, cardBox, contentBox, viewportBox] = await Promise.all([
    panel.boundingBox(),
    panel.locator('[data-slot="magic-card-content"]').boundingBox(),
    card.boundingBox(),
    content.boundingBox(),
    viewport?.boundingBox(),
  ])
  if (!panelBox || !magicContentBox || !cardBox || !contentBox) throw new Error("Unable to measure exclusive card")
  expect(Math.abs(magicContentBox.width - panelBox.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(cardBox.width - panelBox.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(contentBox.width - panelBox.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(cardBox.height - panelBox.height)).toBeLessThanOrEqual(2)
  if (viewportBox) {
    expect(Math.abs(viewportBox.width - panelBox.width)).toBeLessThanOrEqual(2)
    expect(viewportBox.height).toBeGreaterThan(cardBox.height * 0.5)
    expect(Math.abs(viewportBox.y + viewportBox.height - (cardBox.y + cardBox.height))).toBeLessThanOrEqual(4)
  }
}
