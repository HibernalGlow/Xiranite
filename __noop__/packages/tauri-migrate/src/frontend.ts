import { parse, type Edit } from "@ast-grep/napi"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, extname, join, relative, resolve } from "node:path"

import { toNapiLanguage, type MigrationLanguage } from "./languages.js"

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"])
const COPY_EXTENSIONS = new Set([".css", ".json", ".svg"])
const IGNORED_DIRECTORIES = new Set([".git", "dist", "node_modules", "target"])

export interface FrontendPortConfig {
  aliasReplacements?: Record<string, string>
  moduleReplacements?: Record<string, string>
  exclude?: string[]
}

export interface PortTauriFrontendOptions extends FrontendPortConfig {
  sourceRoot: string
  outputDir: string
  force?: boolean
}

export interface FrontendPortFile {
  path: string
  kind: "source" | "asset"
  rewrites: Array<{ from: string; to: string; count: number }>
  tauriImports: string[]
  unresolvedTauriImports: string[]
  unresolvedAliases: string[]
}

export interface FrontendPortManifest {
  schemaVersion: 1
  sourceRoot: string
  outputDir: string
  generatedAt: string
  files: FrontendPortFile[]
  summary: {
    sourceFiles: number
    assetFiles: number
    rewrittenImports: number
    tauriImportFiles: number
    unresolvedTauriImportFiles: number
    unresolvedAliasFiles: number
  }
}

