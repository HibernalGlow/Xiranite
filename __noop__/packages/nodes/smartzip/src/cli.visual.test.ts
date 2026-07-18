import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => { process.exitCode = 0 })

describe("SmartZip OpenTUI visual capture", () => {
  test("captures the path queue and operation chamber for GUI comparison", async () => {
    const capture = await captureCliVisual({ nodeId: "smartzip", cliPath: CLI_PATH, args: ["ui", "--lang", "zh"], artifactName: "operation-chamber", waitForText: "SMARTZIP // OPERATION CHAMBER", columns: 128, rows: 32, viewport: { width: 1024, height: 720 }, timeoutMs: 15_000 })
    expect(capture.plainText).toContain("路径队列")
    expect(capture.plainText).toContain("Operation chamber")
    expect(capture.plainText).toContain("运行 SmartZip")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
