import { expect, test } from "@playwright/test"

test("[neoview.browser-boundary] loads the workspace module entry without Node runtime modules", async ({ page }) => {
  const pageErrors: Error[] = []
  const modulePaths: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error))
  page.on("request", (request) => modulePaths.push(new URL(request.url()).pathname))

  await page.goto(`/tests/e2e/neoview/neoview-module-boundary-harness.html?fresh=${Date.now()}`, { waitUntil: "domcontentloaded" })

  await expect(page.locator('[data-neoview-module-boundary="ready"]')).toHaveText("ready", { timeout: 30_000 })
  expect(modulePaths).toContain("/src/nodes/neoview/entry.ts")
  expect(modulePaths).toContain("/packages/nodes/neoview/src/ui-core.ts")
  expect(modulePaths.filter((path) => /(?:\/dist\/(?:index|core|ui-core)\.js|\/src\/core\.ts|ReaderDirectorySort|ReaderFileTree(?:Service|Index))/i.test(path))).toEqual([])
  expect(pageErrors.map((error) => error.message)).not.toEqual(expect.arrayContaining([
    expect.stringMatching(/externalized for browser compatibility|Cannot access "node:/i),
  ]))

  const transformedEntry = await (await page.request.get(`/src/nodes/neoview/entry.ts?boundary=${Date.now()}`)).text()
  expect(transformedEntry).toContain("/packages/nodes/neoview/src/ui-core.ts")
  expect(transformedEntry).not.toMatch(/node_modules\/@xiranite\/node-neoview|\/dist\/(?:index|core)\.js/i)
})
