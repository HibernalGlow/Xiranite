import { expect, test } from "@playwright/test"

test("[neoview.browser-boundary] loads the workspace module entry without Node runtime modules", async ({ page }) => {
  const pageErrors: Error[] = []
  page.on("pageerror", (error) => pageErrors.push(error))

  await page.goto("/tests/e2e/neoview/neoview-module-boundary-harness.html", { waitUntil: "domcontentloaded" })

  await expect(page.locator('[data-neoview-module-boundary="ready"]')).toHaveText("ready", { timeout: 30_000 })
  expect(pageErrors.map((error) => error.message)).not.toEqual(expect.arrayContaining([
    expect.stringMatching(/externalized for browser compatibility|Cannot access "node:/i),
  ]))
})
