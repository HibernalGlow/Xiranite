/**
 * Gate for ADR-0068's Plugin API contract.
 *
 * Two things are checked mechanically, because both failures are silent otherwise. Host function names
 * must come from the capability vocabulary: five independently written plugin ports invented eight names
 * for five capabilities, which is how an ABI forks. And a manifest without the three version fields
 * cannot express "written against Plugin API 1.x", so a future API bump would break plugins that were
 * actually compatible — the measured state was that no manifest carried any version at all.
 *
 * The manifest is TOML (`docs/plugin-architecture.md` §2.1), which is also the format
 * `crates/xiranite-node-runtime/src/manifest.rs` parses; this gate exists to catch drift against that
 * reader, so it parses the same document rather than a JSON mirror of it.
 */
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { parseAndValidateDefinition } from "./lib/node-definition.ts"

/** Capability namespaces from ADR-0068; each maps to one future WIT interface. */
export const CANONICAL_HOST_FUNCTIONS = [
  "xiranite.fs.read",
  "xiranite.fs.write",
  "xiranite.fs.read_text",
  "xiranite.fs.write_text",
  "xiranite.fs.open",
  "xiranite.fs.close",
  "xiranite.fs.stat",
  "xiranite.fs.list",
  "xiranite.fs.move",
  "xiranite.fs.copy",
  "xiranite.fs.delete",
  "xiranite.fs.ensure_dir",
  "xiranite.fs.set_times",
  "xiranite.operation.checkpoint",
  "xiranite.operation.update",
  "xiranite.operation.emit",
  "xiranite.process.run",
  "xiranite.scheduler.acquire",
  "xiranite.scheduler.release",
  "xiranite.log",
  "xiranite.now",
  "xiranite.path_token.resolve",
] as const

/** Names the plugin ports actually shipped with, mapped to their canonical replacement. */
export const RENAMED_HOST_FUNCTIONS: Record<string, string> = {
  "xiranite.checkpoint": "xiranite.operation.checkpoint",
  "xiranite.emit": "xiranite.operation.emit",
  "xiranite.file.open": "xiranite.fs.open",
  "xiranite.file.read": "xiranite.fs.read_text",
  "xiranite.file.write": "xiranite.fs.write_text",
  "xiranite.file.copy": "xiranite.fs.copy",
  "xiranite.file.move": "xiranite.fs.move",
  "xiranite.file.delete": "xiranite.fs.delete",
  "xiranite.file.stat": "xiranite.fs.stat",
  "xiranite.file.info": "xiranite.fs.stat",
  "xiranite.file.list": "xiranite.fs.list",
  "xiranite.file.list_dir": "xiranite.fs.list",
  "xiranite.file.set": "xiranite.fs.set_times",
  "xiranite.file.set-times": "xiranite.fs.set_times",
  "xiranite.file.setTimes": "xiranite.fs.set_times",
  "xiranite.file.set_times": "xiranite.fs.set_times",
  "xiranite.file.ensure": "xiranite.fs.ensure_dir",
  "xiranite.file.ensureDirectory": "xiranite.fs.ensure_dir",
  "xiranite.file.ensure_dir": "xiranite.fs.ensure_dir",
  "xiranite.file.readText": "xiranite.fs.read_text",
  "xiranite.file.writeText": "xiranite.fs.write_text",
  "xiranite.scheduler.acquire_reserved": "xiranite.scheduler.acquire",
}

/**
 * ADR-0068's three version facts, addressed the way they are spelled in `manifest.toml`. Each is a path
 * because `runtime_version` lives in `[backend]`: it is a fact about the Extism runtime that versioned
 * wasm was measured on, not about the plugin.
 */
const REQUIRED_VERSION_FIELDS = [
  { label: "version (ADR-0068 pluginVersion)", path: ["version"] },
  { label: "backend_api (ADR-0068 pluginApiVersion)", path: ["backend_api"] },
  { label: "backend.runtime_version (ADR-0068 runtimeVersion)", path: ["backend", "runtime_version"] },
] as const
const VERSION_PATTERN = /^\d+\.\d+(\.\d+)?$/

/** Reads a dotted TOML path out of a parsed document. */
function at(document: Record<string, unknown>, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== "object") return undefined
    return (current as Record<string, unknown>)[segment]
  }, document)
}

export interface PluginManifestReport {
  pluginId: string
  problems: string[]
  hostFunctions: string[]
}

export interface AuditOptions {
  pluginsRoot: string
}

