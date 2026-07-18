import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("seriex guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "seriex",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择路径输入方式",
    })

    expect(capture.plainText).toContain("Xiranite Seriex")
    expect(capture.plainText).toContain("漫画压缩包系列提取工具")
    expect(capture.plainText).toContain("支持剪贴板/手动输入路径")
    expect(capture.plainText).toContain("先生成计划树")
    expect(capture.plainText).toContain("xseriex plan --path <folder> --json")
    expect(capture.plainText).toContain("选择路径输入方式")
    expect(capture.plainText).toContain("从剪贴板读取路径")
    expect(capture.plainText).toContain("手动输入路径")
    expect(capture.plainText).toContain("使用当前目录")
    expect(capture.plainText).not.toContain("Enter path(s)")
    expect(capture.plainText).not.toContain("Entry")
    expect(capture.plainText).not.toContain("Script")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
