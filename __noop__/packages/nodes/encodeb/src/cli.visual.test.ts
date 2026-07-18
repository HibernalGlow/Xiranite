import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("encodeb guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "encodeb",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "粘贴路径直接执行默认任务",
    })

    expect(capture.plainText).toContain("Xiranite Encodeb")
    expect(capture.plainText).toContain("名称修复工具")
    expect(capture.plainText).toContain("剪贴板优先")
    expect(capture.plainText).toContain("jp_from_cn")
    expect(capture.plainText).not.toContain("encodeb guided")
    expect(capture.plainText).not.toContain("Enter path(s)")
    expect(capture.plainText).not.toContain("Action: find, preview, recover.")
    expect(capture.plainText).not.toContain("Running...")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
