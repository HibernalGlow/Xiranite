import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("formatv guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "formatv",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "粘贴文件夹路径",
      closeInput: "\r\u0003",
      timeoutMs: 10_000,
    })

    expect(capture.plainText).toContain("Xiranite Formatv")
    expect(capture.plainText).toContain("视频格式处理工具")
    expect(capture.plainText).toContain("粘贴文件夹路径")
    expect(capture.plainText).toContain("scan")
    expect(capture.plainText).toContain("add-nov")
    expect(capture.plainText).toContain("duplicates")
    expect(capture.plainText).not.toContain("formatv guided")
    expect(capture.plainText).not.toContain("Video folder path")
    expect(capture.plainText).not.toContain("Press q to exit")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
