import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()

describe("ImageTrimCard migration prototype", () => {
  it("[neoview.image-trim.ast-prototype] freezes the generated structure and keeps it outside production", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "migration/neoview/frontend/tsx-scaffold/manifest.json"), "utf8")) as {
      scaffolds: Array<Record<string, unknown>>
    }
    const entry = manifest.scaffolds.find((component) => component.sourceFile === "src/lib/cards/info/ImageTrimCard.svelte")
    expect(entry).toMatchObject({
      outputFile: "src/lib/cards/info/ImageTrimCard.tsx",
      sourceHash: "sha256:413b50582f039de6e0c563176543242b699c7e1c181322a54130bca578bc06ca",
      migrationStatus: "partial-scaffold",
      sourceDisposition: "manual",
      unsupported: ["Svelte runtime import"],
    })

    const scaffold = await readFile(resolve(root, "migration/neoview/frontend/tsx-scaffold/src/lib/cards/info/ImageTrimCard.tsx"), "utf8")
    expect(scaffold).toContain("RotateCcw, Link, Unlink, Wand2, Minus, Square")
    expect(scaffold).toContain('type="checkbox"')
    expect(scaffold.match(/type="range"/g)).toHaveLength(5)
    expect(scaffold).toContain("settings.enabled ?")
    expect(scaffold).toContain("settings.linkVertical ?")
    expect(scaffold).toContain("settings.linkHorizontal ?")
    expect(scaffold).toContain("settings.autoTrimTarget")
    expect(scaffold).toContain("onMount(() =>")
    expect(scaffold).toContain("onDestroy(() =>")
    expect(scaffold).toContain("$state<ImageTrimSettings | null>")
    expect(scaffold).toContain("$derived(")

    const production = await readFile(resolve(root, "src/nodes/neoview/features/panels/cards/ImageTrimCard.tsx"), "utf8")
    expect(production).not.toContain("migration/neoview/frontend/tsx-scaffold")
    expect(production).not.toContain("$lib/")
  })
})
