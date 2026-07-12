import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => { process.exitCode = 0 })

describe("kavvka OpenTUI visual capture", () => {
  test("captures the compare path workbench as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({ nodeId: "kavvka", cliPath: CLI_PATH, args: [], artifactName: "compare-path-workbench", waitForText: "KAVVKA // PATH LAB" })
    expect(capture.plainText).toContain("KAVVKA // PATH LAB")
    expect(capture.plainText).toContain("扫描范围")
    expect(capture.plainText).toContain("候选目录")
    expect(capture.plainText).toContain("执行记录")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
