#!/usr/bin/env bun
import { readdir, readFile, stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parseSync } from "oxc-parser"
import type { Node, Program } from "@oxc-project/types"

interface Finding {
  file: string
  line: number
  label: string
  text: string
}

interface SourceFile {
  file: string
  content: string
  program: Program
  lineStarts: number[]
}

const ROOT = resolve(process.argv.includes("--root") ? requireValue("--root") : process.cwd())
const NODE_FILTER = process.argv.includes("--node") ? requireValue("--node") : null

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp()
  process.exit(0)
}

async function main() {
  const findings: Finding[] = []

  await collectContractFindings(resolve(ROOT, "packages/contract/src/index.ts"), findings)

  const nodeDirs = await listNodeDirs(resolve(ROOT, "packages", "nodes"))
  for (const nodeDir of nodeDirs) {
    if (NODE_FILTER && nodeDir.name !== NODE_FILTER) continue

    const componentPath = join(nodeDir.path, "src", "Component.tsx")
    const hasComponent = await readTextIfExists(componentPath) !== null

    if (hasComponent) {
      await collectComponentFindings(componentPath, findings)
      await collectRequiredUiImport(componentPath, findings)
    } else {
      await collectHeadlessPackageFindings(join(nodeDir.path, "package.json"), findings)
      await collectHeadlessIndexFindings(join(nodeDir.path, "src", "index.ts"), findings)
      if (await pathExists(join(nodeDir.path, "src", "demo"))) {
        findings.push({
          file: join(nodeDir.path, "src", "demo"),
          line: 1,
          label: "headless node package must not keep React demo shells",
          text: "remove src/demo after moving UI into the app surface",
        })
      }
    }

    await collectIndexFindings(join(nodeDir.path, "src", "index.ts"), findings)
    await collectPackageFindings(join(nodeDir.path, "package.json"), findings)
    await collectCliFindings(join(nodeDir.path, "src", "cli.ts"), findings)
    await collectCoreFindings(join(nodeDir.path, "src", "core.ts"), findings)
    if (nodeDir.name === "neoview") await collectNeoViewLayerFindings(nodeDir.path, findings)
  }

  if (findings.length) {
    for (const finding of findings) {
      console.error(`${relative(finding.file)}:${finding.line}: ${finding.label}`)
      console.error(`  ${finding.text}`)
    }
    console.error("")
    console.error(`Architecture validation failed: ${findings.length} finding(s).`)
    process.exitCode = 1
    return
  }

  console.log("Architecture validation passed.")
}

async function collectContractFindings(file: string, findings: Finding[]): Promise<void> {
  const source = await parseSourceIfExists(file)
  if (!source) return

  visitAst(source, (node) => {
    if (isIdentifier(node, "NodeCardSchema") || isIdentifier(node, "NodeCardProps")) {
      addNodeFinding(source, node, "contract must not expose card schemas", nodeText(source, node), findings)
    }
    if (isPropertyKey(node, "card")) {
      addNodeFinding(source, node, "contract must not expose card schemas", nodeText(source, node), findings)
    }
    if (isIdentifier(node, "NodeRunnerApi") || isMemberExpression(node, "host", "runNode")) {
      addNodeFinding(source, node, "contract must not expose backend runners", nodeText(source, node), findings)
    }
    if (isCallExpression(node, "runNode") || isPropertyKey(node, "runNode")) {
      addNodeFinding(source, node, "contract must not expose backend runners", nodeText(source, node), findings)
    }
    if (isIdentifier(node, "CliHost") || isIdentifier(node, "CliCommand")) {
      addNodeFinding(source, node, "contract must not expose CLI host APIs", nodeText(source, node), findings)
    }
  })
}

