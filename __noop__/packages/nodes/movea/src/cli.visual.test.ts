import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("movea guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "movea",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "留空进入任务选择",
    })

    expect(capture.plainText).toContain("Xiranite Movea")
    expect(capture.plainText).toContain("压缩包归档工具")
    expect(capture.plainText).toContain("按一级文件夹扫描")
    expect(capture.plainText).toContain("move-all")
    expect(capture.plainText).toContain("留空进入任务选择")
    expect(capture.plainText).not.toContain("movea guided")
    expect(capture.plainText).not.toContain("Press q to exit")
    expect(capture.plainText).not.toContain("Action: scan or match")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
