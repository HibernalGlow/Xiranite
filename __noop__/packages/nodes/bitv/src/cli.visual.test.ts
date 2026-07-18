import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
afterEach(() => { process.exitCode = 0 })
describe("BitV OpenTUI visual capture", () => {
  test("captures the analysis laboratory for GUI comparison", async () => {
    const capture = await captureCliVisual({ nodeId: "bitv", cliPath: CLI_PATH, args: ["ui", "--lang", "zh"], artifactName: "analysis-lab", waitForText: "BITV // VIDEO ANALYSIS LAB", columns: 128, rows: 32, viewport: { width: 1024, height: 720 }, timeoutMs: 15_000 })
    expect(capture.plainText).toContain("视频来源")
    expect(capture.plainText).toContain("码率分析台")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
