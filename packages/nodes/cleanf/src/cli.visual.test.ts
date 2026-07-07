import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("cleanf guided CLI visual capture", () => {
  test("captures the Ink guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "cleanf",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "Enter path(s), separated by semicolon.",
    })

    expect(capture.plainText).toContain("Xiranite Cleanf")
    expect(capture.plainText).toContain("safe cleanup planning")
    expect(capture.plainText).toContain("xcleanf preview --paths <folder> --json")
    expect(capture.plainText).toContain("Enter path(s), separated by semicolon.")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