async function collectComponentFindings(file: string, findings: Finding[]): Promise<void> {
  const source = await parseSourceIfExists(file)
  if (!source) return

  for (const importNode of importDeclarations(source)) {
    const specifier = importSource(importNode)
    if (!specifier) continue
    if (specifier.startsWith("@/")) {
      addNodeFinding(source, importNode, "Component must not import Xiranite app internals", specifier, findings)
    }
    if (specifier === "./demo" || specifier.includes("/demo")) {
      addNodeFinding(source, importNode, "Component must not import or render CardShell", specifier, findings)
    }
  }

  visitAst(source, (node) => {
    if (
      isMemberExpression(node, "host", "runNode")
      || isMemberExpression(node, "host", "runner")
      || isPropertyKey(node, "runner")
      || isIdentifier(node, "createUnavailableNodeRunner")
      || isIdentifier(node, "ComponentNodeRunner")
      || isVariableDeclaratorId(node, "runNode")
      || isAwaitedCall(node, "runNode")
    ) {
      addNodeFinding(source, node, "Component must not call or name host runners", nodeText(source, node), findings)
    }
    if (isFunctionNamed(node, "Panel") || isVariableDeclaratorId(node, "Panel") || isJsxElementNamed(node, "Panel")) {
      addNodeFinding(source, node, "Component must not define or render local Panel shells", nodeText(source, node), findings)
    }
    if (isIdentifier(node, "CardShell") || isJsxElementNamed(node, "CardShell")) {
      addNodeFinding(source, node, "Component must not import or render CardShell", nodeText(source, node), findings)
    }
  })

  collectTextPatternFindings(source, /min-h-\[3\d\dpx\]/g, "Component must not hard-code card min heights", findings)
  collectTextPatternFindings(source, /grid-cols-\[/g, "Component must not hard-code arbitrary grid columns", findings)
}

async function collectRequiredUiImport(file: string, findings: Finding[]): Promise<void> {
  const source = await parseSourceIfExists(file)
  if (!source) return

  const hasUiImport = importDeclarations(source).some((node) => importSource(node) === "@xiranite/ui")
  if (!hasUiImport) {
    findings.push({
      file,
      line: 1,
      label: "legacy package Component must use @xiranite/ui shared content primitives",
      text: "missing required shared UI import",
    })
  }
}

async function collectHeadlessPackageFindings(file: string, findings: Finding[]): Promise<void> {
  const parsed = await parseJsonIfExists(file)
  if (!parsed) return

  const deps = dependencyNames(parsed.value)
  collectForbiddenPackageDependency(parsed, deps, "react", "headless node package must not depend on React", findings)
  collectForbiddenPackageDependency(parsed, deps, "react-dom", "headless node package must not depend on React", findings)
  collectForbiddenPackageDependency(parsed, deps, "react-i18next", "headless node package must not depend on React", findings)
  collectForbiddenPackageDependency(parsed, deps, "@types/react", "headless node package must not depend on React", findings)
  collectForbiddenPackageDependency(parsed, deps, "lucide-react", "headless node package must not depend on lucide-react", findings)
  collectForbiddenPackageDependency(parsed, deps, "@xiranite/ui", "headless node package must not depend on @xiranite/ui", findings)
}

async function collectHeadlessIndexFindings(file: string, findings: Finding[]): Promise<void> {
  const source = await parseSourceIfExists(file)
  if (!source) return

  for (const importNode of importDeclarations(source)) {
    if (importSource(importNode)?.includes("./Component")) {
      addNodeFinding(source, importNode, "headless index must not export or import Component", nodeText(source, importNode), findings)
    }
  }
  for (const exportNode of exportDeclarations(source)) {
    if (importSource(exportNode)?.includes("./Component")) {
      addNodeFinding(source, exportNode, "headless index must not export or import Component", nodeText(source, exportNode), findings)
    }
  }
  visitAst(source, (node) => {
    if (isIdentifier(node, "Component")) {
      addNodeFinding(source, node, "headless index must not export or import Component", nodeText(source, node), findings)
    }
  })
}

async function collectIndexFindings(file: string, findings: Finding[]): Promise<void> {
  const source = await parseSourceIfExists(file)
  if (!source) return

  for (const statement of [...importDeclarations(source), ...exportDeclarations(source)]) {
    const specifier = importSource(statement)
    if (!specifier) continue
    if (specifier === "./demo" || specifier.includes("/demo")) {
      addNodeFinding(source, statement, "index must not export demo shells", specifier, findings)
    }
    if (specifier === "./cli" || specifier === "./platform" || specifier.includes("/platform")) {
      addNodeFinding(source, statement, "index must not export CLI or platform adapters", specifier, findings)
    }
  }

  visitAst(source, (node) => {
    if (isIdentifier(node, "CardShell")) {
      addNodeFinding(source, node, "index must not export demo shells", nodeText(source, node), findings)
    }
    if (isPropertyKey(node, "cli") || isPropertyKey(node, "platform")) {
      addNodeFinding(source, node, "index must not export CLI or platform adapters", nodeText(source, node), findings)
    }
  })
}

async function collectPackageFindings(file: string, findings: Finding[]): Promise<void> {
  const parsed = await parseJsonIfExists(file)
  if (!parsed) return

  const exportsText = JSON.stringify((parsed.value as { exports?: unknown }).exports ?? {})
  if (/"\.\/demo|CardShell|src\/demo|dist\/demo|demo\/CardShell/.test(exportsText)) {
    findings.push({
      file,
      line: lineForText(parsed.content, "demo") ?? 1,
      label: "package exports must not expose demo shells",
      text: "package exports expose demo/CardShell paths",
    })
  }
}

async function collectCliFindings(file: string, findings: Finding[]): Promise<void> {
  const source = await parseSourceIfExists(file)
  if (!source) return

  for (const importNode of importDeclarations(source)) {
    const specifier = importSource(importNode)
    if (!specifier) continue
    if (specifier.includes("./Component") || specifier === "@xiranite/ui") {
      addNodeFinding(source, importNode, "CLI must not import package React UI", specifier, findings)
    }
    if (specifier.startsWith("@/")) {
      addNodeFinding(source, importNode, "CLI must not import Xiranite app internals", specifier, findings)
    }
  }
}

async function collectCoreFindings(file: string, findings: Finding[]): Promise<void> {
  const source = await parseSourceIfExists(file)
  if (!source) return

  for (const importNode of importDeclarations(source)) {
    const specifier = importSource(importNode)
    if (!specifier) continue
    if (specifier === "react" || specifier === "ink" || specifier === "@xiranite/ui") {
      addNodeFinding(source, importNode, "core must not import React, Ink, or Xiranite UI", specifier, findings)
    }
    if (specifier.startsWith("@/")) {
      addNodeFinding(source, importNode, "core must not import Xiranite app internals", specifier, findings)
    }
    if (
      specifier.startsWith("node:")
      || specifier === "fs"
      || specifier.startsWith("fs/")
      || specifier === "child_process"
    ) {
      addNodeFinding(source, importNode, "core must not directly use Node/Bun platform APIs", specifier, findings)
    }
  }

  visitAst(source, (node) => {
    if (isMemberExpression(node, "Bun") || isMemberExpression(node, "process")) {
      addNodeFinding(source, node, "core must not directly use Node/Bun platform APIs", nodeText(source, node), findings)
    }
  })
}

async function collectNeoViewLayerFindings(nodeDir: string, findings: Finding[]): Promise<void> {
  const sourceRoot = join(nodeDir, "src")
  const allowedRootFiles = new Set(["index.ts", "core.ts", "platform.ts", "cli.ts", "Tui.tsx", "help.ts"])
  const sourceFiles = await listSourceFiles(sourceRoot)

  for (const file of sourceFiles) {
    const source = await parseSourceIfExists(file)
    if (!source) continue
    const localPath = file.slice(sourceRoot.length + 1).replace(/\\/g, "/")
    if (!localPath.includes("/") && !allowedRootFiles.has(localPath)) {
      findings.push({
        file,
        line: 1,
        label: "NeoView heavy node implementation must not remain flat",
        text: `${localPath} must move under domain/application/ports/platform/testing`,
      })
    }

    for (const statement of [...importDeclarations(source), ...exportDeclarations(source)]) {
      const specifier = importSource(statement)
      if (!specifier) continue
      const normalized = specifier.replace(/\\/g, "/")
      const isTestingDependency = /(?:^|\/)testing(?:\/|$|\.[cm]?[jt]sx?$)/.test(normalized)
      if (!localPath.startsWith("testing/") && isTestingDependency) {
        addNodeFinding(source, statement, "NeoView production code must not depend on testing", specifier, findings)
      }
      if (localPath.startsWith("domain/") && isForbiddenLayer(normalized, ["application", "ports", "platform", "testing"])) {
        addNodeFinding(source, statement, "NeoView domain must remain platform and use-case independent", specifier, findings)
      }
      if (localPath.startsWith("application/") && isForbiddenLayer(normalized, ["platform", "testing"])) {
        addNodeFinding(source, statement, "NeoView application must depend on ports instead of implementations", specifier, findings)
      }
      if (localPath.startsWith("ports/") && isForbiddenLayer(normalized, ["application", "platform", "testing"])) {
        addNodeFinding(source, statement, "NeoView ports must not depend on application or implementations", specifier, findings)
      }
      if (localPath === "core.ts" && isForbiddenLayer(normalized, ["platform", "testing"])) {
        addNodeFinding(source, statement, "NeoView core facade must not expose platform or testing implementations", specifier, findings)
      }
    }
  }

  const packageFile = join(nodeDir, "package.json")
  const parsed = await parseJsonIfExists(packageFile)
  if (!parsed) return
  const exports = (parsed.value as { exports?: Record<string, unknown> }).exports ?? {}
  const allowedExports = new Set([".", "./core", "./platform", "./testing"])
  for (const name of Object.keys(exports)) {
    if (!allowedExports.has(name)) {
      findings.push({
        file: packageFile,
        line: lineForText(parsed.content, `"${name}"`) ?? 1,
        label: "NeoView package must keep a narrow stable export surface",
        text: `unexpected export ${name}`,
      })
    }
  }
  for (const name of allowedExports) {
    if (!(name in exports)) {
      findings.push({
        file: packageFile,
        line: 1,
        label: "NeoView package is missing a required stable export",
        text: `missing export ${name}`,
      })
    }
  }
}

function isForbiddenLayer(specifier: string, layers: string[]): boolean {
  return layers.some((layer) => new RegExp(`(?:^|/)${layer}(?:/|$|\\.[cm]?[jt]sx?$)`).test(specifier))
}

async function parseSourceIfExists(file: string): Promise<SourceFile | null> {
  const content = await readTextIfExists(file)
  if (content === null) return null

  const result = parseSync(file, content, {
    lang: file.endsWith(".tsx") || file.endsWith(".jsx") ? "tsx" : "ts",
    sourceType: "module",
    astType: "ts",
    preserveParens: true,
  })

  return {
    file,
    content,
    program: result.program,
    lineStarts: lineStarts(content),
  }
}

function importDeclarations(source: SourceFile): Node[] {
  return source.program.body.filter((node) => node.type === "ImportDeclaration") as Node[]
}

function exportDeclarations(source: SourceFile): Node[] {
  return source.program.body.filter((node) => (
    node.type === "ExportNamedDeclaration"
    || node.type === "ExportAllDeclaration"
  )) as Node[]
}

function importSource(node: Node): string | undefined {
  const source = (node as { source?: Node | null }).source
  if (!source || source.type !== "Literal") return undefined
  const value = (source as { value?: unknown }).value
  return typeof value === "string" ? value : undefined
}

function collectTextPatternFindings(source: SourceFile, pattern: RegExp, label: string, findings: Finding[]): void {
  for (const match of source.content.matchAll(pattern)) {
    const start = match.index ?? 0
    findings.push({
      file: source.file,
      line: lineAt(source, start),
      label,
      text: source.content.slice(start, start + match[0].length),
    })
  }
}

function collectForbiddenPackageDependency(
  parsed: { file: string; content: string },
  deps: Set<string>,
  name: string,
  label: string,
  findings: Finding[],
): void {
  if (!deps.has(name)) return
  findings.push({
    file: parsed.file,
    line: lineForText(parsed.content, `"${name}"`) ?? 1,
    label,
    text: `"${name}"`,
  })
}

function dependencyNames(packageJson: unknown): Set<string> {
  const record = packageJson as Record<string, unknown>
  const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
  const names = new Set<string>()
  for (const section of sections) {
    const deps = record[section]
    if (!deps || typeof deps !== "object" || Array.isArray(deps)) continue
    for (const name of Object.keys(deps)) names.add(name)
  }
  return names
}

async function parseJsonIfExists(file: string): Promise<{ file: string; content: string; value: unknown } | null> {
  const content = await readTextIfExists(file)
  if (content === null) return null
  return { file, content, value: JSON.parse(content) }
}

function visitAst(source: SourceFile, visit: (node: Node) => void): void {
  walkNode(source.program as Node, (node) => {
    visit(node)
  })
}

function walkNode(node: Node, visit: (node: Node) => void): void {
  visit(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) walkNode(item, visit)
      }
    } else if (isNode(value)) {
      walkNode(value, visit)
    }
  }
}

