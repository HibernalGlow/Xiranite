import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("scoolp guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "scoolp",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "xscoolp status --json",
    })

    expect(capture.plainText).toContain("Xiranite Scoolp")
    expect(capture.plainText).toContain("Scoop 状态")
    expect(capture.plainText).toContain("内置 TypeScript guided flow")
    expect(capture.plainText).toContain("status")
    expect(capture.plainText).toContain("cache-list")
    expect(capture.plainText).toContain("xscoolp status --json")
    expect(capture.plainText).not.toContain("scoolp guided")
    expect(capture.plainText).not.toContain("Action: status")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
