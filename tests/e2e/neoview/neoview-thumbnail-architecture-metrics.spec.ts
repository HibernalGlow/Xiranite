import { expect, test } from "@playwright/test"

test.setTimeout(45_000)

test("[neoview.thumbnail-architecture-metrics.e2e] [neoview.thumbnail-architecture-metrics.image-stability] polls only while active and keeps the Reader image stable", async ({ page }, testInfo) => {
  let requests = 0
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  await page.route("**/reader/diagnostics", async (route) => {
    requests += 1
    expect(route.request().headers()["x-xiranite-token"]).toBe("thumbnail-metrics-e2e")
    await route.fulfill({ json: diagnosticsSnapshot(requests) })
  })

  await page.goto("/tests/e2e/neoview/neoview-thumbnail-architecture-metrics-harness.html", { waitUntil: "domcontentloaded" })
  const card = page.locator('[data-reader-card="缩略图架构指标"]')
  const image = page.getByRole("img", { name: "当前页" })
  await expect(card.getByRole("heading", { name: "缩略图架构指标" })).toBeVisible()
  await expect(card.getByText("已缓存")).toBeVisible()
  await expect(card.getByText("当前阅读")).toBeVisible()
  await expect(card.getByText("未采集，避免影响翻页热路径").first()).toBeVisible()
  await expect.poll(() => requests).toBeGreaterThanOrEqual(1)
  await image.evaluate((node) => node.setAttribute("data-thumbnail-metrics-image-instance", "stable"))

  const beforeRefresh = requests
  await card.getByRole("button", { name: "刷新" }).click()
  await expect.poll(() => requests).toBeGreaterThan(beforeRefresh)
  await card.getByRole("button", { name: "重置采样" }).click()

  await page.getByRole("button", { name: "折叠卡片" }).click()
  const collapsedRequests = requests
  await page.waitForTimeout(2_300)
  expect(requests).toBe(collapsedRequests)
  await page.getByRole("button", { name: "展开卡片" }).click()
  await expect.poll(() => requests).toBeGreaterThan(collapsedRequests)

  expect(await image.getAttribute("data-thumbnail-metrics-image-instance")).toBe("stable")
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  expect(consoleErrors).toEqual([])
  await card.screenshot({ path: testInfo.outputPath(`neoview-thumbnail-architecture-metrics-${testInfo.project.name}.png`) })
})

function diagnosticsSnapshot(sample: number) {
  const cacheHits = 20 + sample
  return {
    schemaVersion: 1,
    sampledAtMs: Date.now(),
    reader: { activeSessions: 1 },
    assets: {
      activeTransformFlights: 0,
      presentation: null,
      thumbnails: {
        demands: 2,
        activeFlights: 1,
        queuedFlights: 0,
        runningFlights: 1,
        cachedEntries: 12,
        cachedBytes: 8_192,
        telemetry: {
          cacheHits,
          cacheMisses: 4,
          completed: 9 + sample,
          failed: 1,
          cancelled: 0,
          evictions: 2,
          byLane: {
            "reader-visible": { demands: cacheHits + 4, cacheHits, cacheMisses: 4, completed: 8 + sample, failed: 0, cancelled: 0 },
            "library-visible": { demands: 4, cacheHits: 3, cacheMisses: 1, completed: 1, failed: 0, cancelled: 0 },
            prefetch: { demands: 2, cacheHits: 1, cacheMisses: 1, completed: 1, failed: 0, cancelled: 0 },
            "folder-preview": { demands: 0, cacheHits: 0, cacheMisses: 0, completed: 0, failed: 0, cancelled: 0 },
            background: { demands: 1, cacheHits: 0, cacheMisses: 1, completed: 0, failed: 1, cancelled: 0 },
          },
        },
      },
    },
    presentationDiskCache: { enabled: false },
    solidArchiveCache: { retainedBytes: 0 },
  }
}
