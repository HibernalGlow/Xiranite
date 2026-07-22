import { expect, test, type Locator, type Page } from "@playwright/test"

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "project LaneView is verified once")
})

test("project LaneView reuses focus, solo, fixed dock, and the collapse drag handle", async ({ page }) => {
  await page.goto("/tests/e2e/swimlane-lane-view-harness.html", { waitUntil: "domcontentloaded" })
  const state = page.locator("output")
  const left = page.locator('[data-lane-id="lane-left"]')
  const right = page.locator('[data-lane-id="lane-right"]')
  await expect(left).toBeVisible()
  await expect(right).toBeVisible()

  await dragTo(page, left.locator('[data-lane-drag-handle="true"]'), right.locator('[data-lane-drag-handle="true"]'))
  await expect(state).toHaveAttribute("data-lane-order", "lane-right,lane-left")
  await expect.poll(() => page.locator("[data-lane-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-lane-id")).join(","))).toBe("lane-right,lane-left")

  const barHandle = page.getByRole("button", { name: "拖动或设置泳道切换栏" })
  await barHandle.click({ button: "right" })
  await page.getByRole("menuitem", { name: "固定位置" }).hover()
  await page.getByRole("menuitemradio", { name: "固定到顶部" }).click()
  await expect(state).toHaveAttribute("data-navigator-dock", "top")
  await expect(page.locator('[data-lane-id="lane-left"] [data-swimlane-navigator-dock="top"]')).toBeVisible()

  const pinnedHandleBox = await barHandle.boundingBox()
  const rightLaneBox = await right.boundingBox()
  if (!pinnedHandleBox || !rightLaneBox) throw new Error("Missing cross-lane dock geometry")
  await page.mouse.move(pinnedHandleBox.x + pinnedHandleBox.width / 2, pinnedHandleBox.y + pinnedHandleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(rightLaneBox.x + rightLaneBox.width / 2, rightLaneBox.y + rightLaneBox.height / 2, { steps: 8 })
  await expect(page.locator("[data-swimlane-navigator-dock-zones]")).toHaveCount(2)
  await page.mouse.move(rightLaneBox.x + rightLaneBox.width - 8, rightLaneBox.y + rightLaneBox.height / 2, { steps: 8 })
  await expect(right.locator('[data-swimlane-navigator-dropzone="right"]')).toHaveAttribute("data-active", "true")
  await page.mouse.up()
  await expect(state).toHaveAttribute("data-navigator-dock", "right")
  await expect(state).toHaveAttribute("data-navigator-lane", "lane-right")

  const redockedHandleBox = await barHandle.boundingBox()
  if (!redockedHandleBox) throw new Error("Missing redocked handle geometry")
  await page.mouse.move(redockedHandleBox.x + redockedHandleBox.width / 2, redockedHandleBox.y + redockedHandleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(rightLaneBox.x + rightLaneBox.width / 2, rightLaneBox.y + rightLaneBox.height / 2, { steps: 12 })
  await expect(right.locator('[data-swimlane-navigator-float-zone="true"]')).toHaveAttribute("data-active", "true")
  await page.mouse.up()
  await expect(state).toHaveAttribute("data-navigator-dock", "floating")

  await barHandle.click({ button: "right" })
  await page.getByRole("menuitem", { name: "当前泳道独占视口" }).click()
  await expect(state).toHaveAttribute("data-solo-lane", "lane-left")
  const soloWidth = await left.evaluate((node) => node.getBoundingClientRect().width)
  expect(soloWidth).toBeGreaterThan(800)

  await page.getByRole("button", { name: "Right (0)" }).click()
  await expect(state).toHaveAttribute("data-active-lane", "lane-right")
  await expect(page.getByRole("navigation", { name: "泳道快速切换" })).toHaveAttribute("data-swimlane-navigator-dock", "floating")
  expect(await left.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(soloWidth, 0)
})

async function dragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error("Missing LaneView drag geometry")
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 16 })
  await page.mouse.up()
}
