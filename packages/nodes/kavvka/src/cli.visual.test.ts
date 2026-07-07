import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("kavvka guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "kavvka",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择 kavvka 动作",
    })

    expect(capture.plainText).toContain("Xiranite Kavvka")
    expect(capture.plainText).toContain("Czkawka 包含路径准备工具")
    expect(capture.plainText).toContain("scan 扫描关键词目录")
    expect(capture.plainText).toContain("plan")
    expect(capture.plainText).toContain("process")
    expect(capture.plainText).toContain("选择 kavvka 动作")
    expect(capture.plainText).not.toContain("Action: scan, plan, process.")
    expect(capture.plainText).not.toContain("kavvka guided")
    expect(capture.plainText).not.toContain("Enter path(s)")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
