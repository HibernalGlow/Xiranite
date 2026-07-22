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
  await handle.click({ button: "right" })
  await expect(page.getByRole("menu", { name: "泳道操作栏设置" })).toHaveCount(0)

  const before = await page.locator("output").getAttribute("data-navigator-position")
  const box = await handle.boundingBox()
  if (!box) throw new Error("Missing shared bar handle geometry")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 100, box.y - 80, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => page.locator("output").getAttribute("data-navigator-position")).not.toBe(before)
  const released = await page.locator("output").getAttribute("data-navigator-position")
  await page.mouse.move(box.x + 120, box.y + 80)
  await expect(page.locator("output")).toHaveAttribute("data-navigator-position", released!)

  await page.locator('[data-harness-lane="lane-1"]').click()
  await expect(page.locator('[data-harness-lane="lane-0"]')).toHaveCSS("width", "420px")
  await expect(page.locator('[data-harness-lane="lane-1"]')).toHaveAttribute("data-active", "true")
})
