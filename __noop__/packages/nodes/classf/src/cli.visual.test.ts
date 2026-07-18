import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
afterEach(() => { process.exitCode = 0 })
describe("ClassF OpenTUI visual capture", () => {
  test("captures source list and classification plan", async () => {
    const capture = await captureCliVisual({ nodeId: "classf", cliPath: CLI_PATH, args: ["ui", "--lang", "zh"], artifactName: "transfer-control", waitForText: "CLASSF // TRANSFER CONTROL", columns: 128, rows: 32, viewport: { width: 1024, height: 720 }, timeoutMs: 15_000 })
    expect(capture.plainText).toContain("来源列表")
    expect(capture.plainText).toContain("分类计划")
    expect(capture.plainText).toContain("执行分类")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
