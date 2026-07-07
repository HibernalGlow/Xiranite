import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("enginev guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "enginev",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择工坊路径来源",
    })

    expect(capture.plainText).toContain("Xiranite EngineV")
    expect(capture.plainText).toContain("Wallpaper Engine 工坊扫描与批量管理工具")
    expect(capture.plainText).toContain("选择工坊路径来源")
    expect(capture.plainText).toContain("scan")
    expect(capture.plainText).toContain("filter")
    expect(capture.plainText).toContain("rename")
    expect(capture.plainText).toContain("delete")
    expect(capture.plainText).toContain("export")
    expect(capture.plainText).toContain("xenginev scan --path")
    expect(capture.plainText).toContain("--json")
    expect(capture.plainText).not.toContain("Enter path(s)")
    expect(capture.plainText).not.toContain("Entry")
    expect(capture.plainText).not.toContain("Script")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
