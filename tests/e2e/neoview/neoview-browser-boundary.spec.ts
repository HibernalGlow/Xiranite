import { expect, test } from "@playwright/test"

test("[neoview.browser-boundary] loads the React reader without Node runtime modules", async ({ page }) => {
  const pageErrors: Error[] = []
  page.on("pageerror", (error) => pageErrors.push(error))

  await page.goto("/tests/e2e/neoview/neoview-harness.html", { waitUntil: "domcontentloaded" })

  await expect(page.getByRole("button", { name: "打开书籍" })).toBeVisible()
  expect(pageErrors.map((error) => error.message)).not.toEqual(expect.arrayContaining([
    expect.stringMatching(/externalized for browser compatibility|Cannot access "node:/i),
  ]))
})
