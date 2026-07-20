import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 960, height: 900 } })

test("[neoview.ai-cards.e2e] renders the reference card hierarchy and exercises real control-plane actions", async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) consoleErrors.push(message.text())
  })

  await page.goto("/tests/e2e/neoview/neoview-ai-cards-harness.html", { waitUntil: "domcontentloaded" })
  await expect(page).toHaveTitle("NeoView AI Cards Harness")

  const board = page.locator('[data-ai-card-board="true"]')
  const service = page.locator('[data-neoview-card="ai-service-config"]')
  await expect(service.getByText("在线", { exact: true })).toBeVisible()
  await expect(service.locator("select")).toHaveValue("qwen2.5:7b")
  await service.getByRole("button", { name: "探测模型" }).click()
  await expect(service.getByRole("status")).toContainText("已刷新 Ollama 状态和模型列表")

  const translator = page.locator('[data-neoview-card="ai-translation-test"]')
  await translator.getByLabel("输入文本").press("Control+Enter")
  await expect(translator.getByText("译文：こんにちは")).toBeVisible()

  const cache = page.locator('[data-neoview-card="ai-translation-cache"]')
  await expect(cache.getByText("48", { exact: true })).toBeVisible()
  await cache.getByRole("button", { name: "清空" }).click()
  await expect.poll(() => page.locator("html").getAttribute("data-ai-cache-scope")).toBe("all")
  await expect(cache.getByText("0", { exact: true }).first()).toBeVisible()

  for (const card of await page.locator("[data-reader-card]").all()) {
    expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  }
  expect(consoleErrors).toEqual([])
  await board.screenshot({ path: testInfo.outputPath("neoview-ai-cards.png") })
})
