#!/usr/bin/env bun
/**
 * Gate for the QuickJS node-bundle build (`scripts/build-node-bundles.ts`, ADR-0074).
 *
 * The build-time premise of the whole migration is stated in `docs/migration/quickjs-substrate-evaluation.md`
 * §11.1 and §13: a node's **core** closure is the platform-free half — measured zero `node:` imports across all
 * 44 cores — and `platform.ts` is the known Node face that becomes host capability. This gate enforces that
 * premise against the *produced bundles*, not against a doc or a directory listing (AGENTS.md: "门禁必须检查实际
 * 构建参数与真实注册表"). It compares three sets it reads from disk, the way `scripts/audit-node-registry.ts`
 * compares membership/registration/decision sets:
 *
 *   A  the registered nodes the runtime will load (`packages/runtime/src/node-runner.generated.ts`, parsed —
 *      never hand-maintained), filtered to the `retain-rewrite` disposition in the target manifest;
 *   B  the nodes with a bundle in `artifacts/node-bundles/manifest.json`;
 *   C  the node directories that carry a `core.ts` on disk.
 *
 * FAIL (blocks, non-strict): a `retain-rewrite` node has no core bundle; the manifest's `run` export is absent
 * from the core bundle, or `createRuntime` from the platform bundle; a **core** bundle still imports a `node:`
 * builtin that has no shim mapping; a **core** bundle reaches a Node global outside the explicit allowlist; an
 * empty scan. WARN (promoted to FAIL only by `--strict`): a `hold-unmigrated` node's debt; a **platform**
 * bundle's unmapped builtins (the known host-migration surface, not yet fully shimmed). This split is deliberate
 * — a gate that is red for platform debt nobody has ported yet gets switched off, exactly the reasoning in
 * `audit-node-registry.ts:14-16`.
 *
 * Conventions copied from `scripts/audit-node-registry.ts`: comment-stripping so a doc example cannot count as
 * evidence, `WARN`/`FAIL` lines, `--strict`, and a positive control that a scan which found nothing must fail.
 *
 * Usage: bun scripts/audit-node-bundles.ts [--strict] [--bundles-dir <dir> --manifest <file>
 * --generated-table <file> --nodes-dir <dir>]
 */
import { readFile, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

import { BARE_BUILTINS, SHIMMED_BUILTINS } from "../packages/quickjs-shims/src/surface.ts"

const repoRoot = resolve(dirname(import.meta.path), "..")

const defaultPaths = {
  bundlesDir: join(repoRoot, "artifacts", "node-bundles"),
  manifest: join(repoRoot, "artifacts", "node-bundles", "manifest.json"),
  generatedTable: join(repoRoot, "packages", "runtime", "src", "node-runner.generated.ts"),
  nodesDir: join(repoRoot, "packages", "nodes"),
  targetManifest: join(repoRoot, "docs", "xiranite-target-node-manifest.json"),
}

/** `retain-rewrite` means the node must end up loadable in the host; other dispositions owe no bundle now. */
const RETAIN_DISPOSITION = "retain-rewrite"
const HOLD_DISPOSITION = "hold-unmigrated"

/**
 * Known structural blockers, with the reason written into the entry. Each `exempt` token disables exactly the
 * arm the blocker would otherwise trip; nothing else about the node is waved through.
 */
export interface AllowlistEntry {
  id: string
  reason: string
  exempt: AllowlistArm[]
}
export type AllowlistArm = "core-bundle-missing" | "core-global" | "core-unmapped-builtin" | "run-export" | "create-runtime-export"

export const DEFAULT_ALLOWLIST: AllowlistEntry[] = [
  {
    id: "findz",
    reason: "its node core spawns a Go worker (worker-client.ts:12 `new Worker(new URL('./findz-worker.js', import.meta.url))`) and reads import.meta.url; ADR-0074 §13.1. Replacing the worker with a host service is unstarted, so its core reaching a Node global is a known blocker, not a regression.",
    exempt: ["core-global", "core-unmapped-builtin"],
  },
]

/** A bare or `node:`-prefixed specifier that names a Node builtin, not a package. */
const NODE_BUILTIN_NAMES = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram",
  "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring", "readline", "repl", "stream", "string_decoder",
  "sys", "timers", "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
])

/** The bare specifiers the shim set maps (so `fs`/`path`/... count as mapped; `node:worker_threads` does not). */
const MAPPED_BUILTIN_SET = new Set<string>([
  ...Object.keys(SHIMMED_BUILTINS),
  ...Object.keys(BARE_BUILTINS),
  "node:process",
  "node:buffer",
  "process",
  "buffer",
])

