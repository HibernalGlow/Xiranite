import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
afterEach(() => { process.exitCode = 0 })

describe("RepackU OpenTUI visual capture", () => {
  test("captures the packing workbench for GUI comparison", async () => {
    const capture = await captureCliVisual({
      nodeId: "repacku",
      cliPath: CLI_PATH,
      args: ["ui", "--lang", "zh"],
      artifactName: "packing-workbench",
      waitForText: "REPACKU // PACKING WORKBENCH",
      columns: 128,
      rows: 32,
      viewport: { width: 1024, height: 720 },
      timeoutMs: 15_000,
    })
    expect(capture.plainText).toContain("路径矩阵")
    expect(capture.plainText).toContain("重打包计划")
    expect(capture.plainText).toContain("开始重打包")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
