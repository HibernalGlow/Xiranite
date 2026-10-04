import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import { analyzeNodePackages } from "./node-feasibility.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

interface NodeFixture {
  id: string
  source: string
  dependencies?: Record<string, string>
  guiEntry?: boolean
  /** Extra files under `src/`, used to prove the CLI/TUI surface is excluded from the plugin tier. */
  extraFiles?: Record<string, string>
}

async function createRepo(nodes: NodeFixture[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-feasibility-"))
  temporaryDirectories.push(root)

  for (const node of nodes) {
    const src = join(root, "packages", "nodes", node.id, "src")
    await mkdir(src, { recursive: true })
    await writeFile(join(src, "index.ts"), node.source, "utf8")
    for (const [name, content] of Object.entries(node.extraFiles ?? {})) {
      await writeFile(join(src, name), content, "utf8")
    }
    await writeFile(
      join(root, "packages", "nodes", node.id, "package.json"),
      `${JSON.stringify({ name: `@xiranite/node-${node.id}`, exports: { ".": "./dist/index.js", "./cli": "./dist/cli.js" }, dependencies: node.dependencies ?? {} }, null, 2)}\n`,
      "utf8",
    )
    if (node.guiEntry) {
      const ui = join(root, "src", "nodes", node.id)
      await mkdir(ui, { recursive: true })
      await writeFile(join(ui, "entry.ts"), "export default {}\n", "utf8")
    }
  }
  return root
}

describe("node WASM feasibility AST audit", () => {
  test("classifies nodes into the ADR-0063 tiers by their real dependencies", async () => {
    const root = await createRepo([
      { id: "purecalc", source: "import { createHash } from \"node:crypto\"\nimport { z } from \"zod\"\nimport { compute } from \"./core.js\"\nexport const def = { id: \"purecalc\" }\nexport { compute }\n" },
      { id: "filemove", source: "import { readFile } from \"node:fs/promises\"\nexport const run = (path: string) => readFile(path, \"utf8\")\n" },
      { id: "shellthing", source: "import { spawn } from \"node:child_process\"\nexport const run = () => spawn(\"true\", [])\n" },
      { id: "imager", source: "import sharp from \"sharp\"\nexport const run = () => sharp(\"x\")\n" },
      { id: "mystery", source: "import { thing } from \"some-unclassified-package\"\nexport const run = () => thing()\n" },
      { id: "binding", source: "export const run = () => 1\n", dependencies: { "@xiranite/widget-native": "workspace:*" } },
    ])

    const report = await analyzeNodePackages({ repoRoot: root })

    expect(report.schemaVersion).toBe(1)
    expect(report.generator.name).toBe("@xiranite/tauri-migrate")
    expect(report.nodes.map((node) => node.id)).toEqual([
      "binding",
      "filemove",
      "imager",
      "mystery",
      "purecalc",
      "shellthing",
    ])
    expect(report.summary).toEqual({
      "wasm-plugin": 1,
      "wasm-with-host-io": 2,
      "rust-host": 1,
      "blocked-native": 1,
      "manual-review": 1,
    })

    const byId = new Map(report.nodes.map((node) => [node.id, node]))
    expect(byId.get("purecalc")?.hasGuiEntry).toBe(false)
    expect(byId.get("binding")?.nativeBindings).toEqual(["@xiranite/widget-native"])
    expect(byId.get("mystery")?.unclassifiedSpecifiers).toContain("some-unclassified-package")
    expect(byId.get("imager")?.reasons[0]).toContain("sharp")
    // Spawning is a host function call, not a reason to keep the node out of WASM.
    expect(byId.get("shellthing")?.feasibility).toBe("wasm-with-host-io")
    expect(byId.get("shellthing")?.reasons.join(" ")).toContain("node:child_process")
  })

  test("records import evidence with file and line, including dynamic imports", async () => {
    const root = await createRepo([
      {
        id: "lazyio",
        guiEntry: true,
        source: "import { join } from \"node:path\"\nexport async function run(dir: string) {\n  const fs = await import(\"node:fs/promises\")\n  return [dir, join(dir), await fs.readFile(\"x\")]\n}\n",
      },
    ])

    const report = await analyzeNodePackages({ repoRoot: root })
    const node = report.nodes[0]!

    expect(node.feasibility).toBe("wasm-with-host-io")
    expect(node.hasGuiEntry).toBe(true)
    expect(node.hasCli).toBe(true)
    const dynamic = node.evidence.find((item) => item.specifier === "node:fs/promises")
    expect(dynamic?.dynamic).toBe(true)
    expect(dynamic?.file).toBe("packages/nodes/lazyio/src/index.ts")
    expect(dynamic?.line).toBe(3)
  })

  test("sees a /node subpath as host IO and ignores the deleted CLI surface", async () => {
    const root = await createRepo([
      { id: "bareinfra", source: "import { z } from \"@xiranite/contract\"\nimport { fmt } from \"@xiranite/logging\"\nexport const run = () => fmt(1)\nexport { z }\n" },
      { id: "subpathio", source: "import { readLogDirectory } from \"@xiranite/logging/node\"\nexport const run = () => readLogDirectory()\n" },
      {
        id: "cliquiet",
        source: "export const run = () => 1\n",
        extraFiles: { "cli.ts": "import { spawn } from \"node:child_process\"\nexport const cli = () => spawn(\"true\", [])\n", "Tui.tsx": "import { readFile } from \"node:fs/promises\"\nexport const Tui = () => readFile(\"x\")\n" },
      },
    ])

    const report = await analyzeNodePackages({ repoRoot: root })
    const byId = new Map(report.nodes.map((node) => [node.id, node]))

    expect(byId.get("bareinfra")?.feasibility).toBe("wasm-plugin")
    expect(byId.get("bareinfra")?.infrastructureSpecifiers).toEqual(["@xiranite/contract", "@xiranite/logging"])
    expect(byId.get("subpathio")?.feasibility).toBe("wasm-with-host-io")
    expect(byId.get("subpathio")?.reasons.join(" ")).toContain("@xiranite/logging/node")
    // cli.ts and Tui.tsx are the surfaces ADR-0063 deletes, so their imports must not decide the tier.
    expect(byId.get("cliquiet")?.feasibility).toBe("wasm-plugin")
    expect(byId.get("cliquiet")?.pluginSurfaceFiles).toBe(1)
  })

  test("honours extra blocked-native and rust-host markers from the CLI", async () => {
    const root = await createRepo([
      { id: "gpu", source: "import { render } from \"@some/gpu-pipeline\"\nexport const run = () => render()\n" },
    ])

    const baseline = await analyzeNodePackages({ repoRoot: root })
    expect(baseline.nodes[0]?.feasibility).toBe("manual-review")

    const marked = await analyzeNodePackages({ repoRoot: root, blockedNative: ["@some/gpu-pipeline"] })
    expect(marked.nodes[0]?.feasibility).toBe("blocked-native")
    expect(marked.nodes[0]?.reasons[0]).toContain("@some/gpu-pipeline")
  })

  test("fails loudly when there is nothing to audit", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-feasibility-empty-"))
    temporaryDirectories.push(root)
    await expect(analyzeNodePackages({ repoRoot: root })).rejects.toThrow(/No node packages found/)
  })

  test("restricts to requested node ids", async () => {
    const root = await createRepo([
      { id: "one", source: "export const a = 1\n" },
      { id: "two", source: "export const b = 2\n" },
    ])

    const report = await analyzeNodePackages({ repoRoot: root, nodeIds: ["two"] })
    expect(report.nodes.map((node) => node.id)).toEqual(["two"])
  })
})
