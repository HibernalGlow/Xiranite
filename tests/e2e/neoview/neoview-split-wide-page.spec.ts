import { expect, test } from "@playwright/test"

test("[neoview.reader.split-wide-pages] switches physical halves without another media request or DOM image", async ({ page }, testInfo) => {
  const imageRequests: string[] = []
  const consoleErrors: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("neoview-image-trim-fixture.svg")) imageRequests.push(request.url())
  })
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await page.goto("/tests/e2e/neoview/neoview-split-wide-page-harness.html", { waitUntil: "networkidle" })
  await expect(page).toHaveTitle("NeoView Split Wide Page Harness")
  const image = page.locator('[data-reader-page-image="split-wide-page"]')
  const box = page.locator('[data-reader-page-box="split-wide-page"]')
  await expect(image).toBeVisible()
  await expect(page.getByRole("button", { name: "左半页" })).toHaveAttribute("aria-pressed", "true")
  expect(await image.evaluate((element) => element.style.clipPath)).toBe("inset(0% 50% 0% 0%)")
  expect(await image.evaluate((element) => element.style.transform)).toContain("translate(25%, 0%)")
  const leftBox = await box.boundingBox()
  expect(leftBox).toBeTruthy()
  expect(leftBox!.width / leftBox!.height).toBeCloseTo(0.75, 1)
  await image.evaluate((element) => { (window as typeof window & { __splitWideImage?: Element }).__splitWideImage = element })
  const source = await image.getAttribute("src")

  await page.getByRole("button", { name: "右半页" }).click()
  await expect(page.locator("main")).toHaveAttribute("data-split-wide-part", "1")
  await expect(page.getByRole("button", { name: "右半页" })).toHaveAttribute("aria-pressed", "true")
  expect(await image.evaluate((element) => element.style.clipPath)).toBe("inset(0% 0% 0% 50%)")
  expect(await image.evaluate((element) => element.style.transform)).toContain("translate(-25%, 0%)")
  expect(await image.evaluate((element) => (window as typeof window & { __splitWideImage?: Element }).__splitWideImage === element)).toBe(true)
  expect(await image.getAttribute("src")).toBe(source)
  expect(imageRequests).toHaveLength(1)
  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`neoview-split-wide-page-${testInfo.project.name}.png`), fullPage: false })
})
