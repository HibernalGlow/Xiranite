import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { MelodeckLyricLine } from "./lyrics.js"

export type MelodeckAction = "status" | "play" | "pause" | "toggle" | "stop" | "next" | "previous" | "add" | "clear" | "seek" | "volume"
export interface MelodeckInput { action?: MelodeckAction; paths?: string[]; volume?: number; seekSeconds?: number; mpvPath?: string; ipcPath?: string }
export type MelodeckArtwork = Uint8Array
export interface MelodeckTrackMetadata { title?: string; artist?: string; album?: string; artwork?: MelodeckArtwork; lyrics?: MelodeckLyricLine[] }
export interface MelodeckStatus { running: boolean; paused: boolean; path: string; title: string; artist: string; album: string; artwork?: MelodeckArtwork; lyrics?: MelodeckLyricLine[]; duration: number; position: number; volume: number; playlist: string[] }
export interface MelodeckData { command: string[]; status: MelodeckStatus; output: string; errors: string[] }
export interface MelodeckRuntime {
  ipcPath: string
  resolve: (path?: string) => Promise<{ found: boolean; path: string }>
  launch: (path: string, args: string[]) => Promise<{ stop(): void }>
  command: (path: string, command: Record<string, unknown>) => Promise<Record<string, unknown>>
  waitForIpc: (path: string, timeoutMs?: number) => Promise<boolean>
  metadata?: (path: string) => Promise<MelodeckTrackMetadata>
}
export type MelodeckResult = NodeRunResult<MelodeckData>

export function normalizeMelodeckPaths(paths: string[] | undefined): string[] {
  return [...new Set((paths ?? []).map((path) => path.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean))]
}

export function buildMelodeckCommand(action: MelodeckAction, paths: string[] = [], volume = 80): string[] {
  const files = normalizeMelodeckPaths(paths)
  const base = ["--no-terminal", "--no-video", "--force-window=no", "--idle=yes", `--volume=${clampVolume(volume)}`]
  return action === "play" ? [...base, ...files] : base
}

