#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

type Severity = "error" | "warn"

interface Finding {
  node: string
  severity: Severity
  message: string
}

interface NodeUiAudit {
  node: string
  componentLines: number
  hasDesignDoc: boolean
  hasMatureResultComponentCoverage: boolean
  needsMatureResultComponent: boolean
  hasSurfaceMatrixTest: boolean
}

const strict = process.argv.includes("--strict")
const root = process.cwd()
const nodesDir = join(root, "packages", "nodes")
const appNodesDir = join(root, "src", "nodes")
const designDocsDir = join(root, "docs", "node-ui-designs")
const globalDesignDoc = readTextIfExists(join(root, "docs", "node-specific-ui-redesign.md")) ?? ""
const nodeNames = readdirSync(nodesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b))

const findings: Finding[] = []
const audits = nodeNames.map(auditNode)

printSummary(audits)
printFindings()

const hasErrors = findings.some((finding) => finding.severity === "error")
const hasWarnings = findings.some((finding) => finding.severity === "warn")
if (hasErrors || (strict && hasWarnings)) {
  process.exitCode = 1
}

function auditNode(node: string): NodeUiAudit {
  const appRoot = join(appNodesDir, node)
  const componentPath = join(appRoot, "Component.tsx")
  const entryPath = join(appRoot, "entry.ts")
  const testPath = join(appRoot, "Component.test.tsx")
  const designDocPath = join(designDocsDir, `${node}.md`)

  const component = readTextIfExists(componentPath)
  const test = readTextIfExists(testPath)
  const designDoc = readTextIfExists(designDocPath) ?? extractGlobalDesignBrief(globalDesignDoc, node)
  const appSource = readSourceTree(appRoot)

  if (!component) {
    error(node, "missing app-owned Component.tsx")
  }
  if (!existsSync(entryPath)) {
    error(node, "missing app-owned entry.ts")
  }
  if (!test) {
    error(node, "missing app-owned Component.test.tsx")
  }
  if (component && !component.includes("useNodeSurface") && !component.includes("PackuWorkbench")) {
    error(node, "Component.tsx must use useNodeSurface() instead of fixed card assumptions")
  }
  if (component) {
    const surfaceRoot = component.match(/<div\b[^>]*ref=\{surface\.ref\}[^>]*>/s)?.[0]
    if (surfaceRoot && /\bbg-card(?:\/[^\s"']+)?\b/.test(surfaceRoot)) {
      error(node, "useNodeSurface root must stay transparent so workspace theme backgrounds remain visible")
    }
  }

  const componentLines = component ? countLines(component) : 0
  if (componentLines > 1000) {
    error(node, `Component.tsx has ${componentLines} lines; hard limit is 1000`)
  } else if (componentLines > 800) {
    warn(node, `Component.tsx has ${componentLines} lines; recommended limit is 800`)
  }

  const hasSurfaceMatrixTest = Boolean(test && hasSurfaceModeCoverage(test))
  if (!hasSurfaceMatrixTest) {
    warn(node, "Component.test.tsx does not clearly cover the full node surface matrix")
  }

  const hasDesignDoc = Boolean(designDoc)
  if (!hasDesignDoc) {
    warn(node, `missing design note docs/node-ui-designs/${node}.md`)
  }

  const needsMatureResultComponent = Boolean(designDoc && requiresDataTable(designDoc))
  const hasMatureResultComponentCoverage = Boolean(
    !needsMatureResultComponent
      || (usesProjectDataTable(appSource) && test && coversDataTableBehavior(test)),
  )
  if (!hasMatureResultComponentCoverage) {
    warn(node, "design note requires a DataTable result view, but Component/test coverage does not prove it")
  }

  return {
    node,
    componentLines,
    hasDesignDoc,
    hasMatureResultComponentCoverage,
    needsMatureResultComponent,
    hasSurfaceMatrixTest,
  }
}

function hasSurfaceModeCoverage(test: string): boolean {
  if (test.includes("NODE_SURFACE_TEST_MODES")) return true
  const modes = ["collapsed", "compact", "portrait", "regular", "expanded", "workspace"]
  return modes.every((mode) => test.includes(`"${mode}"`)) && /test\.each\(/.test(test)
}

function printSummary(audits: NodeUiAudit[]): void {
  const withinRecommendedLimit = audits.filter((item) => item.componentLines > 0 && item.componentLines <= 800).length
  const surfaceMatrixCovered = audits.filter((item) => item.hasSurfaceMatrixTest).length
  const designDocs = audits.filter((item) => item.hasDesignDoc).length
  const matureResultRequirements = audits.filter((item) => item.needsMatureResultComponent).length
  const matureResultCovered = audits.filter((item) => item.needsMatureResultComponent && item.hasMatureResultComponentCoverage).length
  const largest = [...audits].sort((a, b) => b.componentLines - a.componentLines).slice(0, 8)

  console.log(`Node UI quality: ${withinRecommendedLimit}/${audits.length} Component.tsx files within 800 lines`)
  console.log(`Surface matrix tests: ${surfaceMatrixCovered}/${audits.length}`)
  console.log(`Design notes: ${designDocs}/${audits.length}`)
  console.log(`Mature result components: ${matureResultCovered}/${matureResultRequirements} DataTable requirement(s) covered`)
  console.log("")
  console.log("Largest app-owned Component.tsx files:")
  for (const item of largest) {
    console.log(`  ${item.node.padEnd(10)} ${String(item.componentLines).padStart(4)} lines`)
  }
}

function printFindings(): void {
  if (!findings.length) {
    console.log("")
    console.log("No node UI quality findings.")
    return
  }

  console.log("")
  for (const finding of findings) {
    console.log(`${finding.severity.toUpperCase().padEnd(5)} ${finding.node}: ${finding.message}`)
  }

  const errors = findings.filter((finding) => finding.severity === "error").length
  const warnings = findings.length - errors
  console.log("")
  console.log(`Node UI quality audit found ${errors} error(s) and ${warnings} warning(s).`)
}

function error(node: string, message: string): void {
  findings.push({ node, severity: "error", message })
}

function warn(node: string, message: string): void {
  findings.push({ node, severity: "warn", message })
}

function readTextIfExists(file: string): string | null {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return null
  }
}

function readSourceTree(dir: string): string {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
      .map((entry) => readFileSync(join(dir, entry.name), "utf8"))
      .join("\n")
  } catch {
    return ""
  }
}

function countLines(text: string): number {
  return text.split(/\r?\n/).length
}

function requiresDataTable(designDoc: string): boolean {
  return /\b(?:DataTable|TanStack DataTable|Dice\/TanStack)\b/i.test(designDoc)
}

function extractGlobalDesignBrief(designDoc: string, node: string): string | null {
  const heading = new RegExp(`^### \`${escapeRegExp(node)}\`\\b[\\s\\S]*?(?=^### \`|^## |\\z)`, "m")
  return designDoc.match(heading)?.[0] ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function usesProjectDataTable(component: string): boolean {
  return component.includes("@/components/data-table/data-table")
}

function coversDataTableBehavior(test: string): boolean {
  return /data table|data-table|DataTable|filtering controls|Filter /i.test(test)
}
