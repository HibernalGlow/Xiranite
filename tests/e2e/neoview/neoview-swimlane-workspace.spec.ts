import { expect, test, type Page } from "@playwright/test"

const HARNESS = "/tests/e2e/neoview/neoview-swimlane-workspace-harness.html"

test("[neoview.swimlane.workspace-e2e] keeps flat reveal, Reader focus and fused chrome", async ({ page }, testInfo) => {
  await openHarness(page, { width: 1920, height: 1080 })
  const breadcrumb = page.locator('[data-reader-breadcrumb-bar="true"]')
  await expect(page.locator('[data-neoview-workspace-mode="edges"]')).toBeVisible()
  await expect(breadcrumb.getByRole("button", { name: "泳道模式" })).toBeVisible()
  await expect(breadcrumb.locator("[data-window-caption-button]")).toHaveCount(3)

  await breadcrumb.getByRole("button", { name: "泳道模式" }).click()
  const workspace = page.locator('[data-neoview-workspace-mode="swimlane"]')
  const viewport = page.locator('[data-reader-swimlane-viewport="true"]')
  const readerLane = page.locator('[data-reader-swimlane="reader"]')
  await expect(workspace).toBeVisible()
  await expect(readerLane.locator('[data-reader-swimlane-header="reader"]')).toHaveCount(0)
  await expect(readerLane).toHaveJSProperty("offsetWidth", 1920)

  await page.locator('[data-reader-swimlane-trigger="right"]').hover()
  await expect(workspace).toHaveAttribute("data-reader-swimlane-preview", "right")
  await expect.poll(() => viewport.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)
  await page.getByRole("button", { name: "书籍信息" }).click()
  await expect(page.locator('[data-reader-swimlane="right"]')).toHaveAttribute("data-reader-swimlane-active", "true")
  await expect(readerLane).toHaveJSProperty("offsetWidth", 1920)
  await expect(page.locator('[data-reader-swimlane="right"]')).toHaveJSProperty("offsetWidth", 380)
  await expect(readerLane.locator('[data-reader-swimlane-header="reader"]')).toHaveCount(0)
  const rightEdgeBeforeResize = await page.locator('[data-reader-swimlane="right"]').evaluate((lane) => lane.getBoundingClientRect().right)
  await dragHorizontally(page, page.getByRole("separator", { name: "从左侧调整右侧面板泳道宽度" }), -40)
  await expect(page.locator('[data-reader-swimlane="right"]')).toHaveJSProperty("offsetWidth", 420)
  const rightEdgeAfterResize = await page.locator('[data-reader-swimlane="right"]').evaluate((lane) => lane.getBoundingClientRect().right)
  expect(rightEdgeAfterResize).toBeCloseTo(rightEdgeBeforeResize, 0)

  const readerAction = page.getByRole("button", { name: /Reader 操作/ })
  const beforeClick = await readerAction.getAttribute("data-reader-action-count")
  await readerAction.click()
  await expect(readerLane).toHaveAttribute("data-reader-swimlane-active", "true")
  await expect(readerAction).toHaveAttribute("data-reader-action-count", beforeClick ?? "0")

  await page.locator('[data-reader-swimlane-trigger="right"]').hover()
  await page.getByRole("button", { name: "书籍信息" }).click()
  await readerLane.hover()
  await page.waitForTimeout(700)
  await expect(readerLane).toHaveAttribute("data-reader-swimlane-active", "true")

  const topTrigger = page.locator('[data-reader-edge-trigger="top"]')
  const bottomTrigger = page.locator('[data-reader-edge-trigger="bottom"]')
  await topTrigger.hover()
  await expect(page.locator('[data-reader-edge="top"]')).toHaveAttribute("data-reader-edge-visible", "true")
  await readerLane.hover()
  await page.waitForTimeout(400)
  await bottomTrigger.hover()
  await expect(page.locator('[data-reader-edge="bottom"]')).toHaveAttribute("data-reader-edge-visible", "true")

  await page.locator('[data-reader-swimlane-trigger="left"]').hover()
  await expect(workspace).toHaveAttribute("data-reader-swimlane-preview", "left")
  await page.getByRole("button", { name: "文件夹" }).click()
  await expect(page.locator('[data-reader-swimlane="left"]')).toHaveAttribute("data-reader-swimlane-active", "true")
  await dragHorizontally(page, page.getByRole("separator", { name: "从右侧调整左侧面板泳道宽度" }), 40)
  await expect(page.locator('[data-reader-swimlane="left"]')).toHaveJSProperty("offsetWidth", 380)
  await page.screenshot({ path: testInfo.outputPath("neoview-swimlane-focus-1920x1080.png") })
})

