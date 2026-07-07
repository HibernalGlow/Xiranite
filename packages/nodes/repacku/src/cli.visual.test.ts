import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("repacku guided CLI visual capture", () => {
  test("captures the rich guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "repacku",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "xrepacku compress --dry-run",
    })

    expect(capture.plainText).toContain("Xiranite Repacku")
    expect(capture.plainText).toContain("内置 TypeScript guided flow")
    expect(capture.plainText).toContain("直接调用 repacku core/platform")
    expect(capture.plainText).toContain("xrepacku compress --dry-run")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
