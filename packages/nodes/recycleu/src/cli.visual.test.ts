import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"

import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => { process.exitCode = 0 })

describe("recycleu OpenTUI visual capture", () => {
  test("captures the fullscreen Chinese control/monitor/log workbench", async () => {
    const capture = await captureCliVisual({
      nodeId: "recycleu",
      cliPath: CLI_PATH,
      args: ["ui", "--lang", "zh"],
      artifactName: "opentui-workbench",
      waitForText: "RECYCLEU // 回收站控制台",
      columns: 120,
      rows: 34,
      viewport: { width: 1440, height: 820 },
      timeoutMs: 12_000,
    })
    expect(capture.plainText).toContain("清理控制")
    expect(capture.plainText).toContain("循环监控")
    expect(capture.plainText).toContain("日志")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
