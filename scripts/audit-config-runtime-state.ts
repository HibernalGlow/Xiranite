import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { parseToml } from "@xiranite/config"

type Severity = "HIGH" | "REVIEW"

interface Finding {
  path: string
  severity: Severity
  reason: string
}

const configArgument = process.argv.find((argument) => !argument.startsWith("--") && argument !== process.argv[1])
const configPath = resolve(configArgument ?? "config/xiranite.config.toml")
const strict = process.argv.includes("--strict")
const root = parseToml(await readFile(configPath, "utf8")) as Record<string, unknown>
const findings = flatten(root).flatMap(([path]) => classify(path))

console.log(`Runtime-state config audit: ${configPath}`)
for (const finding of findings) {
  console.log(`${finding.severity.padEnd(6)} ${finding.path} - ${finding.reason}`)
}
console.log(`Summary: ${findings.filter((item) => item.severity === "HIGH").length} high, ${findings.filter((item) => item.severity === "REVIEW").length} review`)

if (strict && findings.some((finding) => finding.severity === "HIGH")) process.exitCode = 1

function flatten(value: unknown, prefix = ""): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => flatten(child, `${prefix}[${index}]`))
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key
      return isRecord(child) || Array.isArray(child) ? flatten(child, path) : [[path, child]]
    })
  }
  return [[prefix, value]]
}

function classify(path: string): Finding[] {
  const key = path.replace(/\[\d+\]/g, "").split(".").at(-1) ?? ""
  const normalized = key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`)
  const high: Record<string, string> = {
    active_lane: "focused lane is per workspace or node instance",
    reader_solo: "current fullscreen/solo state is per instance",
    solo_lane: "current fullscreen/solo target is per instance",
    phase: "task lifecycle cannot be resumed safely by another process",
    progress: "task progress belongs to one running process",
    progress_text: "task progress text belongs to one running process",
    running: "running state cannot be shared across processes",
    running_item: "current work item belongs to one running process",
    focused_control_id: "keyboard focus is local to one UI instance",
    session_id: "session identity must not be a shared default",
    current_page: "current page requires a book/session scoped store",
  }
  const review: Record<string, string> = {
    source_path: "may be a reusable default or the current item; verify multi-instance ownership",
    active_panel_id: "may be layout preference or the panel currently focused by one instance",
    active_list_id: "may be a preferred default list or one instance's current selection",
    active_menu_id: "may be a configured default menu or one editor/runtime instance's selection",
  }
  if (high[normalized]) return [{ path, severity: "HIGH", reason: high[normalized] }]
  if (review[normalized]) return [{ path, severity: "REVIEW", reason: review[normalized] }]
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