function isNode(value: unknown): value is Node {
  return Boolean(value && typeof value === "object" && "type" in value)
}

function isIdentifier(node: Node, name: string): boolean {
  return node.type === "Identifier" && (node as { name?: unknown }).name === name
}

function isFunctionNamed(node: Node, name: string): boolean {
  if (node.type !== "FunctionDeclaration") return false
  const id = (node as { id?: Node | null }).id
  return Boolean(id && isIdentifier(id, name))
}

function isVariableDeclaratorId(node: Node, name: string): boolean {
  if (node.type !== "VariableDeclarator") return false
  const id = (node as { id?: Node }).id
  return Boolean(id && isIdentifier(id, name))
}

function isJsxElementNamed(node: Node, name: string): boolean {
  if (node.type !== "JSXOpeningElement") return false
  const jsxName = (node as { name?: Node }).name
  return Boolean(jsxName && jsxName.type === "JSXIdentifier" && (jsxName as { name?: unknown }).name === name)
}

function isPropertyKey(node: Node, key: string): boolean {
  if (node.type !== "Property" && node.type !== "PropertyDefinition" && node.type !== "TSPropertySignature") return false
  const propertyKey = (node as { key?: Node }).key
  if (!propertyKey) return false
  return propertyKeyName(propertyKey) === key
}

