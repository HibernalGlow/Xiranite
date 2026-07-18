import { expect, test } from "@playwright/test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"
import { startBackend } from "../../packages/backend/src/index"

const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lV9uKAAAAABJRU5ErkJggg==", "base64")

test("the real local-media endpoint is reused from Chromium cache", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "xiranite-media-cache-"))
  const imagePath = join(directory, "preview.png")
  await writeFile(imagePath, ONE_PIXEL_PNG)
  const backend = await startBackend({ token: "cache-test", repository: createMemoryWorkspaceRepository() })
  const mediaUrl = `${backend.url}/local-files?path=${encodeURIComponent(imagePath)}&token=cache-test`
  let mediaRequests = 0
  backend.server.on("request", (request) => { if (request.url?.startsWith("/local-files?")) mediaRequests += 1 })

  try {
    const firstResponse = page.waitForResponse((response) => response.url() === mediaUrl)
    await loadImage(page, mediaUrl)
    const response = await firstResponse
    expect(response.status()).toBe(200)
    expect((await response.headerValue("cache-control"))?.toLocaleLowerCase()).toContain("max-age=60")
    expect(await response.headerValue("etag")).toBeTruthy()
    expect(mediaRequests).toBe(1)

    const cachedPage = await page.context().newPage()
    const dimensions = await loadImage(cachedPage, mediaUrl)
    await cachedPage.waitForTimeout(100)
    expect(mediaRequests).toBe(1)
    expect(dimensions).toEqual({ width: 1, height: 1 })
    await cachedPage.close()
  } finally {
    backend.close()
    await rm(directory, { recursive: true, force: true })
  }
})

async function loadImage(page: import("@playwright/test").Page, url: string) {
  return page.evaluate(async (source) => {
    const image = new Image()
    image.alt = "cache probe"
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error("media cache probe failed"))
    })
    document.body.replaceChildren(image)
    image.src = source
    await loaded
    return { width: image.naturalWidth, height: image.naturalHeight }
  }, url)
}
