import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type MelodeckAction = "status" | "play" | "pause" | "toggle" | "stop" | "next" | "previous" | "add" | "clear"
export interface MelodeckInput { action?: MelodeckAction; paths?: string[]; volume?: number; mpvPath?: string; ipcPath?: string }
export interface MelodeckStatus { running: boolean; paused: boolean; path: string; title: string; duration: number; position: number; volume: number; playlist: string[] }
export interface MelodeckData { command: string[]; status: MelodeckStatus; output: string; errors: string[] }
export interface MelodeckRuntime {
  resolve: (path?: string) => Promise<{ found: boolean; path: string }>
  launch: (path: string, args: string[]) => Promise<void>
  command: (path: string, command: Record<string, unknown>) => Promise<Record<string, unknown>>
}
export type MelodeckResult = NodeRunResult<MelodeckData>

export function normalizeMelodeckPaths(paths: string[] | undefined): string[] {
  return (paths ?? []).map((path) => path.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean)
}

export function buildMelodeckCommand(action: MelodeckAction, paths: string[] = [], volume = 80): string[] {
  const files = normalizeMelodeckPaths(paths)
  const base = ["--no-video", "--force-window=no", "--idle=yes", `--volume=${Math.max(0, Math.min(100, Math.round(volume)))}`]
  if (action === "play") return [...base, ...files]
  if (action === "add") return [...base, ...files]
  return base
}

export async function runMelodeck(input: MelodeckInput, runtime: MelodeckRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<MelodeckResult> {
  const action = input.action ?? "status"
  const paths = normalizeMelodeckPaths(input.paths)
  const volume = Math.max(0, Math.min(100, Math.round(input.volume ?? 80)))
  const status = emptyStatus(volume)
  const resolved = await runtime.resolve(input.mpvPath)
  if (!resolved.found) return fail("mpv was not found. Install mpv or set --mpv-path.", status)
  const command = buildMelodeckCommand(action, paths, volume)
  if (action === "play") {
    if (!paths.length) return fail("Provide at least one audio path.", status, command)
    onEvent({ type: "progress", progress: 20, message: `Launching mpv with ${paths.length} track(s).` })
    await runtime.launch(resolved.path, [...command, "--input-ipc-server=${XIRANITE_MELODECK_IPC}"])
    return ok(`Started ${paths.length} track(s).`, { ...status, running: true, playlist: paths }, command)
  }
  const ipc = input.ipcPath
  if (!ipc) return fail("Melodeck IPC path is not configured. Start playback first.", status, command)
  const ipcCommand: Record<string, unknown> = action === "pause" ? { command: ["set_property", "pause", true] }
    : action === "toggle" ? { command: ["cycle", "pause"] }
    : action === "stop" ? { command: ["stop"] }
    : action === "next" ? { command: ["playlist-next", "force"] }
    : action === "previous" ? { command: ["playlist-prev", "force"] }
    : action === "add" ? { command: ["loadfile", paths[0] ?? "", "append-play"] }
    : action === "clear" ? { command: ["playlist-clear"] }
    : action === "status" ? { command: ["get_property", "pause"] }
    : { command: ["set_property", "volume", volume] }
  onEvent({ type: "progress", progress: 40, message: `Sending mpv command: ${action}.` })
  const response = await runtime.command(ipc, ipcCommand)
  if (response.error && response.error !== "success") return fail(`mpv command failed: ${String(response.error)}`, status, command)
  const next = { ...status, running: action !== "stop", paused: action === "pause" || action === "toggle" }
  onEvent({ type: "progress", progress: 100, message: `Melodeck ${action} completed.` })
  return ok(`Melodeck ${action} completed.`, { ...next, output: JSON.stringify(response) }, command)
}

function emptyStatus(volume: number): MelodeckStatus { return { running: false, paused: false, path: "", title: "", duration: 0, position: 0, volume, playlist: [] } }
function ok(message: string, status: MelodeckStatus & { output?: string }, command: string[]): MelodeckResult { return { success: true, message, data: { command, status, output: status.output ?? "", errors: [] } } }
function fail(message: string, status: MelodeckStatus, command: string[] = []): MelodeckResult { return { success: false, message, data: { command, status, output: "", errors: [message] } } }
