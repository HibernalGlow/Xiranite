import { spawnSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { createMemoryWorkspaceRepository } from "@xiranite/repository"

import { startBackend } from "../../../packages/backend/src/index"
import { createZipFixture, type ZipFixture } from "../../../packages/nodes/neoview/test/fixture-builders/create-zip-fixture"

const ffmpegAvailable = spawnSync("ffmpeg", ["-hide_banner", "-version"], { windowsHide: true }).status === 0
let fixture: ZipFixture
let backend: Awaited<ReturnType<typeof startBackend>>

test.setTimeout(90_000)
test.skip(!ffmpegAvailable, "FFmpeg is required to generate the deterministic browser video fixture.")

test.beforeAll(async () => {
  const source = await createZipFixture({ name: "video-source.cbz", entries: [] })
  const videoPath = join(source.directory, "sample.mp4")
  const generated = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=15", "-t", "30",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath,
  ], { windowsHide: true })
  expect(generated.status).toBe(0)
  const bytes = await readFile(videoPath)
  await source.cleanup()

  fixture = await createZipFixture({ name: "video.cbz", entries: [{ path: "clips/sample.mp4", bytes, level: 0 }] })
  const configPath = join(fixture.directory, "xiranite.config.toml")
  await writeFile(configPath, [
    "[nodes.neoview]",
    "schema_version = 1",
    "[nodes.neoview.panels.edges.top]",
    "enabled = true",
    "initial_visible = true",
    "pinned = true",
    'lock_mode = "locked-open"',
    "[nodes.neoview.panels.edges.left]",
    "enabled = false",
    "[nodes.neoview.panels.edges.right]",
    "enabled = false",
    "[nodes.neoview.panels.edges.bottom]",
    "enabled = false",
    "",
  ].join("\n"), "utf8")
  backend = await startBackend({
    token: "neoview-video-player-e2e",
    repository: createMemoryWorkspaceRepository(),
    configPath,
    legacyThumbnailDatabasePath: join(fixture.directory, "thumbnails.db"),
  })
})

test.afterAll(async () => {
  await backend?.close()
  await fixture?.cleanup()
})

test("[neoview.bindings.video-player-e2e] renders the streamed media-chrome player and shared video controls", async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()) })
  await page.addInitScript(({ baseUrl, token }) => { window.__XIRANITE_BACKEND__ = { baseUrl, token } }, { baseUrl: backend.url, token: backend.token })
  await page.goto(`/tests/e2e/neoview/neoview-harness.html?path=${encodeURIComponent(fixture.path)}`, { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "打开书籍" }).click()

  const player = page.locator('[data-reader-video-player="media-chrome"]')
  const videoSurface = page.getByRole("region", { name: "视频播放器" })
  const video = page.locator('video[data-input-context="video"]')
  await expect(player).toBeVisible()
  await expect(video).toBeVisible()
  await page.mouse.move(1, 1)
  await videoSurface.hover()
  await expect(page.locator('[data-reader-video-controls="true"]')).toBeVisible()
  await video.evaluate((element: HTMLVideoElement) => element.readyState >= 1
    ? undefined
    : new Promise<void>((resolve, reject) => {
      element.addEventListener("loadedmetadata", () => resolve(), { once: true })
      element.addEventListener("error", () => reject(element.error), { once: true })
    }))
  expect(await video.evaluate((element: HTMLVideoElement) => ({ duration: element.duration, width: element.videoWidth, height: element.videoHeight }))).toMatchObject({ width: 160, height: 90 })
  await page.mouse.move(1, 1)
  await videoSurface.hover()
  await expect(page.locator('[data-reader-video-controls="true"]')).toHaveCSS("opacity", "1")

  const seekMode = page.getByRole("button", { name: "开启快进模式" })
  await seekMode.click()
  await expect(page.getByRole("button", { name: "关闭快进模式" })).toBeVisible()
  expect(await video.evaluate((element: HTMLVideoElement) => ({ ended: element.ended, currentTime: element.currentTime }))).toMatchObject({ ended: false })
  await testInfo.attach(`neoview-video-player-controls-${testInfo.project.name}`, {
    body: await player.screenshot(),
    contentType: "image/png",
  })
  await page.getByRole("button", { name: "更多视频操作" }).click()
  await expect(page.getByRole("button", { name: "截图" })).toBeVisible()
  await expect(page.getByText("sample.mp4")).toBeVisible()

  const layout = await page.evaluate(() => {
    const player = document.querySelector<HTMLElement>('[data-reader-video-player="media-chrome"]')!
    const video = document.querySelector<HTMLVideoElement>('video[data-input-context="video"]')!
    const bar = document.querySelector<HTMLElement>('[data-reader-video-controls="true"]')!
    const rect = (element: HTMLElement) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return { x: box.x, y: box.y, width: box.width, height: box.height, display: style.display, opacity: style.opacity, overflow: style.overflow }
    }
    return {
      player: rect(player),
      video: { ...rect(video), readyState: video.readyState, currentTime: video.currentTime, paused: video.paused, ended: video.ended },
      bar: { ...rect(bar), clientWidth: bar.clientWidth, scrollWidth: bar.scrollWidth },
      controls: [...bar.children].map((element) => ({ tag: element.tagName, ...rect(element as HTMLElement) })),
    }
  })
  expect(layout.player.width).toBeGreaterThan(0)
  expect(layout.player.height).toBeGreaterThan(0)
  expect(Math.abs(layout.player.x - layout.video.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.player.width - layout.video.width)).toBeLessThanOrEqual(1)
  expect(layout.bar.scrollWidth).toBeLessThanOrEqual(layout.bar.clientWidth + 1)
  expect(consoleErrors).toEqual([])
  await testInfo.attach(`neoview-video-player-menu-${testInfo.project.name}`, {
    body: await player.screenshot(),
    contentType: "image/png",
  })
})
