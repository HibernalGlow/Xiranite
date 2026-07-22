import { createConnection } from "node:net"
import { spawn } from "node:child_process"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { parseFile } from "music-metadata"
import type { MelodeckRuntime, MelodeckStatus, MelodeckTrackMetadata } from "./core.js"
import { extractEmbeddedLyrics, lyricPathCandidates, parseLrc } from "./lyrics.js"

const exec = promisify(execFile)
const metadataCache = new Map<string, Promise<MelodeckTrackMetadata>>()
export const DEFAULT_MELODECK_IPC = process.platform === "win32" ? "\\\\.\\pipe\\xiranite-melodeck-v2" : "/tmp/xiranite-melodeck-v2.sock"
export function createNodeMelodeckRuntime(): MelodeckRuntime { return { ipcPath: DEFAULT_MELODECK_IPC, resolve, launch, command, waitForIpc, metadata } }
async function resolve(path?: string) {
  if (path) {
    try {
      await stat(path)
      return { found: true, path }
    } catch {
      return { found: false, path: "" }
    }
  }

  try {
    const { stdout } = await exec(process.platform === "win32" ? "where.exe" : "which", ["mpv"], { windowsHide: true })
    return { found: true, path: stdout.split(/\r?\n/).find(Boolean)?.trim() ?? "mpv" }
  } catch {
    if (process.platform !== "win32") return { found: false, path: "" }
  }

  const scoopRoots = [process.env.SCOOP, join(homedir(), "scoop")].filter((value): value is string => Boolean(value))
  for (const root of scoopRoots) {
    const candidate = join(root, "apps", "mpv", "current", "mpv.exe")
    try {
      await stat(candidate)
      return { found: true, path: candidate }
    } catch {
      // Try the next conventional Scoop root.
    }
  }
  return { found: false, path: "" }
}
async function launch(path: string, args: string[]) {
  const child = spawn(path, args, { detached: true, stdio: "ignore", windowsHide: true })
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
  child.unref()
  return {
    stop() {
      if (!child.killed) child.kill()
    },
  }
}

async function waitForIpc(path: string, timeoutMs = 4_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await command(path, { command: ["get_property", "pause"] })
      if (!response.error || response.error === "success") return true
    } catch {
      // mpv creates the endpoint shortly after the process has spawned.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

async function command(path: string, value: Record<string, unknown>) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = createConnection(path)
    let buffer = ""
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timer = setTimeout(() => {
      socket.destroy()
      finish(() => reject(new Error("mpv IPC timed out")))
    }, 2_000)
    socket.on("connect", () => socket.write(`${JSON.stringify(value)}\n`))
    socket.on("data", (chunk) => {
      buffer += String(chunk)
      const line = buffer.split("\n").find((entry) => entry.trim())
      if (!line) return
      socket.end()
      finish(() => {
        try {
          resolve(JSON.parse(line) as Record<string, unknown>)
        } catch {
          reject(new Error(`Invalid mpv IPC response: ${line}`))
        }
      })
    })
    socket.on("error", (error) => finish(() => reject(error)))
    socket.on("close", () => {
      if (!settled) finish(() => reject(new Error("mpv IPC closed without a response")))
    })
  })
}

async function metadata(path: string): Promise<MelodeckTrackMetadata> {
  const cached = metadataCache.get(path)
  if (cached) return cached
  const pending = readMetadata(path).catch(() => ({}))
  metadataCache.set(path, pending)
  if (metadataCache.size > 32) metadataCache.delete(metadataCache.keys().next().value as string)
  return pending
}

async function readMetadata(path: string): Promise<MelodeckTrackMetadata> {
  const parsed = await parseFile(path, { skipCovers: false, skipPostHeaders: true })
  const picture = parsed.common.picture?.[0]
  const embeddedLyrics = extractEmbeddedLyrics(parsed.common.lyrics)
  return {
    title: parsed.common.title,
    artist: parsed.common.artist,
    album: parsed.common.album,
    artwork: picture?.data,
    lyrics: embeddedLyrics.length ? embeddedLyrics : await readSidecarLyrics(path),
  }
}

