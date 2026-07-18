import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
afterEach(() => { process.exitCode = 0 })

describe("TimeU OpenTUI visual capture", () => {
  test("captures the timestamp ledger layout for GUI comparison", async () => {
    const capture = await captureCliVisual({ nodeId: "timeu", cliPath: CLI_PATH, args: ["ui", "--lang", "zh"], artifactName: "timestamp-ledger", waitForText: "TIMEU // TIMESTAMP LEDGER", columns: 128, rows: 32, viewport: { width: 1024, height: 720 }, timeoutMs: 15_000 })
    expect(capture.plainText).toContain("路径队列")
    expect(capture.plainText).toContain("时间记录总账")
    expect(capture.plainText).toContain("执行时间戳任务")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