test("[neoview.swimlane.drag-e2e] freezes Reader width and docks the panel bar", async ({ page }) => {
  await openOrdinarySwimlane(page)
  const readerLane = page.locator('[data-reader-swimlane="reader"]')
  const rightLane = page.locator('[data-reader-swimlane="right"]')
  const rightBar = page.locator('[data-reader-panel-bar="right"]')
  const rightHandle = rightBar.getByRole("button", { name: "拖动或设置面板操作栏" })
  const rightLaneBox = await rightLane.boundingBox()
  const rightHandleBox = await rightHandle.boundingBox()
  expect(rightLaneBox).not.toBeNull()
  expect(rightHandleBox).not.toBeNull()

  await page.mouse.move(rightHandleBox!.x + rightHandleBox!.width / 2, rightHandleBox!.y + rightHandleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(rightLaneBox!.x + rightLaneBox!.width / 2, rightLaneBox!.y + rightLaneBox!.height - 8, { steps: 6 })
  await page.mouse.up()
  await expect(rightBar).toHaveAttribute("data-reader-panel-bar-dock", "bottom")
  await expect(rightBar).toHaveClass(/flex-row/)

  const separator = page.getByRole("separator", { name: "从右侧调整阅读器泳道宽度" })
  const box = await separator.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 120)
  await page.mouse.down()
  await page.mouse.move(box!.x + 100, box!.y + 120, { steps: 4 })
  await page.mouse.up()
  const releasedWidth = await readerLane.evaluate((node) => node.getBoundingClientRect().width)
  await page.mouse.move(box!.x + 220, box!.y + 120)
  await page.waitForTimeout(80)
  expect(await readerLane.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(releasedWidth, 0)
})

test("[neoview.swimlane.portrait-e2e] adds lanes, fits proportions and stays bounded in portrait", async ({ page }, testInfo) => {
  await openOrdinarySwimlane(page)
  const breadcrumb = page.locator('[data-reader-breadcrumb-bar="true"]')
  const readerLane = page.locator('[data-reader-swimlane="reader"]')
  const navigator = page.locator('[data-reader-lane-navigator="true"]')

  await openNavigatorMenu(navigator)
  await page.getByRole("menuitem", { name: "添加泳道" }).click()
  await page.getByRole("textbox", { name: "泳道名称" }).fill("资料")
  await page.getByRole("button", { name: "确认添加泳道" }).click()
  await expect(page.locator("[data-reader-swimlane]")).toHaveCount(4)
  await expect(navigator.getByRole("button", { name: "定位资料泳道" })).toBeVisible()

  const widthsBeforeFit = await laneWidths(page)
  await openNavigatorMenu(navigator)
  await page.getByRole("menuitem", { name: "按当前比例填满视口" }).click()
  await expect.poll(async () => (await laneWidths(page)).reduce((sum, width) => sum + width, 0)).toBeCloseTo(1920, 0)
  const fittedWidths = await laneWidths(page)
  const factors = fittedWidths.map((width, index) => width / widthsBeforeFit[index]!)
  expect(Math.max(...factors) - Math.min(...factors)).toBeLessThan(0.01)

  await openNavigatorMenu(navigator)
  await page.getByRole("menuitemcheckbox", { name: "Reader 独占时显示" }).click()
  await navigator.getByRole("button", { name: "定位阅读器泳道" }).click()
  await expect(navigator).toBeVisible()
  await expect(breadcrumb.getByRole("button", { name: "退出 Reader 全屏" })).toBeVisible()
  await breadcrumb.getByRole("button", { name: "退出 Reader 全屏" }).click()

  await page.setViewportSize({ width: 600, height: 900 })
  await expect.poll(() => readerLane.evaluate((node) => node.getBoundingClientRect().width)).toBeLessThanOrEqual(600)
  await openNavigatorMenu(navigator)
  await page.getByRole("menuitem", { name: "按当前比例填满视口" }).click()
  await expect.poll(async () => (await laneWidths(page)).reduce((sum, width) => sum + width, 0)).toBeCloseTo(600, 0)
  const navigatorBox = await navigator.boundingBox()
  expect(navigatorBox).not.toBeNull()
  expect(navigatorBox!.x).toBeGreaterThanOrEqual(0)
  expect(navigatorBox!.x + navigatorBox!.width).toBeLessThanOrEqual(600)
  await page.screenshot({ path: testInfo.outputPath("neoview-swimlane-portrait-600x900.png") })

  await breadcrumb.getByRole("button", { name: "Reader 全屏" }).click()
  await expect(readerLane).toHaveJSProperty("offsetWidth", 600)
  await breadcrumb.getByRole("button", { name: "四边栏模式" }).click()
  await expect(page.locator('[data-neoview-workspace-mode="edges"]')).toBeVisible()
})

async function openHarness(page: Page, viewport: { width: number; height: number }) {
  test.setTimeout(45_000)
  await page.setViewportSize(viewport)
  await page.goto(HARNESS, { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Swimlane Workspace Harness")
}

async function openOrdinarySwimlane(page: Page) {
  await openHarness(page, { width: 1920, height: 1080 })
  const breadcrumb = page.locator('[data-reader-breadcrumb-bar="true"]')
  await breadcrumb.getByRole("button", { name: "泳道模式" }).click()
  await breadcrumb.getByRole("button", { name: "退出 Reader 全屏" }).click()
  await expect(page.locator('[data-reader-swimlane-header="reader"]')).toBeVisible()
}

async function laneWidths(page: Page): Promise<number[]> {
  return await page.locator("[data-reader-swimlane]").evaluateAll((lanes) => lanes.map((lane) => lane.getBoundingClientRect().width))
}

async function dragHorizontally(page: Page, handle: import("@playwright/test").Locator, deltaX: number) {
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  const x = box!.x + box!.width / 2
  const y = box!.y + Math.min(120, box!.height / 2)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + deltaX, y, { steps: 4 })
  await page.mouse.up()
}

async function openNavigatorMenu(navigator: import("@playwright/test").Locator) {
  await navigator.getByRole("button", { name: "拖动或设置泳道切换栏" }).click({ button: "right" })
}
