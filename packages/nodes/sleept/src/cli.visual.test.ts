import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("sleept Ink UI visual capture", () => {
  test("captures the shared Chinese schema with a Termcn theme", async () => {
    const capture = await captureCliVisual({
      nodeId: "sleept",
      cliPath: CLI_PATH,
      args: ["ui", "--renderer", "ink", "--lang", "zh", "--theme", "dracula"],
      artifactName: "ui-ink-zh-dracula",
      waitForText: "定时模式",
    })

    expect(capture.plainText).toContain("Sleept")
    expect(capture.plainText).toContain("系统定时器")
    expect(capture.plainText).toContain("定时模式")
    expect(capture.plainText).toContain("倒计时")
    expect(capture.plainText).toContain("网络")
    expect(capture.plainText).toContain("CPU")
    expect(capture.plainText).toContain("Ink")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
