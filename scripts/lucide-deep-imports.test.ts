import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { collectLucideIconExports, rewriteLucideDeepImports } from "./lucide-deep-imports"

describe("Lucide deep-import transform", () => {
  it("collects canonical and compatibility icon exports from Lucide", async () => {
    const source = await readFile(resolve(import.meta.dir, "../node_modules/lucide-react/dist/esm/lucide-react.js"), "utf8")
    const exports = collectLucideIconExports(source)

    expect(exports.get("RefreshCcw")).toBe("lucide-react/dist/esm/icons/refresh-ccw.js")
    expect(exports.get("CircleHelp")).toBe("lucide-react/dist/esm/icons/circle-question-mark.js")
  })

  it("rewrites value icons to deep imports and preserves type imports", () => {
    const exports = new Map([
      ["AlertTriangle", "lucide-react/dist/esm/icons/triangle-alert.js"],
      ["RefreshCw", "lucide-react/dist/esm/icons/refresh-cw.js"],
    ])
    const source = `import { AlertTriangle, RefreshCw as Refresh, type LucideIcon } from "lucide-react"\n`

    expect(rewriteLucideDeepImports(source, "example.tsx", exports)).toBe(
      `import type { LucideIcon } from "lucide-react"\n`
      + `import AlertTriangle from "lucide-react/dist/esm/icons/triangle-alert.js"\n`
      + `import Refresh from "lucide-react/dist/esm/icons/refresh-cw.js"\n`,
    )
  })

  it("rejects value exports that cannot be mapped to an icon module", () => {
    expect(() => rewriteLucideDeepImports(
      `import { createLucideIcon } from "lucide-react"`,
      "example.ts",
      new Map(),
    )).toThrow("Unknown lucide-react value export")
  })

  it("supports every Lucide import in the application source", async () => {
    const root = resolve(import.meta.dir, "..")
    const lucideSource = await readFile(resolve(root, "node_modules/lucide-react/dist/esm/lucide-react.js"), "utf8")
    const exports = collectLucideIconExports(lucideSource)
    const glob = new Bun.Glob("src/**/*.{ts,tsx}")
    let importFileCount = 0

    for await (const file of glob.scan({ cwd: root, absolute: true, onlyFiles: true })) {
      const source = await readFile(file, "utf8")
      if (!source.includes("lucide-react")) continue
      importFileCount += 1
      expect(() => rewriteLucideDeepImports(source, file, exports)).not.toThrow()
    }

    expect(importFileCount).toBeGreaterThan(300)
  })
})
