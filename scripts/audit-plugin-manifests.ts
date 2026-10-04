/**
 * Gate for ADR-0066's canonical host-function vocabulary.
 *
 * Each ported plugin declares the host functions it needs in `plugins/<id>/manifest.json`. Five ports
 * written independently invented eight different names for the same five capabilities, which is exactly
 * how a plugin ABI forks, so the vocabulary is checked mechanically instead of reviewed by eye.
 */
import { readFile, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"

const CANONICAL_HOST_FUNCTIONS = [
  "xiranite.checkpoint",
  "xiranite.emit",
  "xiranite.now",
  "xiranite.scheduler.acquire",
  "xiranite.process.run",
  "xiranite.path_token.resolve",
  "xiranite.file.open",
  "xiranite.file.read",
  "xiranite.file.write",
  "xiranite.file.copy",
  "xiranite.file.move",
  "xiranite.file.delete",
  "xiranite.file.stat",
  "xiranite.file.list",
  "xiranite.file.set_times",
  "xiranite.file.ensure_dir",
] as const

/** Measured drift already in the tree, kept visible instead of silently allowed. */
const DRIFT_RENAMES: Record<string, string> = {
  "xiranite.file.info": "xiranite.file.stat",
  "xiranite.file.list_dir": "xiranite.file.list",
  "xiranite.file.set": "xiranite.file.set_times",
  "xiranite.file.ensure": "xiranite.file.ensure_dir",
}

interface ManifestShape {
  hostFunctions?: unknown
}

async function manifestPaths(pluginsRoot: string): Promise<string[]> {
  const entries = await readdir(pluginsRoot, { withFileTypes: true }).catch(() => [])
  const found: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(pluginsRoot, entry.name, "manifest.json")
    if ((await readFile(path, "utf8").catch(() => null)) === null) {
      console.warn(`WARN  ${entry.name}: no readable manifest.json`)
      continue
    }
    found.push(path)
  }
  return found
}

export async function auditPluginManifests(options: { repoRoot: string }): Promise<string[]> {
  const pluginsRoot = join(resolve(options.repoRoot), "plugins")
  const problems: string[] = []

  for (const path of await manifestPaths(pluginsRoot)) {
    const pluginId = path.split("/").at(-2)!
    const raw = await readFile(path, "utf8")
    let manifest: ManifestShape
    try {
      manifest = JSON.parse(raw) as ManifestShape
    } catch (error) {
      problems.push(`${pluginId}: manifest.json is not valid JSON (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    const declared = Array.isArray(manifest.hostFunctions) ? manifest.hostFunctions.filter((name): name is string => typeof name === "string") : []
    if (!declared.includes("xiranite.checkpoint")) problems.push(`${pluginId}: does not declare xiranite.checkpoint (ADR-0066 requires every run to checkpoint)`)
    for (const name of declared) {
      if ((CANONICAL_HOST_FUNCTIONS as readonly string[]).includes(name)) continue
      const replacement = DRIFT_RENAMES[name]
      problems.push(`${pluginId}: host function "${name}" is not in the canonical vocabulary${replacement ? ` (rename to ${replacement})` : ""}`)
    }
  }

  return problems
}

if (import.meta.main) {
  const problems = await auditPluginManifests({ repoRoot: process.cwd() })
  for (const problem of problems) console.error(`FAIL  ${problem}`)
  if (problems.length === 0) console.log("OK plugin manifests use the canonical host-function vocabulary.")
  else throw new Error(`audit:plugin-manifests found ${problems.length} problem(s).`)
}
