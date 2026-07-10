#!/usr/bin/env node
import { createCliHost, defineCommand, runMain, writeJson, writeLine } from "@xiranite/cli-runtime"
import { runSoundw, type SoundwAction } from "./core.js"
import { createNodeSoundwRuntime } from "./platform.js"
const host = createCliHost()
function command(name: string, action: SoundwAction, profile = false) { return defineCommand({ meta: { name, description: `SoundSwitch ${name}` }, args: { soundSwitchPath: { type: "string" }, profileName: { type: "string", required: profile }, json: { type: "boolean" } }, async run({ args }) { const result = await runSoundw({ action, soundSwitchPath: typeof args.soundSwitchPath === "string" ? args.soundSwitchPath : undefined, profileName: typeof args.profileName === "string" ? args.profileName : undefined }, createNodeSoundwRuntime()); if (args.json) writeJson(host, result); else writeLine(host, result.success ? result.data?.output || result.message : result.message); if (!result.success) process.exitCode = 1 } }) }
const program = defineCommand({ meta: { name: "xsoundw", description: "Switch SoundSwitch recording devices and microphone mute." }, subCommands: { status: command("status", "status"), recording: command("recording", "switch-recording"), mute: command("mute", "mute"), unmute: command("unmute", "unmute"), toggle: command("toggle", "toggle-mute"), profiles: command("profiles", "profiles"), profile: command("profile", "profile", true), settings: command("settings", "settings") } })
await runMain(program, { rawArgs: process.argv.slice(2) })