function isCallExpression(node: Node, name: string): boolean {
  if (node.type !== "CallExpression") return false
  const callee = (node as { callee?: Node }).callee
  return Boolean(callee && isIdentifier(callee, name))
}

function isAwaitedCall(node: Node, name: string): boolean {
  if (node.type !== "AwaitExpression") return false
  const argument = (node as { argument?: Node }).argument
  return Boolean(argument && isCallExpression(argument, name))
}

function isMemberExpression(node: Node, objectName: string, propertyName?: string): boolean {
  if (node.type !== "MemberExpression" && node.type !== "ChainExpression") return false
  if (node.type === "ChainExpression") {
    const expression = (node as { expression?: Node }).expression
    return Boolean(expression && isMemberExpression(expression, objectName, propertyName))
  }

  const object = (node as { object?: Node }).object
  const property = (node as { property?: Node }).property
  if (!object || !property || !isIdentifier(object, objectName)) return false
  if (!propertyName) return true
  return propertyKeyName(property) === propertyName
}

function propertyKeyName(key: Node): string | undefined {
  if (key.type === "Identifier" || key.type === "JSXIdentifier") return (key as { name?: string }).name
  if (key.type === "Literal") {
    const value = (key as { value?: unknown }).value
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined
  }
  return undefined
}

