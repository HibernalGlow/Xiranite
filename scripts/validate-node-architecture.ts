#!/usr/bin/env bun
import { readdir, readFile, stat } from "node:fs/promises"
import { join, resolve } from "node:path"

interface Rule {
  file: string
  label: string
  pattern: RegExp
}

interface Finding {
  file: string
  line: number
  label: string
  text: string
}

const ROOT = resolve(process.argv.includes("--root") ? requireValue("--root") : process.cwd())
const NODE_FILTER = process.argv.includes("--node") ? requireValue("--node") : null

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp()
  process.exit(0)
}

const contractRules: Rule[] = [
  rule("packages/contract/src/index.ts", "contract must not expose card schemas", /NodeCardSchema|NodeCardProps|card:\s*NodeCard/),
  rule("packages/contract/src/index.ts", "contract must not expose backend runners", /NodeRunnerApi|host\.runNode|host\.runner|runner\??\s*:|runNode\s*[:(]/),
  rule("packages/contract/src/index.ts", "NodeEntry must not expose CLI", /\bcli\??\s*:/),
]

const componentRules: Rule[] = [
  rule("src/Component.tsx", "Component must not import Xiranite app internals", /from\s+["']@\//),
  rule("src/Component.tsx", "Component must not call or name host runners", /host\.runNode|host\.runner|runner\??\s*:|createUnavailableNodeRunner|ComponentNodeRunner|\bconst\s+runNode\b|\bawait\s+runNode\b/),
  rule("src/Component.tsx", "Component must not define or render local Panel shells", /function\s+Panel\b|const\s+Panel\b|<Panel\b/),
  rule("src/Component.tsx", "Component must not import or render CardShell", /CardShell|from\s+["']\.\/demo|from\s+["']\.\/.*demo/),
  rule("src/Component.tsx", "Component must not hard-code card min heights", /min-h-\[3\d\dpx\]/),
  rule("src/Component.tsx", "Component must not hard-code arbitrary grid columns", /grid-cols-\[/),
]

const headlessForbiddenPackagePatterns: Rule[] = [
  rule("package.json", "headless node package must not depend on React", /"react"|"react-dom"|"react-i18next"|"@types\/react"/),
  rule("package.json", "headless node package must not depend on lucide-react", /"lucide-react"/),
  rule("package.json", "headless node package must not depend on @xiranite/ui", /"@xiranite\/ui"/),
]

const headlessIndexRules: Rule[] = [
  rule("src/index.ts", "headless index must not export or import Component", /\bComponent\b|\.\/Component/),
]

const indexRules: Rule[] = [
  rule("src/index.ts", "index must not export demo shells", /CardShell|from\s+["']\.\/demo|from\s+["']\.\/.*demo/),
  rule("src/index.ts", "index must not export CLI or platform adapters", /from\s+["']\.\/cli|from\s+["']\.\/platform|from\s+["']\.\/.*platform|\bcli\??\s*:|\bplatform\??\s*:/),
]

const packageRules: Rule[] = [
  rule("package.json", "package exports must not expose demo shells", /"\.\/demo|CardShell|src\/demo|dist\/demo|demo\/CardShell/),
]

const cliRules: Rule[] = [
  rule("src/cli.ts", "CLI must not import package React UI", /from\s+["']\.\/Component|Component\.tsx|@xiranite\/ui/),
  rule("src/cli.ts", "CLI must not import Xiranite app internals", /from\s+["']@\//),
]

const coreRules: Rule[] = [
  rule("src/core.ts", "core must not import React, Ink, or Xiranite UI", /from\s+["'](?:react|ink|@xiranite\/ui)/),
  rule("src/core.ts", "core must not import Xiranite app internals", /from\s+["']@\//),
  rule("src/core.ts", "core must not directly use Node/Bun platform APIs", /from\s+["']node:|from\s+["']fs(?:\/|["'])|from\s+["']child_process|Bun\.|process\./),
]

async function main() {
  const findings: Finding[] = []
  for (const rule of contractRules) {
    await collectFindings(resolve(ROOT, rule.file), rule, findings)
  }

  const nodeDirs = await listNodeDirs(resolve(ROOT, "packages", "nodes"))
  for (const nodeDir of nodeDirs) {
    if (NODE_FILTER && nodeDir.name !== NODE_FILTER) continue
    const hasComponent = await readTextIfExists(join(nodeDir.path, "src", "Component.tsx")) !== null
    const rules = hasComponent
      ? [...componentRules, ...indexRules, ...packageRules, ...cliRules, ...coreRules]
      : [...headlessForbiddenPackagePatterns, ...headlessIndexRules, ...indexRules, ...packageRules, ...cliRules, ...coreRules]
    for (const rule of rules) {
      await collectFindings(join(nodeDir.path, rule.file), rule, findings)
    }
    if (hasComponent) {
      await collectMissingRequired(
        join(nodeDir.path, "src", "Component.tsx"),
        rule("src/Component.tsx", "legacy package Component must use @xiranite/ui shared content primitives", /from\s+["']@xiranite\/ui["']/),
        findings,
      )
    }
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

function rule(file: string, label: string, pattern: RegExp): Rule {
  return { file, label, pattern }
}

async function collectFindings(file: string, rule: Rule, findings: Finding[]): Promise<void> {
  const content = await readTextIfExists(file)
  if (content === null) return

  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(line)) {
      findings.push({ file, line: index + 1, label: rule.label, text: line.trim() })
    }
  }
}

async function collectMissingRequired(file: string, rule: Rule, findings: Finding[]): Promise<void> {
  const content = await readTextIfExists(file)
  if (content === null) return

  rule.pattern.lastIndex = 0
  if (!rule.pattern.test(content)) {
    findings.push({ file, line: 1, label: rule.label, text: "missing required shared UI import" })
  }
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

async function readTextIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8")
  } catch {
    return null
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
    "Validates the adapter-free Xiranite node package boundaries:",
    "- contract has no card schema, backend runner, or CLI fields",
    "- migrated headless packages do not expose Component or depend on React UI packages",
    "- legacy Component.tsx is shell-less content, uses @xiranite/ui, and does not call host runners",
    "- index.ts and package exports keep demo shells private",
    "- cli.ts does not import the React UI component",
    "- core.ts avoids obvious UI/app/native platform imports",
  ].join("\n"))
}

await main()
