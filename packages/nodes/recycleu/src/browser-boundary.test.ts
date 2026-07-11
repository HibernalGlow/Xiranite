import { readFile } from "node:fs/promises"
import { describe, expect, test } from "vitest"

describe("RecycleU browser boundary", () => {
  test("keeps interaction and translation modules away from terminal-only imports", async () => {
    const [interaction, i18n, index] = await Promise.all([
      readFile(new URL("./interaction.ts", import.meta.url), "utf8"),
      readFile(new URL("./i18n.ts", import.meta.url), "utf8"),
      readFile(new URL("./index.ts", import.meta.url), "utf8"),
    ])
    for (const source of [interaction, i18n, index]) {
      expect(source).not.toContain("@xiranite/cli-runtime/terminal")
      expect(source).not.toContain("@opentui/")
    }
    expect(index).not.toContain('export * from "./cli.js"')
  })
})