async function readSidecarLyrics(path: string) {
  for (const candidate of lyricPathCandidates(path)) {
    try {
      const lines = parseLrc(await readFile(candidate, "utf8"))
      if (lines.length) return lines
    } catch {
      // Try the next case variant.
    }
  }
  return []
}

export async function observeMelodeck(
  path: string,
  onStatus: (status: MelodeckStatus) => void,
  onError: (error: Error) => void = () => {},
): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path)
    let connected = false
    let closed = false
    let buffer = ""
    let metadataGeneration = 0
    let lastPositionEmit = 0
    let mpvTitle = ""
    let trackMetadata: MelodeckTrackMetadata = {}
    const status: MelodeckStatus = {
      running: true,
      paused: false,
      path: "",
      title: "",
      artist: "",
      album: "",
      duration: 0,
      position: 0,
      volume: 80,
      playlist: [],
    }
    const emit = () => onStatus({
      ...status,
      title: trackMetadata.title || mpvTitle || status.path.split(/[\\/]/).at(-1) || "",
      artist: trackMetadata.artist ?? "",
      album: trackMetadata.album ?? "",
      artwork: trackMetadata.artwork,
      lyrics: trackMetadata.lyrics,
      playlist: [...status.playlist],
    })
    const loadTrackMetadata = (trackPath: string) => {
      const generation = ++metadataGeneration
      trackMetadata = {}
      emit()
      if (!trackPath) return
      void metadata(trackPath).then((next) => {
        if (closed || generation !== metadataGeneration) return
        trackMetadata = next
        emit()
      })
    }
    const applyProperty = (name: string, data: unknown) => {
      if (name === "pause") status.paused = data === true
      else if (name === "path") {
        const nextPath = typeof data === "string" ? data : ""
        if (nextPath !== status.path) {
          status.path = nextPath
          loadTrackMetadata(nextPath)
        }
      } else if (name === "media-title") mpvTitle = typeof data === "string" ? data : ""
      else if (name === "duration") status.duration = typeof data === "number" && Number.isFinite(data) ? data : 0
      else if (name === "time-pos") {
        status.position = typeof data === "number" && Number.isFinite(data) ? data : 0
        const now = Date.now()
        if (now - lastPositionEmit < 200) return
        lastPositionEmit = now
      }
      else if (name === "volume") status.volume = typeof data === "number" && Number.isFinite(data) ? data : status.volume
      else if (name === "playlist") status.playlist = observedPlaylist(data)
      emit()
    }
    const cleanup = () => {
      if (closed) return
      closed = true
      socket.destroy()
    }

    socket.on("connect", () => {
      connected = true
      const properties = ["pause", "path", "media-title", "duration", "time-pos", "volume", "playlist"]
      properties.forEach((name, index) => socket.write(`${JSON.stringify({ command: ["observe_property", index + 1, name] })}\n`))
      resolve(cleanup)
    })
    socket.on("data", (chunk) => {
      buffer += String(chunk)
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line) as { event?: unknown; name?: unknown; data?: unknown }
          if (event.event === "property-change" && typeof event.name === "string") applyProperty(event.name, event.data)
        } catch {
          // Ignore malformed event lines and keep the observer alive.
        }
      }
    })
    socket.on("error", (error) => {
      if (!connected) reject(error)
      else if (!closed) onError(error)
    })
    socket.on("close", () => {
      if (closed) return
      closed = true
      onStatus({ ...status, running: false, paused: false, position: 0, artwork: undefined })
    })
  })
}

function observedPlaylist(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry]
    if (!entry || typeof entry !== "object") return []
    const filename = (entry as { filename?: unknown }).filename
    return typeof filename === "string" ? [filename] : []
  })
}