export async function auditPluginManifests(options: AuditOptions): Promise<PluginManifestReport[]> {
  const reports: PluginManifestReport[] = []
  const entries = await readdir(options.pluginsRoot, { withFileTypes: true }).catch(() => [])

  for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(options.pluginsRoot, entry.name, "manifest.toml")
    const raw = await readFile(path, "utf8").catch(() => null)
    if (raw === null) {
      reports.push({ pluginId: entry.name, problems: [`no readable manifest.toml at ${path}`], hostFunctions: [] })
      continue
    }

    const problems: string[] = []
    let manifest: Record<string, unknown>
    try {
      manifest = Bun.TOML.parse(raw) as Record<string, unknown>
    } catch (error) {
      reports.push({ pluginId: entry.name, problems: [`manifest.toml is not valid TOML (${error instanceof Error ? error.message : String(error)})`], hostFunctions: [] })
      continue
    }

    for (const field of REQUIRED_VERSION_FIELDS) {
      const value = at(manifest, field.path)
      if (typeof value !== "string") problems.push(`manifest is missing ${field.path.join(".")} (ADR-0068: plugin, plugin-API and runtime versions are three separate facts)`)
      else if (!VERSION_PATTERN.test(value)) problems.push(`${field.path.join(".")} = ${JSON.stringify(value)} is not a dotted numeric version`)
    }
    if (typeof manifest.id !== "string" || manifest.id !== entry.name) problems.push(`id must equal the plugin directory name "${entry.name}"`)
    if (typeof manifest.backend !== "object" || manifest.backend === null) problems.push("manifest has no [backend] section (crates/xiranite-node-runtime reads entry, entry_point and host_functions from it)")

    const declared = Array.isArray(at(manifest, ["backend", "host_functions"]))
      ? (at(manifest, ["backend", "host_functions"]) as unknown[]).filter((name): name is string => typeof name === "string")
      : []
    if (declared.length === 0) problems.push("[backend] host_functions is missing or empty (ADR-0068: the host registers exactly the declared capabilities)")
    if (!declared.includes("xiranite.operation.checkpoint")) {
      problems.push("does not declare xiranite.operation.checkpoint (ADR-0066 requires every run to checkpoint)")
    }
    for (const name of declared) {
      if ((CANONICAL_HOST_FUNCTIONS as readonly string[]).includes(name)) continue
      const replacement = RENAMED_HOST_FUNCTIONS[name]
      problems.push(replacement
        ? `host function "${name}" is superseded by the capability name "${replacement}"`
        : `host function "${name}" is not in the ADR-0068 capability vocabulary`)
    }
    for (const name of Array.isArray(at(manifest, ["backend", "host_functions"])) ? (at(manifest, ["backend", "host_functions"]) as unknown[]) : []) {
      if (typeof name !== "string") problems.push(`host function entry ${JSON.stringify(name)} is not a string`)
    }

    // ADR-0069: the definition is the one vocabulary the three faces read, so a plugin without a valid
    // one is not portable — a face would have to invent field meaning again.
    const definitionFile = typeof manifest.definition_file === "string" ? manifest.definition_file : "definition.json"
    const definitionPath = join(options.pluginsRoot, entry.name, definitionFile)
    const definitionRaw = await readFile(definitionPath, "utf8").catch(() => null)
    if (definitionRaw === null) {
      problems.push(`no ${definitionFile} at ${definitionPath} (ADR-0069: every plugin publishes its node definition)`)
    } else {
      for (const problem of parseAndValidateDefinition(definitionRaw).problems) problems.push(`definition: ${problem}`)
    }

    reports.push({ pluginId: entry.name, problems, hostFunctions: declared })
  }

  return reports
}

if (import.meta.main) {
  const reports = await auditPluginManifests({ pluginsRoot: join(process.cwd(), "plugins") })
  if (reports.length === 0) {
    throw new Error("audit:plugin-manifests scanned plugins/ and found no manifests: an empty scan must not read as a passing gate.")
  }
  const problems = reports.flatMap((report) => report.problems.map((problem) => `${report.pluginId}: ${problem}`))
  for (const report of reports) {
    for (const problem of report.problems) console.error(`FAIL  ${report.pluginId}: ${problem}`)
  }
  if (problems.length === 0) {
    console.log(`OK plugin manifests: ${reports.length} plugin(s) use the capability vocabulary, declare all three versions and publish a valid node definition.`)
  } else {
    throw new Error(`audit:plugin-manifests found ${problems.length} problem(s).`)
  }
}
