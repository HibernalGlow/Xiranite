import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

interface NodeTestAudit {
  node: string
  core: boolean
  cli: boolean
  component: boolean
  realRun: boolean
  vitestScript: boolean
  usesBunTest: boolean
}

const strict = process.argv.includes("--strict")
const root = process.cwd()
const nodesDir = join(root, "packages", "nodes")
const nodeNames = readdirSync(nodesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b))
const realRunNodes = collectRealRunNodes(root)

const audits = nodeNames.map(auditNode)
const complete = audits.filter((item) => item.core && item.cli && item.component && item.realRun && item.vitestScript && !item.usesBunTest)
const missing = audits.filter((item) => !complete.includes(item))

printSummary(audits, complete.length)
printTable(audits)

if (strict && missing.length) {
  console.error(`\n${missing.length} node package(s) are missing required test coverage.`)
  process.exitCode = 1
}

function auditNode(node: string): NodeTestAudit {
  const src = join(nodesDir, node, "src")
  const packageJsonPath = join(nodesDir, node, "package.json")
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> }
  const testScript = packageJson.scripts?.test ?? ""

  return {
    node,
    core: existsSync(join(src, "core.test.ts")) || existsSync(join(src, "core.test.tsx")),
    cli: existsSync(join(src, "cli.test.ts")) || existsSync(join(src, "cli.test.tsx")),
    component: existsSync(join(src, "Component.test.tsx")),
    realRun: realRunNodes.has(node),
    vitestScript: /\bvitest\s+run\b/.test(testScript),
    usesBunTest: sourceFiles(src).some((file) => readFileSync(file, "utf8").includes("bun:test")),
  }
}

function printSummary(audits: NodeTestAudit[], completeCount: number): void {
  console.log(`Node test matrix: ${completeCount}/${audits.length} complete`)
  console.log("Required: core.test.ts, cli.test.ts, Component.test.tsx, real file/backend run marker, Vitest test script, and no bun:test imports.")
}

function printTable(audits: NodeTestAudit[]): void {
  const rows = audits.map((item) => [
    item.node,
    mark(item.core),
    mark(item.cli),
    mark(item.component),
    mark(item.realRun),
    mark(item.vitestScript),
    item.usesBunTest ? "yes" : "no",
  ])
  const headers = ["node", "core", "cli", "component", "real-run", "vitest", "bun:test"]
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]!.length)))

  console.log("")
  console.log(formatRow(headers, widths))
  console.log(formatRow(widths.map((width) => "-".repeat(width)), widths))
  for (const row of rows) console.log(formatRow(row, widths))
}

function formatRow(cells: string[], widths: number[]): string {
  return cells.map((cell, index) => cell.padEnd(widths[index]!)).join("  ")
}

function mark(value: boolean): string {
  return value ? "yes" : "missing"
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

function collectRealRunNodes(rootDir: string): Set<string> {
  const nodes = new Set<string>()
  const marker = /@xiranite-real-run\s+([a-z0-9-]+)/g
  for (const file of [
    ...sourceFiles(join(rootDir, "packages", "backend", "src")),
    ...sourceFiles(nodesDir),
    ...sourceFiles(join(rootDir, "tests")),
  ]) {
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(marker)) {
      nodes.add(match[1]!)
    }
  }
  return nodes
}
