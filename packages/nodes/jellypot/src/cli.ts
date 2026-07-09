#!/usr/bin/env node
import { runJellyPot } from "./core.js"
import { createNodeJellyPotRuntime } from "./platform.js"
import { loadNodeConfigWithHints } from "@xiranite/config"

interface JellyPotNodeConfig {
  config_path?: string
  database_path?: string
  media_path?: string
  potplayer_path?: string
  browser_path?: string
  record_run?: boolean
  dry_run?: boolean
}

export async function runProgram(args = process.argv.slice(2)): Promise<void> {
  const json = args.includes("--json")
  const dryRun = args.includes("--dry-run")
  const action = args.includes("launch") ? "launch_media" : args.includes("open") ? "open_jellyfin" : args.includes("registry") ? "apply_registry" : "status"
  const valueOptions = new Set(["--config-path", "--database-path", "--potplayer-path", "--browser-path"])
  const mediaPath = args.find((arg, index) => !arg.startsWith("--") && !["launch", "open", "registry", "status"].includes(arg) && !valueOptions.has(args[index - 1] ?? ""))
  const { config: nodeConfig } = await loadNodeConfigWithHints<JellyPotNodeConfig>("jellypot", {
    hintSink: { stderr: process.stderr },
    jsonMode: json,
  })
  const result = await runJellyPot({
    action,
    configPath: valueFor(args, "--config-path") ?? nodeConfig?.config_path,
    databasePath: valueFor(args, "--database-path") ?? nodeConfig?.database_path,
    mediaPath: mediaPath ?? nodeConfig?.media_path,
    potplayerPath: valueFor(args, "--potplayer-path") ?? nodeConfig?.potplayer_path,
    browserPath: valueFor(args, "--browser-path") ?? nodeConfig?.browser_path,
    recordRun: args.includes("--record-run") || nodeConfig?.record_run === true,
    dryRun: dryRun || nodeConfig?.dry_run === true,
  }, createNodeJellyPotRuntime())
  if (json) console.log(JSON.stringify(result, null, 2))
  else console.log(result.message)
  if (!result.success) process.exitCode = 1
}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
