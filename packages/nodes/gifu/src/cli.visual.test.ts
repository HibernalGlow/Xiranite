import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
afterEach(() => { process.exitCode = 0 })

describe("Gifu OpenTUI visual capture", () => {
  test("captures the sequence-lab layout for GUI comparison", async () => {
    const capture = await captureCliVisual({ nodeId: "gifu", cliPath: CLI_PATH, args: ["ui", "--lang", "zh"], artifactName: "sequence-lab", waitForText: "GIFU // SEQUENCE LAB", columns: 128, rows: 32, viewport: { width: 1024, height: 720 }, timeoutMs: 15_000 })
    expect(capture.plainText).toContain("输入源")
    expect(capture.plainText).toContain("序列预览")
    expect(capture.plainText).toContain("开始动画编译")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
