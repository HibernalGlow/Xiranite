import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"
const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
afterEach(() => { process.exitCode = 0 })
describe("CleanF OpenTUI visual capture", () => { test("captures cleanup deck", async () => { const capture = await captureCliVisual({ nodeId: "cleanf", cliPath: CLI_PATH, args: ["ui", "--lang", "zh"], artifactName: "cleanup-deck", waitForText: "CLEANF // CLEANUP DECK", columns: 128, rows: 32, viewport: { width: 1024, height: 720 }, timeoutMs: 15_000 }); expect(capture.plainText).toContain("清理来源"); expect(capture.plainText).toContain("清理预览"); expect(capture.plainText).toContain("预览清理"); await expectCliVisualArtifacts(capture) }, 30_000) })
