// Discovers everything that still references one node id, so a manifest disposition cannot claim a
// removal that has not actually happened. Categories are split because only the build-graph ones can
// break a tree; a surviving test fixture or prose mention is debt, not breakage.
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join, relative } from "node:path"

export type SurfaceCategory =
  | "node-tree"
  | "workspace-dependency"
  | "generated-registry"
  | "i18n-catalog"
  | "node-script"
  | "node-doc"
  | "coupled-code"
  | "string-fixture"

export interface SurfaceFinding {
  category: SurfaceCategory
  path: string
  detail: string
}

/** Findings in these categories mean the node is still wired into the product build graph. */
export const BLOCKING_SURFACE: SurfaceCategory[] = [
  "node-tree",
  "workspace-dependency",
  "generated-registry",
  "i18n-catalog",
  "coupled-code",
]

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".workbuddy",
  "artifacts",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "output",
  "target",
  "vendor",
])

const GENERATED_REGISTRIES = new Set([
  "packages/runtime/src/node-runner.generated.ts",
  "src/components/modules/packageModules.generated.ts",
  "packages/cli/src/node-cli-registry.generated.ts",
  "external_node_launch_registry.generated.go",
])

const COUPLED_CODE_FILES = new Set([
  "packages/shared/src/index.ts",
  "packages/backend/src/nodeRunner.ts",
  "src/components/views/settings/NodeMemoryProtectionSettings.tsx",
  "src/components/views/settings/settingsNavigation.ts",
  "src/index.css",
])

const TEXT_EXTENSION = /(\.ts|\.tsx|\.js|\.mjs|\.go|\.css|\.json|\.toml|\.md)$/
const TEST_FILE = /(\.test\.|\.spec\.)/

export interface NodeSurfaceOptions {
  repoRoot: string
  id: string
  /** Pre-walked absolute file list; several ids are usually audited in one run. */
  files?: string[]
}

export function listSurfaceFiles(repoRoot: string): Promise<string[]> {
  return walk(repoRoot)
}

export async function findNodeRemovalSurface({ repoRoot, id, files }: NodeSurfaceOptions): Promise<SurfaceFinding[]> {
  return (await findNodeRemovalSurfaces({ repoRoot, ids: [id], files })).get(id) ?? []
}

/**
 * Scans several ids in one repository pass. Reading every text file once per id makes the gate crawl
 * on a repository this size, and the result is identical because each id is evaluated independently.
 */
export async function findNodeRemovalSurfaces(
  options: NodeSurfaceOptions & { ids: string[]; files?: string[] },
): Promise<Map<string, SurfaceFinding[]>> {
  const { repoRoot, ids } = options
  const findings = new Map<string, SurfaceFinding[]>(ids.map((id) => [id, []]))
  const auditedTrees = ids.flatMap((id) => [`packages/nodes/${id}`, `src/nodes/${id}`])

  for (const id of ids) {
    for (const tree of [`packages/nodes/${id}`, `src/nodes/${id}`]) {
      const root = join(repoRoot, tree)
      if (await isDirectory(root)) {
        findings.get(id)!.push({ category: "node-tree", path: tree, detail: `${await countFiles(root)} file(s) present` })
      }
    }
  }

  const migrationCounts = new Map<string, number>()
  for (const file of options.files ?? (await walk(repoRoot))) {
    const shown = relative(repoRoot, file).split("\\").join("/")
    if (auditedTrees.some((tree) => shown.startsWith(`${tree}/`))) continue
    const text = await readFileOrEmpty(file)
    for (const id of ids) evaluateFileText(findings.get(id)!, migrationCounts, shown, text, id)
  }

  for (const [id, count] of migrationCounts) {
    if (count > 0) {
      findings.get(id)?.push({
        category: "node-doc",
        path: `migration/${id}`,
        detail: `${count} migrated-source file(s) still carried in the repository`,
      })
    }
  }

  for (const list of findings.values()) {
    list.sort((left, right) => left.category.localeCompare(right.category) || left.path.localeCompare(right.path))
  }
  return findings
}

