import { describe, expect, it, vi } from "vitest"
import { runArcThumb, type ArcThumbRuntime } from "./core.js"

function runtime(): ArcThumbRuntime {
  return {
    info: () => ({ apiVersion: 1, sourceVersion: "test", archiveFormats: [".cbz", ".epub"] }),
    createArchiveThumbnail: vi.fn(async () => ({ data: Buffer.from("cover"), width: 320, height: 480, sourceName: "cover.jpg", contentKind: "archive", mimeType: "image/webp" })),
    getCachedSystemThumbnailEncoded: vi.fn(async () => ({ data: Buffer.from("shell-cover"), width: 256, height: 192, mimeType: "image/webp" })),
    pathInfo: vi.fn(async (path: string) => ({ path, exists: path.endsWith("existing.cover.webp"), isFile: !path.endsWith("library"), isDirectory: path.endsWith("library") })),
    listDir: vi.fn(async () => [{ path: "D:/library/book.cbz", isFile: true, isDirectory: false }]),
    writeFile: vi.fn(async () => undefined), mkdir: vi.fn(async () => undefined),
    dirname: (path) => path.slice(0, path.lastIndexOf("/")), basename: (path) => path.slice(path.lastIndexOf("/") + 1), extname: (path) => path.slice(path.lastIndexOf(".")), join: (...parts) => parts.join("/"),
  }
}

describe("runArcThumb", () => {
  it("uses the native archive pipeline and keeps inspect results in-memory", async () => {
    const value = runtime(); const result = await runArcThumb({ paths: ["D:/book.cbz"], format: "webp", maxDimension: 640, quality: 73 }, value)
    expect(result.success).toBe(true); expect(value.createArchiveThumbnail).toHaveBeenCalledWith(expect.objectContaining({ path: "D:/book.cbz", format: "webp", maxDimension: 640, quality: 73 })); expect(value.writeFile).not.toHaveBeenCalled(); expect(result.data?.items[0]).toMatchObject({ status: "ready", width: 320, height: 480 })
  })
  it("writes only after an explicit render request and respects existing outputs", async () => {
    const value = runtime(); const result = await runArcThumb({ action: "render", paths: ["D:/book.cbz"], write: true, outputDir: "D:/out" }, value)
    expect(result.data?.writtenCount).toBe(1); expect(value.writeFile).toHaveBeenCalledWith("D:/out/book.cover.webp", expect.any(Buffer))
    const existing = await runArcThumb({ action: "render", paths: ["D:/existing.cbz"], write: true, outputDir: "D:/out" }, value)
    expect(existing.data?.writtenCount).toBe(0); expect(existing.data?.skippedCount).toBe(1)
  })
  it("reads Windows cached thumbnails without decoding archive data or writing files", async () => {
    const value = runtime()
    const result = await runArcThumb({ action: "system-thumbnail", paths: ["D:/image.avif"], maxDimension: 256 }, value)
    expect(result.success).toBe(true)
    expect(value.getCachedSystemThumbnailEncoded).toHaveBeenCalledWith(expect.objectContaining({ path: "D:/image.avif", maxDimension: 256 }))
    expect(value.createArchiveThumbnail).not.toHaveBeenCalled()
    expect(value.writeFile).not.toHaveBeenCalled()
    expect(result.data?.items[0]).toMatchObject({ status: "ready", contentKind: "system-cache", width: 256 })
  })
})
