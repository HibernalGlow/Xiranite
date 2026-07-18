import { execFile, spawnSync } from "node:child_process"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { runGifu, type GifuFormat } from "./core.js"
import { createNodeGifuRuntime } from "./platform.js"

const exec = promisify(execFile)
const sevenZip = locate("7z")
const ffmpeg = locate("ffmpeg")
const hasNativeTools = Boolean(sevenZip && ffmpeg)

describe.skipIf(!hasNativeTools)("gifu native conversion integration", () => {
  let root = ""
  let archive = ""

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "gifu-native-test-"))
    const first = join(root, "001.png")
    const second = join(root, "002.png")
    await exec(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=8x6", "-frames:v", "1", first])
    await exec(ffmpeg!, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=6x8", "-frames:v", "1", second])
    archive = join(root, "frames.zip")
    await exec(sevenZip!, ["a", archive, "001.png", "002.png"], { cwd: root })
  }, 30_000)

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  test.each(["gif", "webp", "apng", "webm", "mp4"] satisfies GifuFormat[])("creates a non-empty %s animation", async (format) => {
    const result = await runGifu({
      action: "make",
      path: archive,
      format,
      outDir: join(root, format),
      durationMs: 100,
      dryRun: false,
      overwrite: true,
      maxWorkers: 1,
    }, createNodeGifuRuntime())

    expect(result.success, result.message + "\n" + result.data?.errors.join("\n")).toBe(true)
    expect(result.data?.convertedCount).toBe(1)
    const output = result.data?.archives[0]?.outputPath
    expect(output).toBeTruthy()
    expect((await stat(output!)).size).toBeGreaterThan(0)
  }, 120_000)
})

function locate(command: string): string | null {
  try {
    const locator = process.platform === "win32" ? "where.exe" : "which"
    const result = spawnSync(locator, [command], { encoding: "utf8" })
    if (result.status !== 0) return null
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null
  } catch {
    return null
  }
}
