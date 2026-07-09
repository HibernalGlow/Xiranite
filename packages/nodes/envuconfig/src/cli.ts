#!/usr/bin/env node
import { runEnvuConfig } from "./core.js"
import { createNodeEnvuConfigRuntime } from "./platform.js"
import { loadNodeConfigWithHints } from "@xiranite/config"

interface EnvuConfigNodeConfig {
  root?: string
  backup_dir?: string
  database_path?: string
  record_run?: boolean
  dry_run?: boolean
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const action = args.includes("backup") ? "backup" : args.includes("manifest") ? "manifest" : "scan"
  const root = args.find((arg, index) => {
    if (arg.startsWith("--") || ["scan", "manifest", "backup"].includes(arg)) return false
    return !["--backup-dir", "--database-path"].includes(args[index - 1] ?? "")
  })
  const backupIndex = args.indexOf("--backup-dir")
  const backupDir = backupIndex >= 0 ? args[backupIndex + 1] : undefined
  const databaseIndex = args.indexOf("--database-path")
  const databasePath = databaseIndex >= 0 ? args[databaseIndex + 1] : undefined
  const { config: nodeConfig } = await loadNodeConfigWithHints<EnvuConfigNodeConfig>("envuconfig", {
    hintSink: { stderr: process.stderr },
    jsonMode: json,
  })
  const result = await runEnvuConfig({
    action,
    root: root ?? nodeConfig?.root,
    backupDir: backupDir ?? nodeConfig?.backup_dir,
    databasePath: databasePath ?? nodeConfig?.database_path,
    recordRun: args.includes("--record-run") || nodeConfig?.record_run === true,
    dryRun: args.includes("--dry-run") || nodeConfig?.dry_run === true,
  }, createNodeEnvuConfigRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}
