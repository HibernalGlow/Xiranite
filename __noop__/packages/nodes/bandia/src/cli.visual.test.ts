import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("bandia guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "bandia",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择 bandia 操作",
    })

    expect(capture.plainText).toContain("Xiranite Bandia")
    expect(capture.plainText).toContain("批量解压/压缩工具")
    expect(capture.plainText).toContain("选择 bandia 操作")
    expect(capture.plainText).toContain("extract")
    expect(capture.plainText).toContain("compress")
    expect(capture.plainText).toContain("repack")
    expect(capture.plainText).toContain("export-efu")
    expect(capture.plainText).not.toContain("Enter path(s)")
    expect(capture.plainText).not.toContain("Entry")
    expect(capture.plainText).not.toContain("Script")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
