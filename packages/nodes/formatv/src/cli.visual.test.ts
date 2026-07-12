import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"
const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
afterEach(() => { process.exitCode = 0 })
describe("FormatV OpenTUI visual capture", () => { test("captures media format lab", async () => { const capture = await captureCliVisual({ nodeId: "formatv", cliPath: CLI_PATH, args: ["ui", "--lang", "zh"], artifactName: "media-format-lab", waitForText: "FORMATV // MEDIA FORMAT LAB", columns: 128, rows: 32, viewport: { width: 1024, height: 720 }, timeoutMs: 15_000 }); expect(capture.plainText).toContain("视频来源"); expect(capture.plainText).toContain("格式检查"); expect(capture.plainText).toContain("执行检查"); await expectCliVisualArtifacts(capture) }, 30_000) })