function addNodeFinding(source: SourceFile, node: Node, label: string, text: string, findings: Finding[]): void {
  findings.push({
    file: source.file,
    line: lineAt(source, nodeStart(node)),
    label,
    text: compactText(text),
  })
}

function nodeText(source: SourceFile, node: Node): string {
  const start = nodeStart(node)
  const end = nodeEnd(node)
  return source.content.slice(start, end)
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function nodeStart(node: Node): number {
  return typeof (node as { start?: unknown }).start === "number" ? (node as { start: number }).start : 0
}

function nodeEnd(node: Node): number {
  return typeof (node as { end?: unknown }).end === "number" ? (node as { end: number }).end : nodeStart(node)
}

function lineStarts(content: string): number[] {
  const starts = [0]
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") starts.push(index + 1)
  }
  return starts
}

function lineAt(source: SourceFile, offset: number): number {
  let low = 0
  let high = source.lineStarts.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (source.lineStarts[middle] <= offset) {
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return high + 1
}

function lineForText(content: string, text: string): number | undefined {
  const index = content.indexOf(text)
  if (index < 0) return undefined
  return lineAt({ file: "", content, program: {} as Program, lineStarts: lineStarts(content) }, index)
}

async function listNodeDirs(nodesRoot: string): Promise<Array<{ name: string; path: string }>> {
  const entries = await readdir(nodesRoot, { withFileTypes: true })
  const dirs: Array<{ name: string; path: string }> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(nodesRoot, entry.name)
    const info = await stat(path)
    if (info.isDirectory()) dirs.push({ name: entry.name, path })
  }
  return dirs.sort((left, right) => left.name.localeCompare(right.name))
}

async function listSourceFiles(root: string): Promise<string[]> {
  const output: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) output.push(...await listSourceFiles(path))
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) output.push(path)
  }
  return output
}

async function readTextIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8")
  } catch {
    return null
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function requireValue(name: string): string {
  const index = process.argv.indexOf(name)
  const value = process.argv[index + 1]
  if (!value) throw new Error(`${name} requires a value.`)
  return value
}

function relative(file: string): string {
  return file.startsWith(ROOT) ? file.slice(ROOT.length + 1).replace(/\\/g, "/") : file.replace(/\\/g, "/")
}

function printHelp(): void {
  console.log([
    "Usage: bun scripts/validate-node-architecture.ts [--root <repo>] [--node <node-id>]",
    "",
    "Validates the adapter-free Xiranite node package boundaries with OXC AST checks:",
    "- contract has no card schema, backend runner, or CLI fields",
    "- migrated headless packages do not expose Component or depend on React UI packages",
    "- legacy Component.tsx is shell-less content, uses @xiranite/ui, and does not call host runners",
    "- index.ts and package exports keep demo shells private",
    "- cli.ts does not import the React UI component",
    "- core.ts avoids obvious UI/app/native platform imports",
    "- NeoView keeps its heavy-node layers, test boundary, and public exports narrow",
  ].join("\n"))
}

await main()
