import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

interface RiskAudit {
  node: string
  staleRenderLogs: boolean
  staleHostDataLogs: boolean
  missingFinally: boolean
  missingHostRunFallback: boolean
  powershellInteractive: boolean
  powershellProgress: boolean
}

const root = process.cwd()
const nodesDir = join(root, "packages", "nodes")
const nodes = readdirSync(nodesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b))

const audits = nodes.map(auditNode)
const risky = audits.filter((item) =>
  item.staleRenderLogs
  || item.staleHostDataLogs
  || item.missingFinally
  || item.missingHostRunFallback
  || item.powershellInteractive
  || item.powershellProgress
)

print(audits)

if (process.argv.includes("--strict") && risky.length) {
  console.error(`\n${risky.length} node package(s) have runtime/UI risk patterns.`)
  process.exitCode = 1
}

function auditNode(node: string): RiskAudit {
  const src = join(nodesDir, node, "src")
  const component = readIfExists(join(src, "Component.tsx"))
  const platform = readIfExists(join(src, "platform.ts"))
  const cli = readIfExists(join(src, "cli.ts"))
  const nativeSources = `${platform}\n${cli}`

  const usesRunningState = /setRunning\(true\)/.test(component)
  const hasFinally = /finally\s*\{[\s\S]*setRunning\(false\)/.test(component)
  const usesUnavailableFallback = /createUnavailableNativeAction/.test(component)
  const usesHostRunFallback = /host\.actions\?\.run\s*\?\?/.test(component) || /if\s*\(\s*host\.actions\?\.run\s*\)/.test(component)
  const usesPowerShell = /powershell(?:\.exe)?/i.test(nativeSources)

  return {
    node,
    staleRenderLogs: /logs:\s*\[\s*\.\.\.logs\.slice\(/.test(component),
    staleHostDataLogs: /host\.getData<[\s\S]{0,120}\?\.logs\s*\?\?/.test(component),
    missingFinally: usesRunningState && !hasFinally,
    missingHostRunFallback: usesUnavailableFallback && !usesHostRunFallback,
    powershellInteractive: usesPowerShell && !/-NonInteractive/.test(nativeSources),
    powershellProgress: usesPowerShell && !/ProgressPreference\s*=\s*['"]SilentlyContinue['"]/.test(nativeSources),
  }
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

function print(audits: RiskAudit[]): void {
  const headers = ["node", "render-log", "host-log", "finally", "host-run", "ps-nonint", "ps-progress"]
  const rows = audits.map((item) => [
    item.node,
    mark(!item.staleRenderLogs),
    mark(!item.staleHostDataLogs),
    mark(!item.missingFinally),
    mark(!item.missingHostRunFallback),
    mark(!item.powershellInteractive),
    mark(!item.powershellProgress),
  ])
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]!.length)))

  console.log(`Node runtime risk audit: ${audits.filter((item) => rows[audits.indexOf(item)]!.slice(1).every((value) => value === "ok")).length}/${audits.length} clean`)
  console.log("Checks: stale render-scope logs, stale host.getData logs, running cleanup in finally, host.actions.run fallback, non-interactive PowerShell, disabled PowerShell progress.")
  console.log("")
  console.log(formatRow(headers, widths))
  console.log(formatRow(widths.map((width) => "-".repeat(width)), widths))
  for (const row of rows) console.log(formatRow(row, widths))
}

function formatRow(cells: string[], widths: number[]): string {
  return cells.map((cell, index) => cell.padEnd(widths[index]!)).join("  ")
}

function mark(ok: boolean): string {
  return ok ? "ok" : "risk"
}
