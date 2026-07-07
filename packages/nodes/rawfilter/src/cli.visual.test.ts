import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("rawfilter guided CLI visual capture", () => {
  test("captures the Ink guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "rawfilter",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "Directory path.",
    })

    expect(capture.plainText).toContain("Xiranite Rawfilter")
    expect(capture.plainText).toContain("duplicate archive filtering")
    expect(capture.plainText).toContain("xrawfilter plan --path <archive-folder> --json")
    expect(capture.plainText).toContain("Directory path.")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
