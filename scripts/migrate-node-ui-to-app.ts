#!/usr/bin/env bun
import { access, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as ts from "typescript"

interface NodePackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  name?: string
  peerDependencies?: Record<string, string>
}

interface NodeDefLiteral {
  category: string
  description: string
  icon: string
  id: string
  keywords?: string[]
  name: string
  version: string
}

interface Change {
  action: "delete" | "update" | "create" | "skip"
  detail: string
  file: string
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const nodeId = readArg("--node")
const apply = process.argv.includes("--apply")
const check = process.argv.includes("--check")
const keepPackageComponent = process.argv.includes("--keep-package-component")
const refreshRegistries = process.argv.includes("--refresh-registries")
const stage = process.argv.includes("--stage")

const helpRequested = process.argv.includes("--help") || process.argv.includes("-h")

if (helpRequested || !nodeId) {
  printHelp()
  process.exit(helpRequested ? 0 : 1)
}

const packageRoot = join(repoRoot, "packages", "nodes", nodeId)
const packageJsonPath = join(packageRoot, "package.json")
const packageIndexPath = join(packageRoot, "src", "index.ts")
const packageTsconfigPath = join(packageRoot, "tsconfig.json")
const appNodeRoot = join(repoRoot, "src", "nodes", nodeId)
const appEntryPath = join(appNodeRoot, "entry.ts")
const appComponentPath = join(appNodeRoot, "Component.tsx")
const generatedModulesPath = join(repoRoot, "src", "components", "modules", "packageModules.generated.ts")
const changes: Change[] = []

await assertExists(packageJsonPath, `Unknown node package: ${nodeId}`)

const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as NodePackageJson
if (pkg.name !== `@xiranite/node-${nodeId}`) {
  throw new Error(`Expected package name @xiranite/node-${nodeId}, found ${pkg.name ?? "<missing>"}.`)
}

const def = await readNodeDef(packageIndexPath)
if (def.id !== nodeId) {
  throw new Error(`Expected def.id ${nodeId}, found ${def.id}.`)
}

await updatePackageJson(pkg)
await rewriteHeadlessIndex(def)
await updateTsconfig()
await removePackageReactSurface()
await ensureAppEntry()
if (refreshRegistries) await runRefreshRegistries()

printSummary()
if (check) await runChecks()
if (stage) await stageCurrentNode()

async function updatePackageJson(pkgJson: NodePackageJson): Promise<void> {
  const next: NodePackageJson = JSON.parse(JSON.stringify(pkgJson))
  const before = stableJson(pkgJson)

  for (const section of ["dependencies", "peerDependencies", "devDependencies"] as const) {
    const deps = next[section]
    if (!deps) continue
    for (const name of ["@xiranite/ui", "react", "react-dom", "react-i18next", "lucide-react", "@types/react", "@types/react-dom"]) {
      delete deps[name]
    }
    if (Object.keys(deps).length === 0) delete next[section]
  }

  if (stableJson(next) === before) {
    record("skip", packageJsonPath, "package.json already has no React UI dependencies")
    return
  }

  await writeText(packageJsonPath, stableJson(next))
  record("update", packageJsonPath, "remove React/UI package dependencies")
}

async function rewriteHeadlessIndex(def: NodeDefLiteral): Promise<void> {
  const next = `import type { HeadlessNodePackage, NodeDef } from "@xiranite/contract"
import * as core from "./core.js"

export const def = ${nodeDefLiteral(def)} satisfies NodeDef

const entry = {
  def,
  core,
} satisfies HeadlessNodePackage<typeof core>

export { core }
export * from "./core.js"
export default entry
`
  await writeIfChanged(packageIndexPath, next, "rewrite package entry as headless def + core")
}

async function updateTsconfig(): Promise<void> {
  if (!await exists(packageTsconfigPath)) return
  const raw = await readFile(packageTsconfigPath, "utf8")
  const json = JSON.parse(raw) as Record<string, unknown>
  const compilerOptions = json.compilerOptions as Record<string, unknown> | undefined
  if (!compilerOptions || !("jsx" in compilerOptions)) {
    record("skip", packageTsconfigPath, "tsconfig already has no jsx option")
    return
  }

  delete compilerOptions.jsx
  await writeText(packageTsconfigPath, stableJson(json))
  record("update", packageTsconfigPath, "remove package-side jsx compiler option")
}

async function removePackageReactSurface(): Promise<void> {
  if (keepPackageComponent) {
    record("skip", join(packageRoot, "src", "Component.tsx"), "--keep-package-component was passed")
    return
  }

  for (const file of [
    join(packageRoot, "src", "Component.tsx"),
    join(packageRoot, "src", "Component.test.tsx"),
  ]) {
    await removePath(file, "remove package-side React UI")
  }
  await removePath(join(packageRoot, "src", "demo"), "remove package-side demo shell")
}

async function ensureAppEntry(): Promise<void> {
  if (!await exists(appComponentPath)) {
    record("skip", appEntryPath, `app Component is missing; create ${relative(appComponentPath)} before generating an app entry`)
    return
  }

  const next = `import type { AppNodeEntry } from "@xiranite/contract"
import { core, def } from "@xiranite/node-${nodeId}"
import { Component } from "./Component"

export default {
  def,
  core,
  Component,
} satisfies AppNodeEntry<typeof core>
`
  await writeIfChanged(appEntryPath, next, "ensure app-owned node entry")
}

async function readNodeDef(indexPath: string): Promise<NodeDefLiteral> {
  const sourceText = await readFile(indexPath, "utf8")
  const source = ts.createSourceFile(indexPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let found: NodeDefLiteral | undefined

  function visit(node: ts.Node) {
    if (found) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "def" && node.initializer) {
      const object = objectLiteralFromExpression(node.initializer)
      const parsed = object ? parseNodeDefLiteral(object) : undefined
      if (parsed) found = parsed
    }
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === "def") {
      const object = objectLiteralFromExpression(node.initializer)
      const parsed = object ? parseNodeDefLiteral(object) : undefined
      if (parsed) found = parsed
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  if (!found) throw new Error(`Unable to find def literal in ${relative(indexPath)}.`)
  return found
}

function parseNodeDefLiteral(object: ts.ObjectLiteralExpression): NodeDefLiteral | undefined {
  const strings = new Map<string, string>()
  let keywords: string[] | undefined

  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = propertyName(property.name)
    if (!name) continue

    const value = property.initializer
    if (ts.isStringLiteralLike(value)) {
      strings.set(name, value.text)
    } else if (name === "keywords" && ts.isArrayLiteralExpression(value)) {
      keywords = value.elements.map((element) => ts.isStringLiteralLike(element) ? element.text : undefined)
        .filter((item): item is string => typeof item === "string")
    }
  }

  const required = ["id", "name", "version", "category", "description", "icon"] as const
  if (!required.every((key) => strings.has(key))) return undefined

  return {
    id: strings.get("id")!,
    name: strings.get("name")!,
    version: strings.get("version")!,
    category: strings.get("category")!,
    description: strings.get("description")!,
    icon: strings.get("icon")!,
    ...(keywords?.length ? { keywords } : {}),
  }
}

function objectLiteralFromExpression(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(expression)) return expression
  if (ts.isSatisfiesExpression(expression) || ts.isAsExpression(expression)) return objectLiteralFromExpression(expression.expression)
  if (ts.isParenthesizedExpression(expression)) return objectLiteralFromExpression(expression.expression)
  return undefined
}

