import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { BLOCKING_SURFACE, findNodeRemovalSurfaces, listSurfaceFiles, summarizeSurface } from "./node-removal-surface.ts"

let repoRoot = ""

const blockingPaths = (findings: Array<{ category: string; path: string }>) =>
  findings.filter((finding) => BLOCKING_SURFACE.includes(finding.category as never)).map((finding) => `${finding.category}:${finding.path}`).sort()

beforeAll(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "xiranite-surface-"))
  const write = async (path: string, text: string) => {
    await mkdir(join(repoRoot, path.split("/").slice(0, -1).join("/")), { recursive: true })
    await writeFile(join(repoRoot, path), text)
  }

  await write("packages/nodes/gizmo/src/index.ts", 'export const def = { id: "gizmo" }\n')
  await write("src/nodes/gizmo/entry.ts", 'import { core } from "@xiranite/node-gizmo"\nexport default { core }\n')
  await write("package.json", JSON.stringify({ name: "root", dependencies: { "@xiranite/node-gizmo": "workspace:*" } }, null, 2))
  await write("packages/runtime/src/node-runner.generated.ts", 'export const GENERATED_NODE_RUNNER = [\n  { id: "gizmo", packageName: "@xiranite/node-gizmo" },\n]\n')
  await write("src/i18n/locales/en.json", JSON.stringify({ module: { gizmo: { name: "Gizmo" } }, settings: { memoryProtection: { scopes: { default: {}, gizmo: {} } } } }, null, 2))
  await write("packages/shared/src/index.ts", "export const DEFAULTS = {\n  nodePolicies: {\n    gizmo: { maxRssGrowthMiB: 1 },\n  },\n}\n")
  await write("src/components/workspace/GizmoKeepAlive.tsx", 'const entryPath = "@/nodes/gizmo/entry"\nexport const keep = () => entryPath\n')
  await write("packages/services/src/loader.ts", 'export const load = () => platform.loadNodePlatformModule("gizmo")\nexport const scoped = () => service.scoped({ nodeId: "gizmo" })\n')
  await write("packages/nodes/companion/src/core.ts", 'export const def = { id: "companion", keywords: ["gizmo", "image"] }\n')
  await write("src/nodes/companion/entry.ts", 'import { core } from "@xiranite/node-companion"\nexport default { core }\n')
  await write("scripts/gizmo-qa.ts", "export const run = () => 1\n")
  await write("docs/gizmo-design.md", "# Gizmo design\n")
  await write("migration/gizmo/frontend/app.tsx", "export const App = 1\n")
  await write("packages/nodes/gizmo/src/core.test.ts", 'const fixture = "gizmo"\nexport default fixture\n')
})

afterAll(async () => {
  await rm(repoRoot, { recursive: true, force: true })
})

describe("node removal surface", () => {
  test("reports every blocking seam for a node that is still wired in", async () => {
    const surfaces = await findNodeRemovalSurfaces({
      repoRoot,
      ids: ["gizmo"],
      files: await listSurfaceFiles(repoRoot),
    })
    const found = blockingPaths(surfaces.get("gizmo") ?? [])

    expect(found).toContain("node-tree:packages/nodes/gizmo")
    expect(found).toContain("node-tree:src/nodes/gizmo")
    expect(found).toContain("workspace-dependency:package.json")
    expect(found).toContain("generated-registry:packages/runtime/src/node-runner.generated.ts")
    expect(found).toContain("i18n-catalog:src/i18n/locales/en.json")
    expect(found).toContain("coupled-code:packages/shared/src/index.ts")
    expect(found).toContain("core-coupling:src/components/workspace/GizmoKeepAlive.tsx")
    // an id passed as a call argument or object value is wiring even without a registry entry
    expect(found).toContain("core-coupling:packages/services/src/loader.ts")
  })

  test("does not mistake prose or the node's own files for a product coupling", async () => {
    const surfaces = await findNodeRemovalSurfaces({
      repoRoot,
      ids: ["gizmo"],
      files: await listSurfaceFiles(repoRoot),
    })
    const findings = surfaces.get("gizmo") ?? []
    const paths = findings.map((finding) => finding.path)

    // a surviving node that merely names gizmo in its keyword copy is not a wiring seam
    expect(paths).not.toContain("packages/nodes/companion/src/core.ts")
    // the node's own sources are counted as trees, never as couplings
    expect(paths).not.toContain("packages/nodes/gizmo/src/index.ts")
    expect(paths).not.toContain("packages/nodes/gizmo/src/core.test.ts")
    // an archived migration snapshot is documentation debt, not build-graph wiring
    const migration = findings.find((finding) => finding.path === "migration/gizmo")
    expect(migration?.category).toBe("node-doc")
    expect(migration?.detail).toContain("1 migrated-source file")
    expect(summarizeSurface(findings)).toContain("blocking")
  })

  test("reports a clean node with no surface at all", async () => {
    const surfaces = await findNodeRemovalSurfaces({
      repoRoot,
      ids: ["longgone"],
      files: await listSurfaceFiles(repoRoot),
    })
    expect(surfaces.get("longgone")).toEqual([])
    expect(summarizeSurface([])).toBe("0 blocking / 0 total (clean)")
  })

  test("counts a native-binding id separately from node wiring", async () => {
    const surfaces = await findNodeRemovalSurfaces({
      repoRoot,
      ids: ["gizmo"],
      files: await listSurfaceFiles(repoRoot),
    })
    const findings = surfaces.get("gizmo") ?? []
    // scripts named after the node are private tooling debt, not blocking seams
    const script = findings.find((finding) => finding.path === "scripts/gizmo-qa.ts")
    expect(script?.category).toBe("node-script")
    expect(BLOCKING_SURFACE).not.toContain("node-script")
  })
})
