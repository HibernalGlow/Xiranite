import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("crashu guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "crashu",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "留空进入任务选择",
    })

    expect(capture.plainText).toContain("Xiranite Crashu")
    expect(capture.plainText).toContain("文件夹相似度检测与批量移动")
    expect(capture.plainText).toContain("auto_dir")
    expect(capture.plainText).toContain("留空进入任务选择")
    expect(capture.plainText).not.toContain("crashu guided")
    expect(capture.plainText).not.toContain("Source directory.")
    expect(capture.plainText).not.toContain("Target directory or target name.")
    expect(capture.plainText).not.toContain("Action: scan or plan.")
    expect(capture.plainText).not.toContain("Press q to exit")
    expect(capture.plainText).not.toContain("Running...")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
