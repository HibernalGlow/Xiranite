import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("linku guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "linku",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择 linku 任务",
    })

    expect(capture.plainText).toContain("Xiranite Linku")
    expect(capture.plainText).toContain("软链接管理工具")
    expect(capture.plainText).toContain("选择 linku 任务")
    expect(capture.plainText).toContain("info")
    expect(capture.plainText).toContain("create")
    expect(capture.plainText).toContain("move-link")
    expect(capture.plainText).toContain("list")
    expect(capture.plainText).toContain("recover")
    expect(capture.plainText).not.toContain("Action: info")
    expect(capture.plainText).not.toContain("linku guided")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
