import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("findz guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "findz",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择 findz 动作",
    })

    expect(capture.plainText).toContain("Xiranite Findz")
    expect(capture.plainText).toContain("SQL")
    expect(capture.plainText).toContain("压缩包")
    expect(capture.plainText).toContain("选择 findz 动作")
    expect(capture.plainText).toContain("search")
    expect(capture.plainText).toContain("archives-only")
    expect(capture.plainText).toContain("refine")
    expect(capture.plainText).not.toContain("findz guided")
    expect(capture.plainText).not.toContain("Search path.")
    expect(capture.plainText).not.toContain("WHERE filter")
    expect(capture.plainText).not.toContain("Running...")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
