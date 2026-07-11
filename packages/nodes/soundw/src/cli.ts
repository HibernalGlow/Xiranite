#!/usr/bin/env node
import { createCliHost, defineCommand, runMain, writeJson, writeLine } from "@xiranite/cli-runtime"
import { loadNodeConfigWithHints } from "@xiranite/config"
import { runSoundw, type SoundwAction } from "./core.js"
import { createNodeSoundwRuntime } from "./platform.js"

const host = createCliHost()
interface SoundwConfig { sound_switch_path?: string; profile_name?: string }
function stringArg(value: string | boolean | string[] | undefined) { return typeof value === "string" ? value : undefined }
async function config(json: boolean) {
  return (await loadNodeConfigWithHints<SoundwConfig>("soundw", { hintSink: { stderr: process.stderr }, jsonMode: json })).config
}
function command(name: string, action: SoundwAction, profile = false) {
  return defineCommand({
    meta: { name, description: `SoundSwitch ${name}` },
    args: { soundSwitchPath: { type: "string", alias: "path" }, profileName: { type: "string", required: profile, alias: "profile" }, json: { type: "boolean" } },
    async run({ args }) {
      const json = Boolean(args.json); const saved = await config(json)
      const result = await runSoundw({ action, soundSwitchPath: stringArg(args.soundSwitchPath) ?? saved?.sound_switch_path, profileName: stringArg(args.profileName) ?? saved?.profile_name }, createNodeSoundwRuntime())
      if (json) writeJson(host, result); else writeLine(host, result.success ? result.data?.output || result.message : result.message)
      if (!result.success) process.exitCode = 1
    },
  })
}
const program = defineCommand({ meta: { name: "xsoundw", description: "Switch SoundSwitch recording devices and microphone mute." }, subCommands: { status: command("status", "status"), recording: command("recording", "switch-recording"), mute: command("mute", "mute"), unmute: command("unmute", "unmute"), toggle: command("toggle", "toggle-mute"), profiles: command("profiles", "profiles"), profile: command("profile", "profile", true), settings: command("settings", "settings") } })
await runMain(program, { rawArgs: process.argv.slice(2) })
