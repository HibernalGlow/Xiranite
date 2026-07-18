import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type SoundwAction = "status" | "switch-recording" | "mute" | "unmute" | "toggle-mute" | "profiles" | "profile" | "settings"
export interface SoundwInput { action?: SoundwAction; soundSwitchPath?: string; profileName?: string }
export interface SoundwData { installed: boolean; command: string[]; output: string; profiles: string[]; muteState: string | null; errors: string[] }
export interface SoundwRuntime { resolve: (path?: string) => Promise<{ found: boolean; path: string }>; run: (path: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }> }

export async function runSoundw(input: SoundwInput, runtime: SoundwRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<NodeRunResult<SoundwData>> {
  const action = input.action ?? "status"
  const binary = await runtime.resolve(input.soundSwitchPath)
  if (!binary.found) return fail("SoundSwitch.CLI.exe not found. Install and start SoundSwitch first.", { installed: false })
  const args = action === "switch-recording" ? ["switch", "--type", "Recording"]
    : action === "mute" ? ["mute", "--state", "true"]
    : action === "unmute" ? ["mute", "--state", "false"]
    : action === "toggle-mute" ? ["mute", "--toggle"]
    : action === "profiles" ? ["profile", "--list"]
    : action === "profile" ? ["profile", "--name", input.profileName?.trim() || ""]
    : action === "settings" ? ["settings"] : ["mute"]
  if (action === "profile" && !input.profileName?.trim()) return fail("Enter a SoundSwitch profile name.", { installed: true })
  onEvent({ type: "progress", progress: 30, message: `Running SoundSwitch ${args.join(" ")}` })
  const result = await runtime.run(binary.path, args)
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
  if (result.code !== 0) {
    const message = /operation has timed out|did not respond within/i.test(output)
      ? "SoundSwitch CLI could not reach the SoundSwitch background app. Start SoundSwitch from the system tray, then try again."
      : output || "SoundSwitch command failed."
    return fail(message, { installed: true, command: args, output })
  }
  const profiles = action === "profiles" ? parseProfiles(result.stdout) : []
  const displayOutput = action === "profiles" ? (profiles.length ? `Profiles: ${profiles.join(", ")}` : "No SoundSwitch profiles found.") : output
  onEvent({ type: "progress", progress: 100, message: "SoundSwitch command completed." })
  return ok(displayOutput || "SoundSwitch command completed.", { installed: true, command: args, output: displayOutput, profiles, muteState: action === "status" ? result.stdout.trim() || null : null })
}
function parseProfiles(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).flatMap((line) => {
    if (!line.startsWith("│")) return []
    const name = line.split("│").map((cell) => cell.trim())[1]
    return name && name !== "Profile" ? [name] : []
  })
}
function data(partial: Partial<SoundwData>): SoundwData { return { installed: false, command: [], output: "", profiles: [], muteState: null, errors: [], ...partial } }
function ok(message: string, partial: Partial<SoundwData>): NodeRunResult<SoundwData> { return { success: true, message, data: data(partial) } }
function fail(message: string, partial: Partial<SoundwData>): NodeRunResult<SoundwData> { return { success: false, message, data: data({ ...partial, errors: [message] }) } }
