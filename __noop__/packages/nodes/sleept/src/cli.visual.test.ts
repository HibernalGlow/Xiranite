import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, test } from "vitest"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => { process.exitCode = 0 })

describe("Sleept direct OpenTUI visual capture", () => {
  test("captures the GUI-inspired trigger, console and status workbench", async () => {
    const capture = await captureCliVisual({
      nodeId: "sleept",
      cliPath: CLI_PATH,
      args: ["ui", "--renderer", "opentui", "--lang", "zh", "--theme", "dracula"],
      artifactName: "ui-opentui-zh-dracula",
      waitForText: "SLEEPT // SYSTEM TIMER",
      columns: 120,
      rows: 32,
      viewport: { width: 1400, height: 620 },
    })
    expect(capture.plainText).toContain("SLEEPT // SYSTEM TIMER")
    expect(capture.plainText).toContain("COUNTDOWN CONSOLE")
    expect(capture.plainText).toContain("CPU")
    expect(capture.plainText).not.toContain("Step")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
