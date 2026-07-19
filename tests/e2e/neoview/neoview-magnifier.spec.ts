import { expect, test } from "@playwright/test"
import { createServer, type Server } from "node:http"
import { readFile } from "node:fs/promises"

let assetUrl = ""
let networkTransfers = 0
let server: Server

test.beforeAll(async () => {
  const bytes = await readFile(new URL("./neoview-image-trim-fixture.svg", import.meta.url))
  server = createServer((_request, response) => {
    networkTransfers += 1
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "cache-control": "private, max-age=31536000, immutable",
      "content-length": bytes.byteLength,
      "content-type": "image/svg+xml",
    })
    response.end(bytes)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Magnifier fixture server did not expose a TCP port")
  assetUrl = `http://127.0.0.1:${address.port}/magnifier.svg`
})

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

test("[neoview.viewer.magnifier-runtime] magnifies the committed rotated media without another img or network transfer", async ({ page }, testInfo) => {
  const imageRequests: string[] = []
  const consoleErrors: string[] = []
  page.on("request", (request) => { if (request.url() === assetUrl) imageRequests.push(request.url()) })
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()) })
  await page.goto(`/tests/e2e/neoview/neoview-magnifier-harness.html?asset=${encodeURIComponent(assetUrl)}`, { waitUntil: "networkidle" })
  await expect(page).toHaveTitle("NeoView Magnifier Harness")

  const toolbar = page.locator('[data-reader-view-toolbar="true"]')
  const toggle = toolbar.getByRole("button", { name: "放大镜" })
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-pressed", "true")
  const zoom = toolbar.getByRole("slider", { name: "放大倍率" })
  const size = toolbar.getByRole("slider", { name: "镜片大小" })
  await zoom.fill("3.4")
  await zoom.press("ArrowRight")
  await size.fill("300")
  await size.press("ArrowRight")
  await toggle.click({ button: "right" })

  const image = page.locator('[data-reader-page-image="magnifier-page"]')
  await expect(image).toBeVisible()
  const imageBox = await image.boundingBox()
  expect(imageBox).toBeTruthy()
  await page.mouse.move(imageBox!.x + imageBox!.width * 0.55, imageBox!.y + imageBox!.height * 0.45)

  const lens = page.locator('[data-reader-magnifier="true"]')
  const border = page.locator('[data-reader-magnifier-border="true"]')
  const scene = page.locator('[data-reader-magnifier-scene="true"]')
  const replica = page.locator('[data-reader-magnifier-replica="true"]')
  await expect(lens).toBeVisible()
  await expect(border).toBeVisible()
  await expect(scene).toHaveCSS("transform", "matrix(3.5, 0, 0, 3.5, 0, 0)")
  expect(await border.evaluate((element) => ({ width: getComputedStyle(element).width, height: getComputedStyle(element).height }))).toEqual({ width: "310px", height: "310px" })
  expect(await replica.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain("magnifier.svg")
  expect(await replica.evaluate((element) => getComputedStyle(element).transform)).toBe(await image.evaluate((element) => getComputedStyle(element).transform))
  expect(await replica.evaluate((element) => getComputedStyle(element).clipPath)).toBe(await image.evaluate((element) => getComputedStyle(element).clipPath))
  await expect(page.locator("img")).toHaveCount(1)
  expect(imageRequests.length).toBeGreaterThanOrEqual(1)
  expect(networkTransfers).toBe(1)

  await toggle.click()
  await expect(page.locator('[data-reader-magnifier="true"]')).toHaveCount(0)
  expect(consoleErrors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath(`neoview-magnifier-${testInfo.project.name}.png`), fullPage: false })
})
