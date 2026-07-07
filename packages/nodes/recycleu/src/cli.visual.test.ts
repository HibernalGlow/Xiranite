import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("recycleu guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "recycleu",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择 recycleu 任务",
    })

    expect(capture.plainText).toContain("Xiranite Recycleu")
    expect(capture.plainText).toContain("回收站清理工具")
    expect(capture.plainText).toContain("选择 recycleu 任务")
    expect(capture.plainText).toContain("auto-clean")
    expect(capture.plainText).toContain("clean-now")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
