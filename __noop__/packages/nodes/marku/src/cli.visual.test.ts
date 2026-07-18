import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("marku guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "marku",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择 marku 模块",
    })

    expect(capture.plainText).toContain("Xiranite Marku")
    expect(capture.plainText).toContain("Markdown 模块工具箱")
    expect(capture.plainText).toContain("选择 marku 模块")
    expect(capture.plainText).toContain("markt")
    expect(capture.plainText).toContain("t2list")
    expect(capture.plainText).not.toContain("Module id.")
    expect(capture.plainText).not.toContain("Entry")
    expect(capture.plainText).not.toContain("Script")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
