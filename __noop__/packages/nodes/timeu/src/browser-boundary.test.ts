import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
describe("TimeU browser boundary", () => {
  test("keeps direct OpenTUI isolated from schema and package root", async () => {
    const [interaction, index, cli, tui] = await Promise.all(["interaction.ts", "index.ts", "cli.ts", "Tui.tsx"].map((file) => readFile(resolve(process.cwd(), "src", file), "utf8")))
    expect(interaction).not.toContain("@xiranite/cli-runtime/terminal"); expect(index).not.toContain("./cli"); expect(cli).toContain('import("./Tui.js")'); expect(tui).toContain("@xiranite/cli-runtime/terminal/opentui")
  })
})
