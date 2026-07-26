import { describe, expect, it } from "bun:test"
import { exists } from "node:fs/promises"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import transformImports from "@rolldown/plugin-transform-imports"
import { parseSync } from "oxc-parser"
import { rolldown } from "rolldown"

import { LUCIDE_TRANSFORM_IMPORT_OPTIONS, protectLucideTypeImports } from "./lucide-deep-imports"

describe("Lucide transform-import policy", () => {
  it("protects standalone and mixed type imports", () => {
    const source = `import { AlertTriangle, RefreshCw as Refresh, type LucideIcon } from "lucide-react"\n`
      + `import type { LucideProps } from "lucide-react"\n`

    expect(protectLucideTypeImports(source)).toBe(
      `import type { LucideIcon } from "lucide-react/dist/esm/lucide-react.mjs";\n`
      + `import { AlertTriangle, RefreshCw as Refresh } from "lucide-react";\n`
      + `import type { LucideProps } from "lucide-react/dist/esm/lucide-react.mjs"\n`,
    )
  })

  it("uses the official Rolldown plugin for value deep imports", async () => {
    const source = protectLucideTypeImports(
      `import { AlertTriangle, PictureInPicture2, RefreshCw as Refresh, type LucideIcon } from "lucide-react"\n`
      + `export const icons: LucideIcon[] = [AlertTriangle, PictureInPicture2, Refresh]\n`,
    )!
    const code = await transformLucideSource(source)

    expect(code).toContain("lucide-react/dist/esm/icons/alert-triangle.mjs")
    expect(code).toContain("lucide-react/dist/esm/icons/picture-in-picture-2.mjs")
    expect(code).toContain("lucide-react/dist/esm/icons/refresh-cw.mjs")
    expect(code).not.toContain("lucide-react/dist/esm/lucide-react.mjs")
  })

  it("protects every Lucide type import in the application source", async () => {
    const root = resolve(import.meta.dir, "..")
    const glob = new Bun.Glob("src/**/*.{ts,tsx}")
    let importFileCount = 0
    const valueImports = new Set<string>()

    for await (const file of glob.scan({ cwd: root, absolute: true, onlyFiles: true })) {
      const source = await readFile(file, "utf8")
      if (!source.includes("lucide-react")) continue
      importFileCount += 1
      const protectedSource = protectLucideTypeImports(source) ?? source
      expect(source).not.toMatch(/import\s+(?:\*\s+as\s+[\w$]+|[\w$]+)\s+from\s+["']lucide-react["']/)
      expect(source).not.toMatch(/import\s+["']lucide-react["']/)
      expect(protectedSource).not.toMatch(/import\s+type\s+(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s+["']lucide-react["']/)
      expect(protectedSource).not.toMatch(/import\s*\{[^}]*\btype\s+[^}]*\}\s*from\s*["']lucide-react["']/)
      for (const name of collectLucideValueImports(source, file)) valueImports.add(name)
    }

    expect(importFileCount).toBeGreaterThan(300)
    const names = [...valueImports].sort()
    const aliases = names.map((name, index) => `${name} as Icon${index}`)
    const code = await transformLucideSource(
      `import { ${aliases.join(", ")} } from "lucide-react"\nexport { ${names.map((_, index) => `Icon${index}`).join(", ")} }\n`,
    )
    const deepImports = [...code.matchAll(/["'](lucide-react\/dist\/esm\/icons\/[^"']+)["']/g)]
      .map((match) => match[1]!)

    expect(deepImports).toHaveLength(names.length)
    const missingDeepImports: string[] = []
    for (const modulePath of deepImports) {
      if (!await exists(resolve(root, "node_modules", modulePath))) missingDeepImports.push(modulePath)
    }
    expect(missingDeepImports).toEqual([])
  })
})

async function transformLucideSource(source: string): Promise<string> {
  const bundle = await rolldown({
    input: "virtual:lucide-entry.tsx",
    external: (id) => id.startsWith("lucide-react/"),
    plugins: [
      {
        name: "virtual-lucide-entry",
        resolveId(id) {
          return id === "virtual:lucide-entry.tsx" ? id : null
        },
        load(id) {
          return id === "virtual:lucide-entry.tsx" ? source : null
        },
      },
      transformImports(LUCIDE_TRANSFORM_IMPORT_OPTIONS),
    ],
  })

  try {
    const generated = await bundle.generate({ format: "esm" })
    return generated.output.find((output) => output.type === "chunk")?.code ?? ""
  } finally {
    await bundle.close()
  }
}

function collectLucideValueImports(source: string, filename: string): string[] {
  const lang = filename.endsWith(".tsx") ? "tsx" : "ts"
  const parsed = parseSync(filename, source, {
    lang,
    sourceType: "module",
    astType: "ts",
  })
  return parsed.module.staticImports
    .filter((statement) => statement.moduleRequest.value === "lucide-react")
    .flatMap((statement) => statement.entries)
    .filter((entry) => !entry.isType && entry.importName.kind === "Name" && entry.importName.name)
    .map((entry) => entry.importName.name!)
}