export async function runMelodeck(input: MelodeckInput, runtime: MelodeckRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<MelodeckResult> {
  const action = input.action ?? "status"
  const paths = normalizeMelodeckPaths(input.paths)
  const volume = clampVolume(input.volume ?? 80)
  const ipc = input.ipcPath ?? runtime.ipcPath
  const empty = emptyStatus(volume)
  const resolved = await runtime.resolve(input.mpvPath)
  if (!resolved.found) return fail("mpv was not found. Install mpv or set --mpv-path.", empty)

  if (action === "play") return playQueue(runtime, resolved.path, ipc, paths, volume, onEvent)

  let current: MelodeckStatus
  try {
    current = await queryStatus(runtime, ipc, volume)
  } catch (error) {
    if (action === "status") return ok("Melodeck is not running.", empty, [])
    return fail(`Melodeck is not running: ${errorMessage(error)}`, empty)
  }

  if (action === "status") return ok(statusMessage(current), current, ["get_property", "pause"])
  if (action === "add" && !paths.length) return fail("Provide at least one audio path to add.", current)
  if (action === "seek" && (!Number.isFinite(input.seekSeconds) || input.seekSeconds === 0)) return fail("Provide a non-zero seek offset.", current)

  const commands = actionCommands(action, paths, volume, input.seekSeconds ?? 0)
  onEvent({ type: "progress", progress: 35, message: `Melodeck ${action}...` })
  try {
    for (const command of commands) await send(runtime, ipc, command)
  } catch (error) {
    return fail(`mpv ${action} failed: ${errorMessage(error)}`, current, commands.flatMap(String))
  }

  if (action === "stop") {
    onEvent({ type: "progress", progress: 100, message: "Melodeck stopped." })
    return ok("Melodeck stopped.", emptyStatus(current.volume), commands.flatMap(String))
  }

  try {
    const next = await queryStatus(runtime, ipc, current.volume)
    onEvent({ type: "progress", progress: 100, message: statusMessage(next) })
    return ok(actionMessage(action, next), next, commands.flatMap(String))
  } catch (error) {
    return fail(`mpv state refresh failed: ${errorMessage(error)}`, current, commands.flatMap(String))
  }
}

async function playQueue(runtime: MelodeckRuntime, mpvPath: string, ipc: string, paths: string[], volume: number, onEvent: (event: NodeRunEvent) => void): Promise<MelodeckResult> {
  const command = buildMelodeckCommand("play", paths, volume)
  if (!paths.length) return fail("Provide at least one audio path.", emptyStatus(volume), command)

  let sessionRunning = false
  try {
    await property(runtime, ipc, "pause")
    sessionRunning = true
  } catch {
    // A missing IPC endpoint means a fresh mpv session is required.
  }

  let launchedProcess: { stop(): void } | undefined
  try {
    if (sessionRunning) {
      onEvent({ type: "progress", progress: 25, message: "Replacing the active Melodeck queue." })
      await send(runtime, ipc, ["playlist-clear"])
      await send(runtime, ipc, ["loadfile", paths[0], "replace"])
      for (const path of paths.slice(1)) await send(runtime, ipc, ["loadfile", path, "append-play"])
      await send(runtime, ipc, ["set_property", "volume", volume])
      await send(runtime, ipc, ["set_property", "pause", false])
    } else {
      onEvent({ type: "progress", progress: 20, message: `Starting mpv with ${paths.length} track(s).` })
      const launchArgs = [
        "--no-terminal",
        "--no-video",
        "--force-window=no",
        "--idle=yes",
        `--volume=${volume}`,
        `--input-ipc-server=${ipc}`,
        ...paths,
      ]
      const process = await runtime.launch(mpvPath, launchArgs)
      launchedProcess = process
      if (!await runtime.waitForIpc(ipc, 4_000)) {
        process.stop()
        return fail("mpv started but its IPC endpoint did not become ready.", emptyStatus(volume), launchArgs)
      }
    }

    const status = await queryStatus(runtime, ipc, volume)
    onEvent({ type: "progress", progress: 100, message: statusMessage(status) })
    return ok(`Playing ${status.title || paths[0]}.`, status, command)
  } catch (error) {
    launchedProcess?.stop()
    return fail(`Unable to start playback: ${errorMessage(error)}`, emptyStatus(volume), command)
  }
}

function actionCommands(action: Exclude<MelodeckAction, "play" | "status">, paths: string[], volume: number, seekSeconds: number): unknown[][] {
  if (action === "pause") return [["set_property", "pause", true]]
  if (action === "toggle") return [["cycle", "pause"]]
  if (action === "stop") return [["quit"]]
  if (action === "next") return [["playlist-next", "force"]]
  if (action === "previous") return [["playlist-prev", "force"]]
  if (action === "clear") return [["playlist-clear"]]
  if (action === "seek") return [["seek", seekSeconds, "relative+exact"]]
  if (action === "volume") return [["set_property", "volume", volume]]
  return paths.map((path) => ["loadfile", path, "append-play"])
}

async function queryStatus(runtime: MelodeckRuntime, ipc: string, fallbackVolume: number): Promise<MelodeckStatus> {
  const pause = await property(runtime, ipc, "pause")
  const [path, title, duration, position, volume, playlist] = await Promise.all([
    property(runtime, ipc, "path").catch(() => ""),
    property(runtime, ipc, "media-title").catch(() => ""),
    property(runtime, ipc, "duration").catch(() => 0),
    property(runtime, ipc, "time-pos").catch(() => 0),
    property(runtime, ipc, "volume").catch(() => fallbackVolume),
    property(runtime, ipc, "playlist").catch(() => []),
  ])
  const currentPath = typeof path === "string" ? path : ""
  const metadata: MelodeckTrackMetadata = currentPath && runtime.metadata
    ? await runtime.metadata(currentPath).catch(() => ({} as MelodeckTrackMetadata))
    : {}
  return {
    running: true,
    paused: pause === true,
    path: currentPath,
    title: metadata.title || (typeof title === "string" && title ? title : fileName(currentPath)),
    artist: metadata.artist ?? "",
    album: metadata.album ?? "",
    artwork: metadata.artwork,
    lyrics: metadata.lyrics,
    duration: finiteNumber(duration),
    position: finiteNumber(position),
    volume: finiteNumber(volume, fallbackVolume),
    playlist: playlistPaths(playlist),
  }
}

async function property(runtime: MelodeckRuntime, ipc: string, name: string): Promise<unknown> {
  const response = await send(runtime, ipc, ["get_property", name])
  return response.data
}

async function send(runtime: MelodeckRuntime, ipc: string, command: unknown[]): Promise<Record<string, unknown>> {
  const response = await runtime.command(ipc, { command })
  if (response.error && response.error !== "success") throw new Error(String(response.error))
  return response
}

function playlistPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry]
    if (!entry || typeof entry !== "object") return []
    const filename = (entry as { filename?: unknown }).filename
    return typeof filename === "string" ? [filename] : []
  })
}

function actionMessage(action: MelodeckAction, status: MelodeckStatus): string {
  if (action === "pause") return `Paused ${status.title || "playback"}.`
  if (action === "toggle") return status.paused ? `Paused ${status.title || "playback"}.` : `Resumed ${status.title || "playback"}.`
  if (action === "next" || action === "previous") return `Playing ${status.title || "current track"}.`
  if (action === "add") return `Queue updated (${status.playlist.length} track(s)).`
  if (action === "clear") return "Queue cleared."
  if (action === "seek") return `Position ${formatTime(status.position)} / ${formatTime(status.duration)}.`
  if (action === "volume") return `Volume ${Math.round(status.volume)}%.`
  return statusMessage(status)
}

function statusMessage(status: MelodeckStatus): string {
  const state = status.paused ? "Paused" : "Playing"
  return status.title ? `${state}: ${status.title}` : `${state}.`
}

function clampVolume(value: number): number { return Math.max(0, Math.min(100, Math.round(value))) }
function finiteNumber(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback }
function fileName(path: string): string { return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "" }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function formatTime(seconds: number): string { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` }
function emptyStatus(volume: number): MelodeckStatus { return { running: false, paused: false, path: "", title: "", artist: "", album: "", duration: 0, position: 0, volume, playlist: [] } }
function ok(message: string, status: MelodeckStatus, command: string[]): MelodeckResult { return { success: true, message, data: { command, status, output: "", errors: [] } } }
function fail(message: string, status: MelodeckStatus, command: string[] = []): MelodeckResult { return { success: false, message, data: { command, status, output: "", errors: [message] } } }
