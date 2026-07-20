import { expect, test } from "@playwright/test"

test.setTimeout(30_000)

test("[neoview.emm-tags.e2e] [neoview.emm-tags.lifecycle.client] [neoview.emm-tags.image-stability] loads once per activation without page-turn work", async ({ page }, testInfo) => {
  let requests = 0
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  await page.route("**/reader/s/reader-emm-tags/metadata", async (route) => {
    requests += 1
    expect(route.request().headers()["x-xiranite-token"]).toBe("emm-tags-e2e")
    await route.fulfill({ json: metadataSnapshot() })
  })

  await page.goto("/tests/e2e/neoview/neoview-emm-tags-harness.html", { waitUntil: "domcontentloaded" })
  const card = page.locator('[data-reader-card="EMM 标签"]')
  const image = page.getByRole("img", { name: "当前页" })
  const list = card.getByRole("list", { name: "EMM 标签" })
  await expect(list.getByText("爱丽丝")).toBeVisible()
  await expect(list.getByText("glasses")).toBeVisible()
  await expect(card.getByRole("status")).toContainText("共 5 个标签")
  await expect.poll(() => requests).toBe(1)
  await image.evaluate((node) => node.setAttribute("data-emm-tags-image-instance", "stable"))

  await page.getByRole("button", { name: "下一页" }).click()
  await page.waitForTimeout(250)
  expect(requests).toBe(1)

  await page.getByRole("button", { name: "折叠卡片" }).click()
  await page.waitForTimeout(250)
  expect(requests).toBe(1)
  await page.getByRole("button", { name: "展开卡片" }).click()
  await expect.poll(() => requests).toBe(2)
  await expect(list.getByText("爱丽丝")).toBeVisible()

  expect(await image.getAttribute("data-emm-tags-image-instance")).toBe("stable")
  expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  expect(consoleErrors).toEqual([])
  await card.screenshot({ path: testInfo.outputPath(`neoview-emm-tags-${testInfo.project.name}.png`) })
})

function metadataSnapshot() {
  return {
    book: {
      bookId: "book-emm-tags",
      displayName: "EMM Tags.cbz",
      sourceKind: "archive",
      sourcePath: "D:/Books/EMM Tags.cbz",
      pageCount: 12,
      currentPage: 2,
      emm: {
        translatedTitle: "EMM 标签基准",
        tags: [
          { namespace: "artist", tag: "Alice", translatedLabel: "爱丽丝" },
          { namespace: "female", tag: "glasses" },
          { namespace: "female", tag: "long_hair" },
          { namespace: "language", tag: "chinese" },
          { namespace: "other", tag: "a-very-long-tag-that-must-wrap-within-the-card-without-horizontal-overflow" },
        ],
      },
    },
  }
}
