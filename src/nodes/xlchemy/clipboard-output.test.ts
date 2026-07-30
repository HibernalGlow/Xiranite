import { describe, expect, test, vi } from "vitest"
import type { XlchemyData } from "@xiranite/node-xlchemy/core"

import { copyClipboardConversion, type ClipboardConversionResult } from "./clipboard-output"

describe("XLchemy clipboard output", () => {
  test("copies a persistent encoded output path without staging it again", async () => {
    const writeFiles = vi.fn(async () => undefined)
    const stageFiles = vi.fn(async () => ["D:/staged/xlchemy-clipboard.avif"])
    const conversion = createConversion("directory", [{ sourcePath: "D:/input.png", outputPath: "D:/exports/input.avif", status: "converted" }])

    await copyClipboardConversion(conversion, "file", { writeFiles }, { getUrl: String, stageFiles })

    expect(writeFiles).toHaveBeenCalledWith(["D:/exports/input.avif"])
    expect(stageFiles).not.toHaveBeenCalled()
  })

  test("stages source-mode bytes as a format-preserving file before copying", async () => {
    const writeFiles = vi.fn(async () => undefined)
    let stagedFile: File | undefined
    const stageFiles = vi.fn(async (files: File[]) => {
      stagedFile = files[0]
      return ["D:/staged/xlchemy-clipboard.avif"]
    })

    await copyClipboardConversion(createConversion("source"), "file", { writeFiles }, { getUrl: String, stageFiles })

    expect(stagedFile).toMatchObject({ name: "xlchemy-clipboard.avif", type: "image/avif" })
    await expect(stagedFile!.text()).resolves.toBe("avif")
    expect(writeFiles).toHaveBeenCalledWith(["D:/staged/xlchemy-clipboard.avif"])
  })

  test("keeps the compatibility image path explicit", async () => {
    const writeFiles = vi.fn(async () => undefined)
    const writeImage = vi.fn(async () => undefined)
    await copyClipboardConversion(createConversion("source"), "image", { writeFiles, writeImage }, undefined)
    expect(writeImage).toHaveBeenCalledWith({ base64: "YXZpZg==", mimeType: "image/avif" })
    expect(writeFiles).not.toHaveBeenCalled()
  })
})

function createConversion(outputMode: "source" | "directory", files: XlchemyData["files"] = []): ClipboardConversionResult {
  return {
    data: { files, inputCount: 1, convertedCount: 1, skippedCount: 0, errorCount: 0, inputBytes: 8, outputBytes: 4, errors: [] },
    format: "AVIF",
    output: { base64: "YXZpZg==", mimeType: "image/avif" },
    outputMode,
    quality: 42,
  }
}
