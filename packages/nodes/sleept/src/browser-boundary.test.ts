import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

describe("Sleept browser boundary", () => {
  test("desktop interaction code imports only browser-safe cli-runtime subpaths", async () => {
    const component = await readFile(resolve(process.cwd(), "../../../src/nodes/sleept/Component.tsx"), "utf8")
    const interaction = await readFile(resolve(process.cwd(), "src/interaction.ts"), "utf8")
    const i18n = await readFile(resolve(process.cwd(), "src/i18n.ts"), "utf8")

    expect(component).toContain("@xiranite/node-sleept/interaction")
    expect(interaction).toContain("@xiranite/cli-runtime/interaction")
    expect(interaction).toContain("@xiranite/cli-runtime/i18n")
    expect(i18n).toContain("@xiranite/cli-runtime/i18n")

    for (const source of [component, interaction, i18n]) {
      expect(source).not.toContain("@xiranite/cli-runtime/terminal")
      expect(source).not.toContain("@opentui/")
    }
  })

  test("the node root exposes only def and core", async () => {
    const source = await readFile(resolve(process.cwd(), "src/index.ts"), "utf8")

    expect(source).not.toContain('export * from "./i18n.js"')
    expect(source).not.toContain('export * from "./interaction.js"')
    expect(source).not.toContain('export * from "./cli.js"')
  })
})
