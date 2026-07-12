#!/usr/bin/env node
import { runJellyPot } from "./core.js"
import { createNodeJellyPotRuntime } from "./platform.js"
import { createCliHost, runGuidedInteraction, writeLine, type CliHost } from "@xiranite/cli-runtime"
import { resolveInteractionPreferences, type CliInteractionPreferencesSource } from "@xiranite/cli-runtime/interaction"
import { runInteractionCli, runTerminalUi, type TerminalPreferenceController, type TerminalPreferenceValues } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints, loadXiraniteConfig, saveXiraniteConfig, updateNodeConfig } from "@xiranite/config"
import { createJellyPotInteractionSchema } from "./interaction.js"
import { help } from "./help.js"

interface JellyPotNodeConfig extends CliInteractionPreferencesSource {
  config_path?: string
  database_path?: string
  media_path?: string
  potplayer_path?: string
  browser_path?: string
  record_run?: boolean
  dry_run?: boolean
}

async function runPipeProgram(args = process.argv.slice(2)): Promise<void> {
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

export async function runProgram(args=process.argv.slice(2),host:CliHost=createCliHost()):Promise<void>{
  await runInteractionCli({args,host,cliName:"xjellypot",
    loadContext:async()=>{const{config}=await loadNodeConfigWithHints<JellyPotNodeConfig>("jellypot",{env:host.env,cwd:host.cwd,hintSink:{stderr:host.stderr},jsonMode:true});return{preferences:resolveInteractionPreferences(config),value:config??{}}},
    createDefinition:(d,language)=>({schema:createJellyPotInteractionSchema({configPath:d.config_path,databasePath:d.database_path,mediaPath:d.media_path,potplayerPath:d.potplayer_path,browserPath:d.browser_path,recordRun:d.record_run,dryRun:d.dry_run},language),run:(input,event)=>runJellyPot(input,createNodeJellyPotRuntime(),event)}),
    runPipe:(pipeArgs,pipeHost)=>pipeArgs.length?runPipeProgram(pipeArgs):Promise.resolve(writeLine(pipeHost,"xjellypot ui | gd | status | launch | open | registry")),
    runGuide:runGuidedInteraction,runUi:runTerminalUi,loadScreen:async()=>(await import("./Tui.js")).JellyPotTui,
    createPreferences:(_d,current)=>preferences(host,current),reexecEntrypoint:process.argv[1],help,
  })
}
function preferences(host:CliHost,current:TerminalPreferenceValues):TerminalPreferenceController{const o={env:host.env,cwd:host.cwd};return{nodeId:"jellypot",current,async save(v){const{config,path}=await loadXiraniteConfig(o);await saveXiraniteConfig(updateNodeConfig(config,"jellypot",{cli:{theme:v.theme,default_mode:v.defaultMode,language:v.language}}),{...o,configPath:path})},async restore(){const{config}=await loadNodeConfigWithHints<JellyPotNodeConfig>("jellypot",{...o,jsonMode:true});const p=resolveInteractionPreferences(config);return{theme:p.theme,defaultMode:p.mode,language:p.language??"zh"}}}}

if (process.argv[1] && /\bcli\.[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  await runProgram()
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
