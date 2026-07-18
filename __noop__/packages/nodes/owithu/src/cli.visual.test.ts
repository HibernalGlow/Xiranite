import { afterEach, describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("owithu guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const capture = await captureCliVisual({
      nodeId: "owithu",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择操作",
    })

    expect(capture.plainText).toContain("Xiranite Owithu")
    expect(capture.plainText).toContain("TOML")
    expect(capture.plainText).toContain("preview")
    expect(capture.plainText).toContain("register")
    expect(capture.plainText).toContain("unregister")
    expect(capture.plainText).toContain("选择操作")
    expect(capture.plainText).not.toContain("owithu guided")
    expect(capture.plainText).not.toContain("Action: preview")
    expect(capture.plainText).not.toContain("Config path.")
    expect(capture.plainText).not.toContain("Entry")
    expect(capture.plainText).not.toContain("Script")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
