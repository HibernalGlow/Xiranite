import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("sleept guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "sleept",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择定时模式",
    })

    expect(capture.plainText).toContain("Xiranite Sleept")
    expect(capture.plainText).toContain("系统定时器")
    expect(capture.plainText).toContain("选择定时模式")
    expect(capture.plainText).toContain("倒计时")
    expect(capture.plainText).toContain("定时")
    expect(capture.plainText).toContain("网速")
    expect(capture.plainText).toContain("CPU")
    expect(capture.plainText).not.toContain("Choose mode")
    expect(capture.plainText).not.toContain("Ink")
    expect(capture.plainText).not.toContain("Press q to exit")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
