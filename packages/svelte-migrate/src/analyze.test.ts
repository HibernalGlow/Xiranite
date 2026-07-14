import { resolve } from "node:path"
import { parseSync } from "oxc-parser"
import { describe, expect, it } from "vitest"

import { analyzeSvelteFrontend } from "./analyze.js"

const fixture = resolve(import.meta.dirname, "__fixtures__/svelte-project")

describe("analyzeSvelteFrontend", () => {
  it("uses Svelte and TypeScript ASTs to inventory components, stores, graph edges, and Tauri calls", async () => {
    const inventory = await analyzeSvelteFrontend({
      projectRoot: fixture,
      featureMappings: [{ featureId: "reader", sourcePatterns: ["src/App\\.svelte$"] }],
    })

    expect(inventory.summary).toMatchObject({ components: 2, stores: 1, graphEdges: 1, tauriFiles: 1, tauriCalls: 1 })
    expect(inventory.graph.edges).toContainEqual({
      from: "src/App.svelte",
      to: "src/Child.svelte",
      specifier: "./lib/index.js",
      kind: "static",
    })
    expect(inventory.components.find((component) => component.file === "src/App.svelte")).toMatchObject({
      disposition: "manual",
      featureIds: ["reader"],
      runes: ["$state"],
      tauriCalls: [{ api: "invoke", importedFrom: "@tauri-apps/api/core", command: "open_book", line: 6 }],
      templateFeatures: { "element:canvas": 1 },
    })
    expect(inventory.stores[0]).toMatchObject({
      file: "src/lib/stores/reader.svelte.ts",
      exports: ["readerState", "savedPage"],
      primitives: ["$state"],
      storageKeys: ["reader.page"],
    })
    expect(inventory.components.find((component) => component.file === "src/Child.svelte")).toMatchObject({
      props: ["label"],
      featureIds: ["reader"],
      featureMappingSource: "consumer-propagated",
    })
    expect(inventory.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "src/lib/index.ts", kind: "utility" }),
      expect.objectContaining({ file: "src/lib/stores/reader.svelte.ts", kind: "store" }),
    ]))
    expect(inventory.reactScaffolds).toHaveLength(1)
    expect(inventory.reactScaffolds[0]).toMatchObject({
      sourceFile: "src/Child.svelte",
      outputFile: "src/Child.tsx",
      featureIds: ["reader"],
    })
    expect(inventory.reactScaffolds[0]!.content).toContain("export function Child(props: ChildProps)")
    expect(inventory.reactScaffolds[0]!.content).toContain("@migration-status scaffold")
    expect(parseSync("Child.tsx", inventory.reactScaffolds[0]!.content, { lang: "tsx", sourceType: "module", astType: "ts" }).errors).toEqual([])
  })

  it("applies explicit review dispositions after collecting AST evidence", async () => {
    const inventory = await analyzeSvelteFrontend({
      projectRoot: fixture,
      classificationOverrides: [{ pattern: "Child\\.svelte$", disposition: "replaced", reason: "host primitive" }],
    })
    expect(inventory.components.find((component) => component.file.endsWith("Child.svelte"))).toMatchObject({
      disposition: "replaced",
      classificationSource: "config-override",
      classificationReasons: ["host primitive"],
    })
  })
})
