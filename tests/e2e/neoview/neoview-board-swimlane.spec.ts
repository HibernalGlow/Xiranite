import { expect, test, type Locator, type Page } from "@playwright/test"

test.use({ viewport: { width: 1440, height: 900 } })

test("[neoview.board-swimlane.panel-dnd] reuses stable lane drag behavior for panels", async ({ page }, testInfo) => {
  await page.goto("/tests/e2e/neoview/neoview-board-swimlane-harness.html", { waitUntil: "domcontentloaded" })

  const leftLane = page.locator('[data-neoview-board-lane="left"]')
  const rightLane = page.locator('[data-neoview-board-lane="right"]')
  const panel = leftLane.locator('[data-neoview-board-panel="pageList"]')
  const panelHandle = panel.getByRole("button", { name: /拖动面板/ })
  const initialOrder = await panelIds(leftLane)

  await leftLane.getByRole("button", { name: "折叠左侧栏" }).click()
  await expect(leftLane).toHaveAttribute("data-neoview-board-lane-collapsed", "true")
  expect((await leftLane.boundingBox())?.width).toBeLessThanOrEqual(52)
  await leftLane.getByRole("button", { name: "展开左侧栏" }).click()
  await expect(panelHandle).toBeVisible()

  const box = await panelHandle.boundingBox()
  if (!box) throw new Error("Unable to resolve panel handle bounds")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, { steps: 3 })
  await expect(page.locator('[data-neoview-drag-preview="panel"]')).toBeVisible()
  await page.mouse.up()
  await expect.poll(() => panelIds(leftLane)).toEqual(initialOrder)
  await page.reload({ waitUntil: "domcontentloaded" })

  const targetPanel = rightLane.locator('[data-neoview-board-panel="info"]')
  const sourceBox = await panelHandle.boundingBox()
  const targetBox = await targetPanel.boundingBox()
  if (!sourceBox || !targetBox) throw new Error("Unable to resolve panel transfer bounds")
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 24, { steps: 18 })
  await expect(page.locator('[data-neoview-drag-preview="panel"]')).toBeVisible()
  await expect(rightLane.locator('[data-neoview-board-panel="pageList"]')).toBeVisible()
  await page.mouse.up()
  await expect(rightLane.locator('[data-neoview-board-panel="pageList"]')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("neoview-board-swimlane.png"), fullPage: false })
})

test("[neoview.board-swimlane.card-dnd] moves cards between panels", async ({ page }) => {
  await page.goto("/tests/e2e/neoview/neoview-board-swimlane-harness.html", { waitUntil: "domcontentloaded" })
  const leftLane = page.locator('[data-neoview-board-lane="left"]')
  const rightLane = page.locator('[data-neoview-board-lane="right"]')

  const sourceCard = leftLane.locator('[data-neoview-board-card="page-navigation"]')
  const targetPanelForCard = rightLane.locator('[data-neoview-board-panel="info"]')
  const targetCard = targetPanelForCard.locator('[data-neoview-board-card="book-information"]')
  const sourceCardHandle = sourceCard.getByRole("button", { name: /拖动卡片/ })
  await expect(sourceCardHandle).toBeVisible()
  await expect(sourceCardHandle).toBeEnabled()
  await expect(sourceCardHandle).toHaveAttribute("aria-controls")
  await expect(targetCard).toBeVisible()
  const sourceCardBox = await sourceCardHandle.boundingBox()
  const targetCardBox = await targetCard.boundingBox()
  if (!sourceCardBox || !targetCardBox) throw new Error("Unable to resolve card transfer bounds")
  await page.mouse.move(sourceCardBox.x + sourceCardBox.width / 2, sourceCardBox.y + sourceCardBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetCardBox.x + targetCardBox.width / 2, targetCardBox.y + targetCardBox.height / 2, { steps: 18 })
  await expect(page.locator('[data-neoview-drag-preview="card"]')).toBeVisible()
  await expect(targetPanelForCard.locator('[data-neoview-board-card="page-navigation"]')).toBeVisible()
  await page.mouse.up()
  await expect(targetPanelForCard.locator('[data-neoview-board-card="page-navigation"]')).toBeVisible()
})

test("[neoview.board-swimlane.exclusive-card] labels and protects full-size cards", async ({ page }) => {
  await page.goto("/tests/e2e/neoview/neoview-board-swimlane-harness.html", { waitUntil: "domcontentloaded" })
  const pageList = page.locator('[data-neoview-board-panel="pageList"]')
  const history = page.locator('[data-neoview-board-panel="history"]')
  const info = page.locator('[data-neoview-board-panel="info"]')
  const historyCard = history.locator('[data-neoview-board-card="history-list"]')

  await expect(page.locator('[data-neoview-board-card="folder-main"]')).toContainText("独占面板")
  await expect(historyCard).toContainText("独占面板")
  await expect(page.locator('[data-neoview-board-card="bookmark-list"]')).toContainText("独占面板")
  await expect(history.getByText("独占面板", { exact: true })).toHaveCount(2)

  await dragTo(
    page,
    pageList.locator('[data-neoview-board-card="page-navigation"] button'),
    historyCard,
  )
  await expect(pageList.locator('[data-neoview-board-card="page-navigation"]')).toBeVisible()
  await expect(history.locator("[data-neoview-board-card]")).toHaveCount(1)

  await dragTo(page, historyCard.getByRole("button", { name: /拖动卡片/ }), info.locator('[data-neoview-board-card="book-information"]'))
  await expect(historyCard).toBeVisible()
  await expect(info.locator('[data-neoview-board-card="history-list"]')).toHaveCount(0)
})

async function panelIds(lane: Locator): Promise<string[]> {
  return lane.locator("[data-neoview-board-panel]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-neoview-board-panel") ?? ""),
  )
}

async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  await expect(source).toBeVisible()
  await expect(target).toBeVisible()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error("Unable to resolve drag bounds")
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + Math.min(targetBox.height / 2, 72), { steps: 18 })
  await page.mouse.up()
}