function isBuiltinSpecifier(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true
  const head = specifier.split("/")[0]!
  return head !== undefined && NODE_BUILTIN_NAMES.has(head) && !specifier.includes("/")
}

function isMappedBuiltin(specifier: string): boolean {
  return MAPPED_BUILTIN_SET.has(specifier) || (specifier.startsWith("node:") && MAPPED_BUILTIN_SET.has(specifier.slice("node:".length)))
}

/** The unmapped node: / bare builtin specifiers a bundle still imports. */
export function unmappedBuiltinSpecifiers(externals: string[]): string[] {
  return externals.filter((specifier) => isBuiltinSpecifier(specifier) && !isMappedBuiltin(specifier)).sort()
}

interface BundleArtifact {
  path?: string | null
  bytes?: number
  ok?: boolean
  error?: string | null
  unresolvedExternals?: string[]
}

interface ManifestNode {
  id: string
  disposition?: string
  run?: string | null
  createRuntime?: string | null
  core?: BundleArtifact | null
  platform?: BundleArtifact | null
}

interface BundleManifest {
  nodes: Record<string, ManifestNode>
  counts?: Record<string, unknown>
}

interface AuditOptions {
  bundlesDir?: string
  manifestPath?: string
  generatedTablePath?: string
  nodesDir?: string
  targetManifestPath?: string
  allowlist?: AllowlistEntry[]
  strict?: boolean
}

export interface BundleAuditReport {
  retainedIds: string[]
  builtIds: string[]
  onDiskIds: string[]
  scannedCoreBundles: number
  errors: string[]
  warnings: string[]
}

const FORBIDDEN_CORE_GLOBAL_PATTERNS: ReadonlyArray<readonly [label: string, pattern: RegExp]> = [
  ["process.", /\bprocess\s*\./],
  ["Buffer", /\bBuffer\s*[.([]/],
  ["__dirname", /\b__dirname\b/],
  ["require(", /\brequire\s*\(/],
  ["import.meta", /\bimport\.meta\b/],
]

/**
 * Strips line comments so a doc example cannot read as evidence (the `audit-node-registry.ts:156-175` rule),
 * then reports which forbidden Node globals survive in the *code*. Bundled ESM never carries a leading `//`
 * comment block, but esbuild keeps banner comments and any string is left intact; the matcher keys on the same
 * shapes §13 scanned (`process.`, `Buffer[.(]`, `__dirname`, `require(`, `import.meta`).
 */
export function forbiddenGlobalsInSource(source: string): string[] {
  const code = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*|\/\/\/)/.test(line))
    .join("\n")
  const found: string[] = []
  for (const [label, pattern] of FORBIDDEN_CORE_GLOBAL_PATTERNS) {
    if (pattern.test(code)) found.push(label)
  }
  return found
}

/** The named export bindings an ESM bundle exposes, from its `export { a, b as c }` blocks. */
export function bundleExportNames(source: string): Set<string> {
  const names = new Set<string>()
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const token of (block[1] ?? "").split(",")) {
      const trimmed = token.trim()
      if (trimmed.length === 0) continue
      const exported = trimmed.split(/\s+as\s+/).pop()!.trim()
      if (exported.length > 0) names.add(exported)
    }
  }
  return names
}

