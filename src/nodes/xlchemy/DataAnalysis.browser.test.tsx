import { expect, test } from "vitest"
import { render } from "vitest-browser-react"
import type { XlchemyData } from "@xiranite/node-xlchemy/core"
import { DataAnalysis } from "./DataAnalysis"

test("renders selected file totals from the file workbench size index", async () => {
  const view = await render(<DataAnalysis paths={["D:/images/a.webp", "D:/images/b.png"]} fileSizes={new Map([["D:/images/a.webp", 1024], ["D:/images/b.png", 3072]])} result={null} activeTab="input" />)

  await expect.element(view.getByText("4.0 KB", { exact: true })).toBeVisible()
  await expect.element(view.getByText("2.0 KB", { exact: true })).toBeVisible()
})

test("renders exact output aggregates when retained file details are truncated", async () => {
  const result: XlchemyData = {
    files: [{ sourcePath: "D:/images/recent.png", outputPath: "D:/images/recent.avif", sourceBytes: 100, outputBytes: 40, status: "converted" }],
    inputCount: 3,
    convertedCount: 3,
    skippedCount: 0,
    errorCount: 0,
    inputBytes: 600,
    outputBytes: 240,
    elapsedMs: 3_000,
    errors: [],
    detailsTruncated: true,
    outputAnalysis: { formats: [{ key: "png", count: 3, sourceBytes: 600, outputBytes: 240 }] },
  }
  const view = await render(<DataAnalysis paths={[]} result={result} activeTab="output" />)

  await expect.element(view.getByText("60.0%", { exact: true })).toBeVisible()
  await expect.element(view.getByText("3 · 60% ↓", { exact: true })).toBeVisible()
})