function evaluateFileText(
  findings: SurfaceFinding[],
  migrationCounts: Map<string, number>,
  shown: string,
  text: string,
  id: string,
): void {
  const declared = shown.endsWith("package.json") ? declaredNodeDependency(text, id) : null
  if (declared) findings.push({ category: "workspace-dependency", path: shown, detail: declared })

  if (GENERATED_REGISTRIES.has(shown) && referencesId(text, id)) {
    findings.push({ category: "generated-registry", path: shown, detail: "still lists the node id" })
  }

  if (shown.startsWith("src/i18n/locales/")) {
    const blocks = i18nCatalogBlocks(text, id)
    if (blocks.length) findings.push({ category: "i18n-catalog", path: shown, detail: blocks.join(", ") })
  }

  if (shown.startsWith("scripts/") && basename(shown).includes(id)) {
    findings.push({ category: "node-script", path: shown, detail: "node-private tooling" })
  }

  if (shown.startsWith(`migration/${id}/`)) migrationCounts.set(id, (migrationCounts.get(id) ?? 0) + 1)
  if (shown.startsWith("docs/") && !shown.startsWith("docs/adr/")) {
    const name = basename(shown)
    if (name.startsWith(`${id}-`) || name === `${id}.md`) {
      findings.push({ category: "node-doc", path: shown, detail: "node-specific documentation" })
    }
  }

  if (COUPLED_CODE_FILES.has(shown)) {
    const needle = coupledNeedle(text, id)
    if (needle) findings.push({ category: "coupled-code", path: shown, detail: needle })
  }

  if (TEST_FILE.test(shown) && new RegExp(`["'\`]${id}["'\`]`).test(text)) {
    findings.push({ category: "string-fixture", path: shown, detail: "uses the id as a test fixture" })
  }
}

export function summarizeSurface(findings: SurfaceFinding[]): string {
  const blocking = findings.filter((finding) => BLOCKING_SURFACE.includes(finding.category))
  const byCategory = new Map<string, number>()
  for (const finding of findings) byCategory.set(finding.category, (byCategory.get(finding.category) ?? 0) + 1)
  const parts = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, count]) => `${category}=${count}`)
  return `${blocking.length} blocking / ${findings.length} total (${parts.join(", ") || "clean"})`
}

function declaredNodeDependency(text: string, id: string): string | null {
  const specifier = `@xiranite/node-${id}`
  if (!text.includes(specifier)) return null
  try {
    const manifest = JSON.parse(text) as Record<string, Record<string, string> | undefined>
    for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      if (manifest[field]?.[specifier]) return `${field}: ${specifier}`
    }
  } catch {
    return null
  }
  return null
}

/** Registry membership is matched by entry shape, not by the bare name: prose and keyword arrays
 * legitimately mention other node names (kavvka's copy describes the standalone czkawka-tauri tool). */
function referencesId(text: string, id: string): boolean {
  return new RegExp(`\\bid: "${id}"|@xiranite/node-${id}\\b|/nodes/${id}\\b`).test(text)
}

function i18nCatalogBlocks(text: string, id: string): string[] {
  let catalog: Record<string, unknown>
  try {
    catalog = JSON.parse(text) as Record<string, unknown>
  } catch {
    return []
  }
  const blocks: string[] = []
  const modules = catalog.module as Record<string, unknown> | undefined
  if (modules && id in modules) blocks.push(`module.${id} (${Object.keys(modules[id] as object).length} keys)`)
  const scopes = ((catalog.settings as Record<string, unknown> | undefined)?.memoryProtection as Record<string, unknown> | undefined)?.scopes as Record<string, unknown> | undefined
  if (scopes && id in scopes) blocks.push(`settings.memoryProtection.scopes.${id}`)
  return blocks
}

function coupledNeedle(text: string, id: string): string | null {
  const patterns: Array<[RegExp, string]> = [
    [new RegExp(`^\\s*"?${id}"?:\\s*\\{`, "m"), "per-node policy preset"],
    [new RegExp(`XIRANITE_${id.toUpperCase()}_`), "per-node memory-protection env override"],
    [new RegExp(`"${id}"`), "hardcoded settings scope or search keyword"],
    [new RegExp(`\\.${id}-`), "node-specific stylesheet classes"],
  ]
  for (const [pattern, label] of patterns) if (pattern.test(text)) return label
  return null
}

async function walk(root: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) result.push(...(await walk(path)))
    } else if (entry.isFile() && TEXT_EXTENSION.test(entry.name)) {
      result.push(path)
    }
  }
  return result
}

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return ""
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function countFiles(root: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) total += await countFiles(join(root, entry.name))
    } else if (entry.isFile()) {
      total += 1
    }
  }
  return total
}
