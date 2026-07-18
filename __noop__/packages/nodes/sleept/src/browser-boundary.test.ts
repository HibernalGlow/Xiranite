import { readFile } from "node:fs/promises"
import { describe, expect, test } from "vitest"

describe("Sleept browser boundary", () => {
  test("keeps direct TUI and OpenTUI imports out of browser-safe package paths", async () => {
    const [interaction, i18n, index, cli, tui] = await Promise.all([
      readFile(new URL("./interaction.ts", import.meta.url), "utf8"),
      readFile(new URL("./i18n.ts", import.meta.url), "utf8"),
      readFile(new URL("./index.ts", import.meta.url), "utf8"),
      readFile(new URL("./cli.ts", import.meta.url), "utf8"),
      readFile(new URL("./Tui.tsx", import.meta.url), "utf8"),
    ])
    for (const source of [interaction, i18n, index]) {
      expect(source).not.toContain("@xiranite/cli-runtime/terminal")
      expect(source).not.toContain("@opentui/")
    }
    expect(index).not.toContain('export * from "./cli.js"')
    expect(index).not.toContain("./Tui")
    expect(cli).toContain('import("./Tui.js")')
    expect(cli).not.toMatch(/from\s+["']\.\/Tui/)
    expect(tui).toContain("@xiranite/cli-runtime/terminal/opentui")
  })
})
