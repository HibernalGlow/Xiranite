import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1440, height: 900 } })

test("[neoview.super-resolution.gui-runtime] starts speculative work and renders both bottom progress tracks", async ({ page }) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  await page.goto("/tests/e2e/neoview/neoview-upscale-runtime-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView Upscale Runtime Harness")
  await expect(page.locator('[data-reader-frame-viewport="true"]')).toBeVisible()
  await expect(page.getByRole("img", { name: "002.svg" })).toBeVisible()
  await expect(page.getByRole("progressbar", { name: "翻页进度" })).toHaveAttribute("aria-valuenow", "2")
  await expect(page.getByRole("progressbar", { name: "超分进度" })).toHaveAttribute("aria-valuenow", "50")
  await expect(page.locator('[data-reader-progress-layer="true"]')).toHaveCSS("position", "absolute")

  await expect.poll(() => page.locator("html").getAttribute("data-upscale-runtime-events")).toContain("start:nearby:page-2")
  const initialEvents = (await page.locator("html").getAttribute("data-upscale-runtime-events"))!.split(",")
  expect(initialEvents.indexOf("start:nearby:page-2")).toBeLessThan(initialEvents.indexOf("current:page-2"))
  expect(initialEvents).toContain("start:progressive:page-2")

  await page.getByRole("button", { name: "下一页" }).click()
  await expect(page.getByRole("img", { name: "003.svg" })).toBeVisible()
  await expect(page.getByRole("progressbar", { name: "翻页进度" })).toHaveAttribute("aria-valuenow", "3")
  await expect.poll(() => page.locator("html").getAttribute("data-upscale-runtime-events")).toContain("start:nearby:page-3")

  await page.getByRole("button", { name: "切换进度条" }).click()
  await expect(page.getByRole("progressbar", { name: "翻页进度" })).toHaveCount(0)
  await page.getByRole("button", { name: "切换进度条" }).click()
  await expect(page.getByRole("progressbar", { name: "翻页进度" })).toBeVisible()
  expect(consoleErrors).toEqual([])
})
