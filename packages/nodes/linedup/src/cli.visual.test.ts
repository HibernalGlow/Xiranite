import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("linedup guided CLI visual capture", () => {
  test("captures the Ink guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "linedup",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "Enter source file path.",
    })

    expect(capture.plainText).toContain("Xiranite Linedup")
    expect(capture.plainText).toContain("Ink guided flow for source/filter files")
    expect(capture.plainText).toContain("xlinedup filter")
    expect(capture.plainText).toContain("--sourceFile source.txt --filterFile filter.txt")
    expect(capture.plainText).toContain("Enter source file path.")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
