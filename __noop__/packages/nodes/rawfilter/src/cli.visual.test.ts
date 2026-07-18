import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("rawfilter guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "rawfilter",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "粘贴文件夹路径直接执行默认任务",
    })

    expect(capture.plainText).toContain("Xiranite Rawfilter")
    expect(capture.plainText).toContain("分组重复压缩包")
    expect(capture.plainText).toContain("basic / name-only / trash-only / shortcuts / plan-only")
    expect(capture.plainText).toContain("粘贴文件夹路径直接执行默认任务")
    expect(capture.plainText).not.toContain("Entry")
    expect(capture.plainText).not.toContain("Script")
    expect(capture.plainText).not.toContain("Directory path.")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
