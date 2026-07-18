import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
afterEach(() => { process.exitCode = 0 })
describe("SoundW OpenTUI visual capture", () => {
  test("captures the recording-route workspace for GUI comparison", async () => {
    const capture = await captureCliVisual({ nodeId: "soundw", cliPath: CLI_PATH, args: ["ui", "--lang", "zh"], artifactName: "recording-route", waitForText: "SOUNDW // RECORDING ROUTE", columns: 132, rows: 32, viewport: { width: 1056, height: 720 }, timeoutMs: 15_000 })
    expect(capture.plainText).toContain("设备矩阵")
    expect(capture.plainText).toContain("预设卡片")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
