import { expect, test, type Locator, type Page } from "@playwright/test"

test.use({ viewport: { width: 1440, height: 900 } })

test("[neoview.board-swimlane.dnd] reuses stable lane drag behavior for panels and cards", async ({ page }, testInfo) => {
  await page.goto("/tests/e2e/neoview/neoview-board-swimlane-harness.html", { waitUntil: "domcontentloaded" })

  const leftLane = page.locator('[data-neoview-board-lane="left"]')
  const rightLane = page.locator('[data-neoview-board-lane="right"]')
  const panel = leftLane.locator('[data-neoview-board-panel="pageList"]')
  const panelHandle = panel.getByRole("button", { name: /拖动面板/ })
  const initialOrder = await panelIds(leftLane)

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

  const sourceCard = rightLane.locator('[data-neoview-board-card="page-navigation"]')
  const targetCard = rightLane.locator('[data-neoview-board-card="book-information"]')
  await dragTo(page, sourceCard.getByRole("button", { name: /拖动卡片/ }), targetCard)
  await expect(page.locator('[data-neoview-board-panel="info"] [data-neoview-board-card="page-navigation"]')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("neoview-board-swimlane.png"), fullPage: false })
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