/** Parse the generated runner table for the node ids it registers (source of truth, never a hand list). */
export function parseGeneratedNodeIds(text: string): string[] {
  const body = text.slice(text.indexOf("generatedNodeSpecs"))
  const ids: string[] = []
  for (const match of body.matchAll(/^  ([a-z][a-z0-9_]*): \{/gm)) ids.push(match[1]!)
  return [...new Set(ids)].sort()
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function readDispositions(path: string): Promise<Map<string, string>> {
  const text = await readText(path)
  if (text === null) return new Map()
  try {
    const manifest = JSON.parse(text) as { nodes: Array<{ id: string; disposition: string }> }
    return new Map(manifest.nodes.map((node) => [node.id, node.disposition]))
  } catch {
    return new Map()
  }
}

export async function auditNodeBundles(options: AuditOptions = {}): Promise<BundleAuditReport> {
  const paths = {
    bundlesDir: options.bundlesDir ?? defaultPaths.bundlesDir,
    manifestPath: options.manifestPath ?? defaultPaths.manifest,
    generatedTablePath: options.generatedTablePath ?? defaultPaths.generatedTable,
    nodesDir: options.nodesDir ?? defaultPaths.nodesDir,
    targetManifestPath: options.targetManifestPath ?? defaultPaths.targetManifest,
  }
  const allowlist = options.allowlist ?? DEFAULT_ALLOWLIST
  const exempt = (id: string, arm: AllowlistArm): boolean =>
    allowlist.some((entry) => entry.id === id && entry.exempt.includes(arm))

  const [manifestText, tableText, dispositions] = await Promise.all([
    readText(paths.manifestPath),
    readText(paths.generatedTablePath),
    readDispositions(paths.targetManifestPath),
  ])

  const errors: string[] = []
  const warnings: string[] = []

  if (manifestText === null) {
    errors.push(`no bundle manifest at ${paths.manifestPath} — run 'bun run build:node-bundles' first; a missing manifest must not read as a passing gate.`)
    return { retainedIds: [], builtIds: [], onDiskIds: [], scannedCoreBundles: 0, errors, warnings }
  }
  const manifest = JSON.parse(manifestText) as BundleManifest

  const registered = tableText === null ? [] : parseGeneratedNodeIds(tableText)
  if (registered.length === 0) {
    errors.push(`parsed zero node ids from ${paths.generatedTablePath}; an empty registered set must not read as a passing gate.`)
  }

  // Set A: registered AND retain-rewrite. A hold-unmigrated node that happens to be registered (kisaki) is debt
  // (WARN), not a hard requirement, matching audit-node-registry's pending-port rule.
  const retainedIds = registered.filter((id) => (dispositions.get(id) ?? RETAIN_DISPOSITION) === RETAIN_DISPOSITION).sort()
  const holdIds = [...dispositions.entries()].filter(([, disposition]) => disposition === HOLD_DISPOSITION).map(([id]) => id).sort()

  const builtIds = Object.keys(manifest.nodes).sort()
  const onDiskIds = await listOnDiskCoreIds(paths.nodesDir)

  // Set differences that are structural, not per-node.
  for (const id of retainedIds) {
    const record = manifest.nodes[id]
    if (record === undefined || !record.core || !record.core.ok) {
      const reason = record?.core?.error ?? record?.bundleError ?? "no bundle in the manifest"
      const message = `${id}: retained node has no core bundle (${reason})`
      if (exempt(id, "core-bundle-missing")) warnings.push(`ALLOW ${message} — ${allowlist.find((entry) => entry.id === id)?.reason ?? "allowlisted"}`)
      else errors.push(`FAIL ${message}`)
    }
  }
  // A node the runtime registers but the manifest never built and that is not on disk is a drift, not debt.
  for (const id of registered) {
    if (!builtIds.includes(id)) {
      const message = `${id}: registered in node-runner.generated.ts but absent from the bundle manifest`
      if (exempt(id, "core-bundle-missing")) warnings.push(`ALLOW ${message}`)
      else if ((dispositions.get(id) ?? RETAIN_DISPOSITION) === HOLD_DISPOSITION) warnings.push(`WARN ${message} (hold-unmigrated)`)
      else errors.push(`FAIL ${message}`)
    }
  }

  let scannedCoreBundles = 0

  for (const [id, record] of Object.entries(manifest.nodes)) {
    const isRetained = retainedIds.includes(id)
    const isHold = holdIds.includes(id)
    const severity = isRetained ? "FAIL" : "WARN"
    const core = record.core

    if (core && core.ok && core.path) {
      scannedCoreBundles += 1
      const source = await readText(join(paths.bundlesDir, basename(core.path)))
      if (source === null) {
        const message = `${id}: manifest lists core bundle at ${core.path} but the file is not on disk`
        pushOrWarn(errors, warnings, severity, isHold, message)
        continue
      }

      // Arm: core imports an unmapped node: builtin.
      const unmapped = unmappedBuiltinSpecifiers(core.unresolvedExternals ?? [])
      if (unmapped.length > 0) {
        const message = `${id}: core bundle imports node: builtin(s) with no shim mapping: ${unmapped.join(" ")}`
        if (exempt(id, "core-unmapped-builtin")) warnings.push(`ALLOW ${message} — ${allowlist.find((entry) => entry.id === id)?.reason ?? "allowlisted"}`)
        else if (isHold) warnings.push(`WARN ${message}`)
        else errors.push(`${severity} ${message}`)
      }

      // Arm: core reaches a forbidden Node global outside the allowlist.
      const globals = forbiddenGlobalsInSource(source)
      if (globals.length > 0) {
        const message = `${id}: core closure reaches a Node global outside the allowlist: ${globals.join(" ")}`
        if (exempt(id, "core-global")) warnings.push(`ALLOW ${message} — ${allowlist.find((entry) => entry.id === id)?.reason ?? "allowlisted"}`)
        else if (isHold) warnings.push(`WARN ${message}`)
        else errors.push(`${severity} ${message}`)
      }

      // Arm: the manifest's run export is present in the core bundle.
      if (record.run) {
        const exportsPresent = bundleExportNames(source)
        if (!exportsPresent.has(record.run)) {
          const message = `${id}: manifest run export "${record.run}" is absent from ${core.path}`
          if (exempt(id, "run-export")) warnings.push(`ALLOW ${message}`)
          else if (isHold) warnings.push(`WARN ${message}`)
          else errors.push(`${severity} ${message}`)
        }
      }
    }

    // Platform face: createRuntime export + unmapped builtins as WARN (host-migration surface).
    const platform = record.platform
    if (platform && platform.ok && platform.path) {
      const source = await readText(join(paths.bundlesDir, basename(platform.path)))
      if (source === null) {
        pushOrWarn(errors, warnings, severity, isHold, `${id}: manifest lists platform bundle at ${platform.path} but the file is not on disk`)
        continue
      }
      if (record.createRuntime) {
        const exportsPresent = bundleExportNames(source)
        if (!exportsPresent.has(record.createRuntime)) {
          const message = `${id}: manifest createRuntime export "${record.createRuntime}" is absent from ${platform.path}`
          if (exempt(id, "create-runtime-export")) warnings.push(`ALLOW ${message}`)
          else if (isHold) warnings.push(`WARN ${message}`)
          else errors.push(`${severity} ${message}`)
        }
      }
      const platformUnmapped = unmappedBuiltinSpecifiers(platform.unresolvedExternals ?? [])
      if (platformUnmapped.length > 0) {
        warnings.push(`WARN ${id}: platform bundle reaches unmapped node: builtin(s) (host-migration surface, not yet shimmed): ${platformUnmapped.join(" ")}`)
      }
    }
  }

  // A node on disk that the runtime never registered is unstarted work; WARN unless strict.
  for (const id of onDiskIds) {
    if (!registered.includes(id)) warnings.push(`WARN ${id}: a core.ts exists on disk but the node is not in node-runner.generated.ts (not registered)`)
  }

  // Positive control (audit-node-registry.ts:304-311): a scan that found nothing must fail, never pass.
  if (scannedCoreBundles === 0) {
    errors.push(`audit:node-bundles scanned ${builtIds.length} manifest entries and opened zero readable core bundles: an empty scan must not read as a passing gate.`)
  }

  if (options.strict) {
    for (const warning of warnings) {
      if (warning.startsWith("WARN ")) errors.push(`FAIL ${warning.slice("WARN ".length)}`)
    }
  }

  return { retainedIds, builtIds, onDiskIds, scannedCoreBundles, errors, warnings }
}

function pushOrWarn(errors: string[], warnings: string[], severity: string, isHold: boolean, message: string): void {
  if (isHold) warnings.push(`WARN ${message}`)
  else errors.push(`${severity} ${message}`)
}

async function listOnDiskCoreIds(nodesDir: string): Promise<string[]> {
  const ids: string[] = []
  for (const entry of await Bun.$`ls -1 ${nodesDir}`.text().then((text) => text.split("\n")).catch(() => [] as string[])) {
    const id = entry.trim()
    if (id.length === 0 || id.startsWith(".")) continue
    if (await fileExists(join(nodesDir, id, "src", "core.ts"))) ids.push(id)
  }
  return ids.sort()
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const strict = argv.includes("--strict")
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const options: AuditOptions = {
    strict,
    ...(flag("bundles-dir") ? { bundlesDir: resolve(flag("bundles-dir")!) } : {}),
    ...(flag("manifest") ? { manifestPath: resolve(flag("manifest")!) } : {}),
    ...(flag("generated-table") ? { generatedTablePath: resolve(flag("generated-table")!) } : {}),
    ...(flag("nodes-dir") ? { nodesDir: resolve(flag("nodes-dir")!) } : {}),
    ...(flag("target-manifest") ? { targetManifestPath: resolve(flag("target-manifest")!) } : {}),
  }

  const report = await auditNodeBundles(options)
  for (const warning of report.warnings) console.warn(warning)
  for (const error of report.errors) console.error(error)

  if (report.errors.length > 0) {
    throw new Error(`audit:node-bundles found ${report.errors.length} failure(s) and ${report.warnings.length} warning(s) (${strict ? "strict" : "non-strict"}).`)
  }

  console.log(
    `OK node bundles: ${report.retainedIds.length} retained node(s) required, ${report.builtIds.length} bundle record(s), ` +
      `${report.scannedCoreBundles} core bundle(s) scanned clean (allowlist: ${DEFAULT_ALLOWLIST.map((entry) => entry.id).join(", ")}), ` +
      `${report.onDiskIds.length} core(s) on disk, ${report.warnings.filter((line) => line.startsWith("WARN")).length} warning(s)${strict ? "" : " (non-strict)"}.`,
  )
}

if (import.meta.main) {
  await main()
}
