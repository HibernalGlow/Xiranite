import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("mvz guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "mvz",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择要执行的动作",
    })

    expect(capture.plainText).toContain("Xiranite Mvz")
    expect(capture.plainText).toContain("7-Zip 压缩包内文件操作工具")
    expect(capture.plainText).toContain("选择要执行的动作")
    expect(capture.plainText).toContain("extract")
    expect(capture.plainText).toContain("move")
    expect(capture.plainText).toContain("delete")
    expect(capture.plainText).toContain("rename")
    expect(capture.plainText).toContain("xmvz extract --entry archive.zip//file.txt --dry-run --json")
    expect(capture.plainText).not.toContain("Enter path(s)")
    expect(capture.plainText).not.toContain("Entry")
    expect(capture.plainText).not.toContain("Script")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
