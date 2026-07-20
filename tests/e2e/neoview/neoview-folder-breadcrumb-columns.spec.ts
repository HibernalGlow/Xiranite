import { writeFile } from "node:fs/promises"
import { basename, join, parse, relative } from "node:path"
import { expect, test } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"
import { createZipFixture, type ZipFixture } from "../../../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
))

let fixture: ZipFixture
let backend: Awaited<ReturnType<typeof startBackend>>

test.beforeAll(async () => {
  fixture = await createZipFixture({ entries: [{ path: "pages/001.png", bytes: ONE_PIXEL_PNG, level: 0 }] })
  const configPath = join(fixture.directory, "xiranite.config.toml")
  await writeFile(configPath, "[nodes.neoview]\nschema_version = 1\n", "utf8")
  backend = await startBackend({
    token: "neoview-breadcrumb-columns-e2e",
    repository: createMemoryWorkspaceRepository(),
    configPath,
  })
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.folder.breadcrumb-columns-e2e] keeps the latest three directory columns full-width and collapses older ancestors", async ({ page }, testInfo) => {
  const { root, pathByDepth } = directoryPathChain(fixture.directory)
  await page.route("**/reader/browser/s/**/tree**", async (route) => {
    const requestUrl = new URL(route.request().url())
    const requestedPath = requestUrl.searchParams.get("path") ?? root
    const depth = pathByDepth.findIndex((path) => sameDirectoryPath(path, requestedPath))
    const nextPath = depth >= 0 ? pathByDepth[depth + 1] : undefined
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "breadcrumb-columns",
        path: requestedPath,
        entries: nextPath ? [{
          name: basename(nextPath),
          path: nextPath,
          kind: "directory",
          readerSupported: false,
        }] : [],
        generation: 1,
        cacheHit: false,
        excludedPaths: [],
      }),
    })
  })
  await page.addInitScript(({ baseUrl, token }) => {
    window.__XIRANITE_BACKEND__ = { baseUrl, token }
  }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()

  const image = page.locator("img[data-reader-page-image]").first()
  await expect(image).toBeVisible()
  await image.evaluate((element) => element.setAttribute("data-breadcrumb-columns-image-instance", "stable"))
  const sidebar = page.locator('[data-reader-sidebar="left"]')
  if (!await sidebar.isVisible()) await page.mouse.move(1, page.viewportSize()!.height / 2)
  const folderCard = sidebar.locator('[data-neoview-folder-card="true"]')
  await expect(folderCard).toBeVisible()

  await folderCard.getByRole("button", { name: "展开目录列" }).click()
  const columns = folderCard.getByRole("tree", { name: "目录列导航" })
  await expect(columns).toBeVisible()
  const collapsed = columns.locator('[data-breadcrumb-column-collapsed="true"]')
  await expect.poll(() => collapsed.count()).toBeGreaterThan(0)
  const allColumns = columns.locator('[data-miller-columns-column]')
  await expect.poll(() => allColumns.count()).toBeGreaterThanOrEqual(4)

  const collapsedWidths = await collapsed.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width))
  expect(collapsedWidths.every((width) => width <= 32)).toBe(true)
  const fullWidths = await allColumns.evaluateAll((elements) => elements
    .filter((element) => element.getAttribute("data-breadcrumb-column-collapsed") !== "true")
    .map((element) => element.getBoundingClientRect().width))
  expect(fullWidths.slice(-3).every((width) => width >= 160)).toBe(true)

  await folderCard.getByRole("button", { name: "目录列显示方式" }).click()
  await page.getByRole("menuitemradio", { name: "浮动窗口" }).click()
  await expect(folderCard.locator('[data-breadcrumb-columns-inline="true"]')).toHaveCount(0)
  await folderCard.getByRole("button", { name: "展开目录列" }).click()
  await expect(page.getByRole("tree", { name: "目录列导航" })).toBeVisible()
  expect(await image.getAttribute("data-breadcrumb-columns-image-instance")).toBe("stable")
  await folderCard.screenshot({ path: testInfo.outputPath(`neoview-folder-breadcrumb-columns-${testInfo.project.name}.png`) })
})

function directoryPathChain(path: string): { root: string; pathByDepth: readonly string[] } {
  const parsed = parse(path)
  const segments = relative(parsed.root, path).split(/[\\/]+/).filter(Boolean)
  const pathByDepth = [parsed.root]
  for (const segment of segments) pathByDepth.push(join(pathByDepth.at(-1)!, segment))
  return { root: parsed.root, pathByDepth }
}

function sameDirectoryPath(left: string, right: string): boolean {
  return left.replace(/[\\/]+$/, "").replaceAll("/", "\\").toLocaleLowerCase()
    === right.replace(/[\\/]+$/, "").replaceAll("/", "\\").toLocaleLowerCase()
}
