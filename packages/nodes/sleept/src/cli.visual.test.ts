import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, test } from "vitest"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("sleept OpenTUI visual capture", () => {
  test("captures the OpenTUI-native fullscreen control plane", async () => {
    const capture = await captureCliVisual({
      nodeId: "sleept",
      cliPath: CLI_PATH,
      args: ["ui", "--renderer", "opentui", "--lang", "zh", "--theme", "dracula"],
      artifactName: "ui-opentui-zh-dracula",
      waitForText: "触发序列",
      columns: 120,
      rows: 32,
      viewport: { width: 1400, height: 620 },
    })

    expect(capture.plainText).toContain("SLEEPT // NATIVE CONTROL PLANE")
    expect(capture.plainText).toContain("OpenTUI")
    expect(capture.plainText).toContain("触发序列")
    expect(capture.plainText).toContain("系统待命")
    expect(capture.plainText).toContain("执行动作")
    expect(capture.plainText).not.toContain("步骤")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
