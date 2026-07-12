import { afterEach, describe, expect, test } from "vitest"
import { resolve } from "node:path"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = resolve(process.cwd(), "src", "cli.ts")
afterEach(() => { process.exitCode = 0 })
describe("Xlchemy OpenTUI visual capture", () => {
  test("captures the input, format, and result workbench", async () => {
    const capture = await captureCliVisual({ nodeId: "xlchemy", cliPath: CLI_PATH, args: ["ui", "--lang", "zh"], artifactName: "image-transcode", waitForText: "XLCHEMY // IMAGE TRANSCODE", columns: 136, rows: 36, viewport: { width: 1100, height: 760 }, timeoutMs: 15_000 })
    expect(capture.plainText).toContain("输入队列")
    expect(capture.plainText).toContain("输入与转换")
    expect(capture.plainText).toContain("批次结果")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
