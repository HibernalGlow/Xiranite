#!/usr/bin/env bun

import { readFile } from "node:fs/promises"
import { resolveXiraniteConfigPath } from "@xiranite/config"
import { inspectNeoviewConfigFormat } from "./lib/neoview-config-format"

const args = process.argv.slice(2)
const strict = args.includes("--strict")
const write = args.includes("--write")
const configIndex = args.indexOf("--config")
if (configIndex >= 0 && !args[configIndex + 1]) throw new Error("--config requires a path.")
const configPath = resolveXiraniteConfigPath({
  configPath: configIndex >= 0 ? args[configIndex + 1] : undefined,
})

let text: string
try {
  text = await readFile(configPath, "utf8")
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    console.log(`[neoview-config] skipped: config file does not exist: ${configPath}`)
    process.exit(0)
  }
  throw error
}

let report = inspectNeoviewConfigFormat(text)
const label = report.format === "optimized" || report.format === "absent" ? "ok" : "warning"
console.log(`[neoview-config] ${label}: ${report.message}`)
console.log(`[neoview-config] file: ${configPath}`)

if (write && (report.format === "envelope" || report.format === "legacy" || report.format === "mixed")) {
  const { commitNeoviewConfig } = await import("../packages/nodes/neoview/src/platform/config/NeoviewConfigStore")
  const result = await commitNeoviewConfig({}, { configPath, strategy: "merge" })
  report = inspectNeoviewConfigFormat(await readFile(configPath, "utf8"))
  console.log(`[neoview-config] migrated: ${result.changed ? "yes" : "no"}; backup: ${result.backupPath ?? "not needed"}`)
  console.log(`[neoview-config] verification: ${report.format}: ${report.message}`)
}

if (report.format === "invalid" || (strict && (report.format === "envelope" || report.format === "legacy" || report.format === "mixed"))) {
  process.exitCode = 1
}
