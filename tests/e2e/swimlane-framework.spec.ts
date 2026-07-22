import { expect, test } from "@playwright/test"

test.describe.configure({ mode: "serial" })

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "shared swimlane framework is verified once")
})

test("shared bar scrolls, toggles its menu, freezes drag, and preserves inactive solo width", async ({ page }) => {
  await page.goto("/tests/e2e/swimlane-framework-harness.html", { waitUntil: "domcontentloaded" })
  const handle = page.getByRole("button", { name: "拖动或设置泳道切换栏" })
  const scroll = page.locator('[data-swimlane-bar-scroll="true"]')
  await expect(handle).toHaveAttribute("data-swimlane-bar-handle-style", "groove")
  await expect(handle).toHaveAttribute("data-swimlane-bar-handle-position", "right")
  expect(await scroll.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)

  await handle.click({ button: "right" })
  await expect(page.getByRole("menu", { name: "泳道操作栏设置" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "viewMode" })).toHaveCount(0)
  await page.getByRole("menuitem", { name: "操作栏外观" }).hover()
  await expect(page.getByRole("menuitemradio", { name: "四向" })).toBeVisible()
  await page.getByRole("menuitemradio", { name: "四向" }).click()
  await expect(handle).toHaveAttribute("data-swimlane-bar-handle-style", "move")
  await handle.click({ button: "right" })
  await expect(page.getByRole("menu", { name: "泳道操作栏设置" })).toHaveCount(0)

  const positionOutput = page.locator("output[data-navigator-position]")
  const before = await positionOutput.getAttribute("data-navigator-position")
  const box = await handle.boundingBox()
  if (!box) throw new Error("Missing shared bar handle geometry")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 100, box.y - 80, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => positionOutput.getAttribute("data-navigator-position")).not.toBe(before)
  const released = await positionOutput.getAttribute("data-navigator-position")
  await page.mouse.move(box.x + 120, box.y + 80)
  await expect(positionOutput).toHaveAttribute("data-navigator-position", released!)

  const movedHandleBox = await handle.boundingBox()
  const titleBox = await page.locator("header").boundingBox()
  if (!movedHandleBox || !titleBox) throw new Error("Missing title dock geometry")
  await page.mouse.move(movedHandleBox.x + movedHandleBox.width / 2, movedHandleBox.y + movedHandleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('output[data-navigator-dock="top"]')).toHaveCount(1)
  await expect(page.locator("header").locator('[data-swimlane-navigator-dock="top"]')).toBeVisible()

  await page.locator('[data-harness-lane="lane-1"]').click()
  await expect(page.locator('[data-harness-lane="lane-0"]')).toHaveCSS("width", "420px")
  await expect(page.locator('[data-harness-lane="lane-1"]')).toHaveAttribute("data-active", "true")
})