async function writeIfChanged(file: string, next: string, detail: string): Promise<void> {
  const current = await readFile(file, "utf8").catch(() => undefined)
  if (current === next) {
    record("skip", file, `${detail}; already current`)
    return
  }
  await writeText(file, next)
  record(current === undefined ? "create" : "update", file, detail)
}

async function writeText(file: string, content: string): Promise<void> {
  if (apply) await writeFile(file, content, "utf8")
}

async function removePath(path: string, detail: string): Promise<void> {
  if (!await exists(path)) {
    record("skip", path, `${detail}; not present`)
    return
  }
  if (apply) await rm(path, { recursive: true, force: true })
  record("delete", path, detail)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function assertExists(path: string, message: string): Promise<void> {
  if (!await exists(path)) throw new Error(message)
}

function record(action: Change["action"], file: string, detail: string): void {
  changes.push({ action, file, detail })
}

function printSummary(): void {
  console.log(apply ? "Applied node UI migration steps." : "Dry run only. Re-run with --apply to write changes.")
  for (const change of changes) {
    console.log(`${change.action.padEnd(6)} ${relative(change.file)} - ${change.detail}`)
  }
  console.log("")
  console.log("Recommended follow-up:")
  if (!refreshRegistries) console.log(`  bun run generate:node-registries`)
  if (!check) {
    console.log(`  bun x vitest run src/nodes/${nodeId}/Component.test.tsx`)
    console.log(`  bun scripts/validate-node-architecture.ts --node ${nodeId}`)
    console.log(`  bun --filter @xiranite/node-${nodeId} test`)
    console.log(`  bun --filter @xiranite/node-${nodeId} build`)
  }
  if (!stage) console.log(`  bun run migrate:node-ui -- --node ${nodeId} --stage`)
}

async function runRefreshRegistries(): Promise<void> {
  if (!apply) {
    record("skip", join(repoRoot, "src", "components", "modules", "packageModules.generated.ts"), "--refresh-registries requires --apply")
    return
  }
  runCommand("refresh generated node registries", ["bun", "run", "generate:node-registries"])
}

async function runChecks(): Promise<void> {
  console.log("")
  console.log(`Running checks for ${nodeId}...`)
  const appComponentTest = join(appNodeRoot, "Component.test.tsx")
  if (await exists(appComponentTest)) {
    runCommand("app Component test", ["bun", "x", "vitest", "run", `src/nodes/${nodeId}/Component.test.tsx`])
  } else {
    console.log(`skip   ${relative(appComponentTest)} - app Component test is missing`)
  }
  runCommand("node architecture validation", ["bun", "scripts/validate-node-architecture.ts", "--node", nodeId])
  runCommand("node package tests", ["bun", "--filter", `@xiranite/node-${nodeId}`, "test"])
  runCommand("node package build", ["bun", "--filter", `@xiranite/node-${nodeId}`, "build"])
}

async function stageCurrentNode(): Promise<void> {
  console.log("")
  console.log(`Staging ${nodeId} migration files...`)
  runCommand("stage node package and app UI", ["git", "add", relative(packageRoot), relative(appNodeRoot)])
  await stageGeneratedLoaderLine()
  runCommand("show staged files", ["git", "diff", "--cached", "--name-status"])
}

async function stageGeneratedLoaderLine(): Promise<void> {
  const generatedRelative = relative(generatedModulesPath)
  const headContent = runCommandCapture("read HEAD generated node registry", ["git", "show", `HEAD:${generatedRelative}`])
  const packageLoader = `  ${nodeId}: () => import("@xiranite/node-${nodeId}") as Promise<{ default: NodeEntry }>,`
  const appLoader = `  ${nodeId}: () => import("@/nodes/${nodeId}/entry") as Promise<{ default: AppNodeEntry }>,`
  const nextContent = headContent.includes(packageLoader)
    ? headContent.replace(packageLoader, appLoader)
    : headContent

  if (!nextContent.includes(appLoader)) {
    throw new Error(`Unable to find a loader entry for ${nodeId} in ${generatedRelative}.`)
  }

  runCommand("unstage full generated node registry", ["git", "reset", "-q", "--", generatedRelative])

  const tempPath = join(tmpdir(), `xiranite-${nodeId}-packageModules.generated.ts`)
  await writeFile(tempPath, nextContent, "utf8")
  const hash = runCommandCapture("hash generated node registry", ["git", "hash-object", "-w", tempPath]).trim()
  runCommand("stage current node loader line", ["git", "update-index", "--cacheinfo", `100644,${hash},${generatedRelative}`])
  await rm(tempPath, { force: true })

  console.log(`staged ${generatedRelative} - loader switched to @/nodes/${nodeId}/entry only`)
}

function runCommand(label: string, cmd: string[]): void {
  console.log("")
  console.log(`> ${cmd.join(" ")}`)
  const result = Bun.spawnSync({
    cmd,
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  })
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${result.exitCode}.`)
  }
}

function runCommandCapture(label: string, cmd: string[]): string {
  const result = Bun.spawnSync({
    cmd,
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim()
    throw new Error(`${label} failed with exit code ${result.exitCode}${stderr ? `: ${stderr}` : "."}`)
  }
  return new TextDecoder().decode(result.stdout)
}

function nodeDefLiteral(def: NodeDefLiteral): string {
  const lines = [
    `  id: ${JSON.stringify(def.id)},`,
    `  name: ${JSON.stringify(def.name)},`,
    `  version: ${JSON.stringify(def.version)},`,
    `  category: ${JSON.stringify(def.category)},`,
    `  description: ${JSON.stringify(def.description)},`,
    `  icon: ${JSON.stringify(def.icon)},`,
  ]
  if (def.keywords?.length) {
    lines.push(`  keywords: [${def.keywords.map((item) => JSON.stringify(item)).join(", ")}],`)
  }
  return `{
${lines.join("\n")}
}`
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function relative(file: string): string {
  return file.startsWith(repoRoot) ? file.slice(repoRoot.length + 1).replace(/\\/g, "/") : file.replace(/\\/g, "/")
}

function printHelp(): void {
  console.log([
    "Usage: bun scripts/migrate-node-ui-to-app.ts --node <node-id> [--apply] [--refresh-registries] [--check] [--stage] [--keep-package-component]",
    "",
    "Automates the mechanical part of moving a node from package-owned React UI to app-owned UI:",
    "- removes React/UI dependencies from packages/nodes/<id>/package.json",
    "- rewrites packages/nodes/<id>/src/index.ts to headless def + core",
    "- removes package-side Component.tsx, Component.test.tsx, and src/demo",
    "- removes package-side jsx compiler option",
    "- creates or refreshes src/nodes/<id>/entry.ts when src/nodes/<id>/Component.tsx exists",
    "- optionally refreshes generated registries with --refresh-registries",
    "- optionally runs the app Component test and package validation with --check",
    "- optionally stages only this node package/app files and this node's generated loader line with --stage",
    "",
    "The script intentionally does not generate the app UI Component. Build that UI deliberately, then run this script.",
    "Dry-run is the default; pass --apply to write changes.",
  ].join("\n"))
}
