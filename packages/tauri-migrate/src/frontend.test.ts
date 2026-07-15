import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import { portTauriFrontend, rewriteFrontendSource } from "./frontend.js"

const temporaryDirectories: string[] = []
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe("Tauri frontend AST port", () => {
  test("rewrites import and re-export module specifiers without touching strings", () => {
    const result = rewriteFrontendSource(`import { invoke } from '@tauri-apps/api/core'\nexport { x } from "~/lib/x"\nconst text = "~/lib/x"\n`, ".ts", {
      aliasReplacements: { "~/": "@/ported/" },
      moduleReplacements: { "@tauri-apps/api/core": "@/ported/adapters/core" },
    })
    expect(result.code).toContain("from '@/ported/adapters/core'")
    expect(result.code).toContain('from "@/ported/lib/x"')
    expect(result.code).toContain('const text = "~/lib/x"')
    expect(result.tauriImports).toEqual(["@tauri-apps/api/core"])
    expect(result.unresolvedTauriImports).toEqual([])
  })

  test("copies a source tree and emits a machine-readable review manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-frontend-port-"))
    temporaryDirectories.push(root)
    const source = join(root, "source")
    const output = join(root, "output")
    await mkdir(join(source, "views"), { recursive: true })
    await writeFile(join(source, "views", "app.tsx"), `import { x } from "~/x"\nexport const App = () => <div>{x}</div>\n`)
    const manifest = await portTauriFrontend({ sourceRoot: source, outputDir: output, aliasReplacements: { "~/": "@/ported/" } })
    expect(manifest.summary).toMatchObject({ sourceFiles: 1, rewrittenImports: 1 })
    expect(await readFile(join(output, "views", "app.tsx"), "utf8")).toContain('from "@/ported/x"')
    expect(JSON.parse(await readFile(join(output, "frontend-port.json"), "utf8"))).toMatchObject({ schemaVersion: 1 })
  })
})