export async function portTauriFrontend(options: PortTauriFrontendOptions): Promise<FrontendPortManifest> {
  const sourceRoot = resolve(options.sourceRoot)
  const outputDir = resolve(options.outputDir)
  if (!(await isDirectory(sourceRoot))) throw new Error(`Frontend source root does not exist: ${sourceRoot}`)
  if (await pathExists(outputDir)) {
    if (!options.force) throw new Error(`Output already exists: ${outputDir}. Pass --force to replace it.`)
    await rm(outputDir, { recursive: true, force: true })
  }

  const sourceFiles = await walk(sourceRoot, options.exclude ?? [])
  const files: FrontendPortFile[] = []
  for (const sourceFile of sourceFiles) {
    const path = relative(sourceRoot, sourceFile).replaceAll("\\", "/")
    const targetFile = join(outputDir, path)
    await mkdir(dirname(targetFile), { recursive: true })
    const extension = extname(sourceFile).toLowerCase()
    if (SOURCE_EXTENSIONS.has(extension)) {
      const result = rewriteFrontendSource(await readFile(sourceFile, "utf8"), extension, options)
      await writeFile(targetFile, result.code, "utf8")
      files.push({ path, kind: "source", rewrites: result.rewrites, tauriImports: result.tauriImports, unresolvedTauriImports: result.unresolvedTauriImports, unresolvedAliases: result.unresolvedAliases })
    } else {
      await writeFile(targetFile, await readFile(sourceFile))
      files.push({ path, kind: "asset", rewrites: [], tauriImports: [], unresolvedTauriImports: [], unresolvedAliases: [] })
    }
  }

  const manifest: FrontendPortManifest = {
    schemaVersion: 1,
    sourceRoot,
    outputDir,
    generatedAt: new Date().toISOString(),
    files,
    summary: {
      sourceFiles: files.filter((file) => file.kind === "source").length,
      assetFiles: files.filter((file) => file.kind === "asset").length,
      rewrittenImports: files.flatMap((file) => file.rewrites).reduce((sum, item) => sum + item.count, 0),
      tauriImportFiles: files.filter((file) => file.tauriImports.length > 0).length,
      unresolvedTauriImportFiles: files.filter((file) => file.unresolvedTauriImports.length > 0).length,
      unresolvedAliasFiles: files.filter((file) => file.unresolvedAliases.length > 0).length,
    },
  }
  await writeFile(join(outputDir, "frontend-port.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  await writeFile(join(outputDir, "REPORT.md"), renderReport(manifest), "utf8")
  return manifest
}

export function rewriteFrontendSource(
  source: string,
  extension: string,
  config: FrontendPortConfig,
): { code: string; rewrites: FrontendPortFile["rewrites"]; tauriImports: string[]; unresolvedTauriImports: string[]; unresolvedAliases: string[] } {
  const language: MigrationLanguage = extension === ".tsx" || extension === ".jsx" ? "tsx" : extension === ".ts" ? "typescript" : "javascript"
  const root = parse(toNapiLanguage(language), source).root()
  const edits: Edit[] = []
  const counts = new Map<string, { from: string; to: string; count: number }>()
  const tauriImports = new Set<string>()
  const unresolvedTauriImports = new Set<string>()
  const unresolvedAliases = new Set<string>()
  const importNodes = [
    ...root.findAll({ rule: { kind: "import_statement" } }),
    ...root.findAll({ rule: { kind: "export_statement" } }),
  ]

  for (const node of importNodes) {
    const sourceNode = node.field("source")
    if (!sourceNode) continue
    const specifier = unquote(sourceNode.text())
    if (!specifier) continue
    if (specifier.startsWith("@tauri-apps/")) tauriImports.add(specifier)
    const replacement = mapSpecifier(specifier, config)
    if (replacement === specifier) {
      if (specifier.startsWith("@tauri-apps/")) unresolvedTauriImports.add(specifier)
      if (specifier.startsWith("~/")) unresolvedAliases.add(specifier)
      continue
    }
    edits.push(sourceNode.replace(quoteLike(sourceNode.text(), replacement)))
    const key = `${specifier}\0${replacement}`
    const previous = counts.get(key)
    counts.set(key, { from: specifier, to: replacement, count: (previous?.count ?? 0) + 1 })
  }

  return {
    code: edits.length ? root.commitEdits(edits) : source,
    rewrites: [...counts.values()].sort((left, right) => left.from.localeCompare(right.from)),
    tauriImports: [...tauriImports].sort(),
    unresolvedTauriImports: [...unresolvedTauriImports].sort(),
    unresolvedAliases: [...unresolvedAliases].sort(),
  }
}

function mapSpecifier(specifier: string, config: FrontendPortConfig): string {
  const exact = config.moduleReplacements?.[specifier]
  if (exact) return exact
  const aliases = Object.entries(config.aliasReplacements ?? {}).sort(([left], [right]) => right.length - left.length)
  for (const [from, to] of aliases) {
    if (specifier.startsWith(from)) return `${to}${specifier.slice(from.length)}`
  }
  return specifier
}

function unquote(value: string): string | null {
  if (value.length < 2 || !["'", '"', "`"].includes(value[0]!) || value.at(-1) !== value[0]) return null
  return value.slice(1, -1)
}

function quoteLike(original: string, value: string): string {
  const quote = original[0] === "'" ? "'" : '"'
  return `${quote}${value.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`)}${quote}`
}

async function walk(root: string, excludes: string[]): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue
    const path = join(root, entry.name)
    const relativePath = relative(root, path).replaceAll("\\", "/")
    if (excludes.some((pattern) => relativePath === pattern || relativePath.startsWith(`${pattern.replace(/\/$/, "")}/`))) continue
    if (entry.isDirectory()) result.push(...await walkNested(path, root, excludes))
    else if (SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase()) || COPY_EXTENSIONS.has(extname(entry.name).toLowerCase())) result.push(path)
  }
  return result.sort()
}

async function walkNested(directory: string, root: string, excludes: string[]): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue
    const path = join(directory, entry.name)
    const relativePath = relative(root, path).replaceAll("\\", "/")
    if (excludes.some((pattern) => relativePath === pattern || relativePath.startsWith(`${pattern.replace(/\/$/, "")}/`))) continue
    if (entry.isDirectory()) result.push(...await walkNested(path, root, excludes))
    else if (SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase()) || COPY_EXTENSIONS.has(extname(entry.name).toLowerCase())) result.push(path)
  }
  return result
}

async function pathExists(path: string): Promise<boolean> { try { await stat(path); return true } catch { return false } }
async function isDirectory(path: string): Promise<boolean> { try { return (await stat(path)).isDirectory() } catch { return false } }

function renderReport(manifest: FrontendPortManifest): string {
  const tauri = manifest.files.filter((file) => file.tauriImports.length)
  const unresolvedTauri = manifest.files.filter((file) => file.unresolvedTauriImports.length)
  const unresolved = manifest.files.filter((file) => file.unresolvedAliases.length)
  return [
    "# Tauri frontend AST port report",
    "",
    `- Source: \`${manifest.sourceRoot}\``,
    `- Source files: ${manifest.summary.sourceFiles}`,
    `- Assets: ${manifest.summary.assetFiles}`,
    `- Import rewrites: ${manifest.summary.rewrittenImports}`,
    `- Files with source Tauri boundaries: ${tauri.length}`,
    `- Files with unmapped Tauri imports: ${unresolvedTauri.length}`,
    `- Files with unresolved source aliases: ${unresolved.length}`,
    "",
    "## Tauri adapter boundary",
    "",
    ...(tauri.length ? tauri.map((file) => `- \`${file.path}\`: ${file.tauriImports.map((item) => `\`${item}\``).join(", ")}`) : ["- None"]),
    "",
    "## Unmapped Tauri imports",
    "",
    ...(unresolvedTauri.length ? unresolvedTauri.map((file) => `- \`${file.path}\`: ${file.unresolvedTauriImports.map((item) => `\`${item}\``).join(", ")}`) : ["- None"]),
    "",
    "## Unresolved aliases",
    "",
    ...(unresolved.length ? unresolved.map((file) => `- \`${file.path}\`: ${file.unresolvedAliases.join(", ")}`) : ["- None"]),
    "",
  ].join("\n")
}
