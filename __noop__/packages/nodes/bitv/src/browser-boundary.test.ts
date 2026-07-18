import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

describe("BitV browser boundary", () => {
  test("interaction and i18n use only browser-safe cli-runtime subpaths", async () => {
    const interaction = await readFile(resolve(process.cwd(), "src/interaction.ts"), "utf8")
    const i18n = await readFile(resolve(process.cwd(), "src/i18n.ts"), "utf8")

    expect(interaction).toContain("@xiranite/cli-runtime/interaction")
    expect(interaction).toContain("@xiranite/cli-runtime/i18n")
    expect(i18n).toContain("@xiranite/cli-runtime/i18n")
    for (const source of [interaction, i18n]) {
      expect(source).not.toContain("@xiranite/cli-runtime/terminal")
      expect(source).not.toContain("@opentui/")
    }
  })

  test("the package root exposes only def and core", async () => {
    const source = await readFile(resolve(process.cwd(), "src/index.ts"), "utf8")

    expect(source).not.toContain('export * from "./i18n.js"')
    expect(source).not.toContain('export * from "./interaction.js"')
    expect(source).not.toContain('export * from "./cli.js"')
    expect(source).not.toContain('export * from "./platform.js"')
  })
})
