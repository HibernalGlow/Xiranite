import { describe, expect, test } from "vitest"
import type { TransqDirectorySnapshot, TransqRuntime } from "./core.js"
import { planTransqQueue, runTransq } from "./core.js"

const snapshot: TransqDirectorySnapshot = {
  originalImagesPath: "D:/translation/chapter/original_images",
  resultPath: "D:/translation/chapter/original_images/manga_translator_work/result",
  outputPath: "D:/translation/chapter/result",
  outputExists: false,
  originalFiles: ["001.png", "002.png"],
  resultFiles: ["001.png"],
  mappedFiles: ["001.png", "002.png"],
  cleanupPaths: ["D:/translation/chapter/original_images/manga_translator_work/inpainted"],
}

describe("native transq", () => {
  test("plans copies for translation-map files missing from result", () => {
    const item = planTransqQueue(snapshot)

    expect(item.status).toBe("pending")
    expect(item.missingFiles).toEqual(["002.png"])
    expect(item.copies).toEqual([{
      filename: "002.png",
      sourcePath: "D:/translation/chapter/original_images/002.png",
      destinationPath: "D:/translation/chapter/original_images/manga_translator_work/result/002.png",
    }])
  })

  test("keeps an existing output folder as a conflict", () => {
    const item = planTransqQueue({ ...snapshot, outputExists: true })

    expect(item.status).toBe("conflict")
    expect(item.errors[0]).toContain("Output already exists")
  })

  test("executes a native queue without Python or PackU arguments", async () => {
    const operations: string[] = []
    const runtime: TransqRuntime = {
      scanRoots: async () => [snapshot],
      copyFile: async (source, destination) => { operations.push(`copy ${source} -> ${destination}`) },
      moveDirectory: async (source, destination) => { operations.push(`move ${source} -> ${destination}`) },
      removePath: async (path) => { operations.push(`remove ${path}`) },
    }

    const result = await runTransq({ action: "run", paths: ["D:/translation"], preview: false }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.outputCount).toBe(1)
    expect(operations).toEqual([
      "copy D:/translation/chapter/original_images/002.png -> D:/translation/chapter/original_images/manga_translator_work/result/002.png",
      "remove D:/translation/chapter/original_images/manga_translator_work/inpainted",
      "move D:/translation/chapter/original_images/manga_translator_work/result -> D:/translation/chapter/result",
      "remove D:/translation/chapter/original_images",
    ])
  })
})
