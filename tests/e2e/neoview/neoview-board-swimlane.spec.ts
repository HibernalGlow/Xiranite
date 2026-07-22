import { expect, test, type Locator, type Page } from "@playwright/test"

test.use({ viewport: { width: 1440, height: 900 } })

test("[neoview.board-swimlane.panel-dnd] moves panels once at drop", async ({ page }, testInfo) => {
  const runtimeErrors = captureRuntimeErrors(page)
  await page.goto("/tests/e2e/neoview/neoview-board-swimlane-harness.html", {
    waitUntil: "domcontentloaded",
  })

  const leftLane = page.locator('[data-neoview-board-lane="left"]')
  const rightLane = page.locator('[data-neoview-board-lane="right"]')
  const panel = leftLane.locator('[data-neoview-board-panel="pageList"]')
  const panelHandle = panel.locator('[data-kind="panel"]')
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
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, {
    steps: 3,
  })
  await expect(page.locator('[data-neoview-drag-preview="panel"]')).toBeVisible()
  await page.mouse.up()
  await expect.poll(async () => (await panelIds(leftLane)).toSorted()).toEqual(initialOrder.toSorted())
  await page.reload({ waitUntil: "domcontentloaded" })

  const targetPanel = rightLane.locator('[data-neoview-board-panel="info"]')
  const sourceBox = await panelHandle.boundingBox()
  const targetBox = await targetPanel.boundingBox()
  if (!sourceBox || !targetBox) throw new Error("Unable to resolve panel transfer bounds")
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 24, {
    steps: 18,
  })
  await expect(page.locator('[data-neoview-drag-preview="panel"]')).toBeVisible()
  const panelLandingPreview = page.locator('[data-neoview-board-landing-preview="panel"]')
  await expect(panelLandingPreview).toBeVisible()
  await expect(panelLandingPreview).toContainText("页面列表")
  await expect(leftLane.locator('[data-neoview-board-panel="pageList"]')).toBeVisible()
  await page.mouse.up()
  await expect(rightLane.locator('[data-neoview-board-panel="pageList"]')).toBeVisible()
  await expect(page.locator('[data-neoview-drag-preview="panel"]')).toHaveCount(0)
  await expect(panelLandingPreview).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
  await page.screenshot({
    path: testInfo.outputPath("neoview-board-swimlane.png"),
    fullPage: false,
  })
})

test("[neoview.board-swimlane.card-dnd] previews and moves cards once at drop", async ({ page }, testInfo) => {
  const runtimeErrors = captureRuntimeErrors(page)
  await page.goto("/tests/e2e/neoview/neoview-board-swimlane-harness.html", {
    waitUntil: "domcontentloaded",
  })
  const leftLane = page.locator('[data-neoview-board-lane="left"]')
  const rightLane = page.locator('[data-neoview-board-lane="right"]')

  const sourceCard = rightLane.locator('[data-neoview-board-card="book-information"]')
  const targetPanel = leftLane.locator('[data-neoview-board-panel="settings"]')
  const targetCard = targetPanel.locator('[data-neoview-board-card="slideshow-settings"]')
  const sourceHandle = sourceCard.locator("button").first()
  await expect(sourceHandle).toBeVisible()
  await expect(sourceHandle).toBeEnabled()
  await expect(sourceHandle).toHaveAttribute("aria-controls")
  await expect(targetCard).toBeVisible()
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetCard.boundingBox()
  if (!sourceBox || !targetBox) throw new Error("Unable to resolve card transfer bounds")
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 18 })
  await expect(page.locator('[data-neoview-drag-preview="card"]')).toBeVisible()
  const landingPreview = page.locator('[data-neoview-board-landing-preview="card"]')
  await expect(landingPreview).toBeVisible()
  await expect(landingPreview).toContainText("书籍信息")
  await expect(sourceCard).toBeVisible()
  const landingBox = await landingPreview.boundingBox()
  expect(landingBox?.x).toBeGreaterThanOrEqual(targetBox.x - 1)
  expect(landingBox?.x).toBeLessThanOrEqual(targetBox.x + 1)
  await page.screenshot({
    path: testInfo.outputPath("neoview-board-card-landing-preview.png"),
    fullPage: false,
  })
  await page.mouse.up()
  await expect(targetPanel.locator('[data-neoview-board-card="book-information"]')).toBeVisible()
  await expect(page.locator('[data-neoview-drag-preview="card"]')).toHaveCount(0)
  await expect(landingPreview).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})

test("[neoview.board-swimlane.exclusive-card] labels and protects full-size cards", async ({ page }) => {
  await page.goto("/tests/e2e/neoview/neoview-board-swimlane-harness.html", {
    waitUntil: "domcontentloaded",
  })
  const pageList = page.locator('[data-neoview-board-panel="pageList"]')
  const history = page.locator('[data-neoview-board-panel="history"]')
  const info = page.locator('[data-neoview-board-panel="info"]')
  const historyCard = history.locator('[data-neoview-board-card="history-list"]')

  await expect(page.locator('[data-neoview-board-card="folder-main"]')).toContainText("独占面板")
  await expect(historyCard).toContainText("独占面板")
  await expect(page.locator('[data-neoview-board-card="bookmark-list"]')).toContainText("独占面板")
  await expect(history.getByText("独占面板", { exact: true })).toHaveCount(2)

  await dragTo(page, pageList.locator('[data-neoview-board-card="page-navigation"] button'), historyCard)
  await expect(pageList.locator('[data-neoview-board-card="page-navigation"]')).toBeVisible()
  await expect(history.locator("[data-neoview-board-card]")).toHaveCount(1)

  await dragTo(page, historyCard.locator("button").first(), info.locator('[data-neoview-board-card="book-information"]'))
  await expect(historyCard).toBeVisible()
  await expect(info.locator('[data-neoview-board-card="history-list"]')).toHaveCount(0)
})

test("[neoview.board-swimlane.card-position] uses the pointer half of the target card", async ({ page }) => {
  await page.goto("/tests/e2e/neoview/neoview-board-swimlane-harness.html", { waitUntil: "domcontentloaded" })
  const properties = page.locator('[data-neoview-board-panel="properties"]')
  const source = properties.locator('[data-neoview-board-card="folder-ratings"] button').first()
  const target = properties.locator('[data-neoview-board-card="emm-tags"] button').first()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error("Unable to resolve within-panel card bounds")
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  const sourceCenterY = sourceBox.y + sourceBox.height / 2
  const targetPointerY = targetBox.y + 4
  for (let step = 1; step <= 18; step += 1) {
    await page.mouse.move(
      sourceBox.x + (targetBox.x - sourceBox.x) * step / 18 + sourceBox.width / 2,
      sourceCenterY + (targetPointerY - sourceCenterY) * step / 18,
    )
  }
  await expect(page.locator('[data-neoview-board-landing-preview="card"]')).toHaveAttribute("data-neoview-board-landing-position", "before")
  await page.mouse.up()
  await expect.poll(async () => properties.locator('[data-neoview-board-card]').evaluateAll((cards) => cards.slice(0, 3).map((card) => card.getAttribute("data-neoview-board-card")))).toEqual(["folder-ratings", "emm-tags", "book-settings"])
})

async function panelIds(lane: Locator): Promise<string[]> {
  return lane.locator("[data-neoview-board-panel]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-neoview-board-panel") ?? ""))
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

function captureRuntimeErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) errors.push(message.text())
  })
  return errors
}
