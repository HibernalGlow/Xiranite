import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

describe("gifu browser boundary", () => {
  test("keeps native terminal and media modules outside browser-safe entries", async () => {
    const files = await Promise.all(["core.ts", "interaction.ts", "i18n.ts", "index.ts"].map((file) => readFile(resolve(process.cwd(), "src", file), "utf8")))
    for (const source of files) {
      expect(source).not.toContain("@xiranite/cli-runtime/terminal")
      expect(source).not.toContain("@opentui/")
      expect(source).not.toContain("node:child_process")
    }
  })

  test("keeps the package root limited to def and core", async () => {
    const source = await readFile(resolve(process.cwd(), "src", "index.ts"), "utf8")
    expect(source).not.toContain('export * from "./interaction.js"')
    expect(source).not.toContain('export * from "./i18n.js"')
    expect(source).not.toContain('export * from "./cli.js"')
  })
})
