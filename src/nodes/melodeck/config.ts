import { getAppConfigFromBackend, getNodeConfigFromBackend, saveAppConfigToBackend, saveNodeConfigToBackend } from "@/backend/configRpcClient"
import type { PersistedTrack } from "@/components/modules/musicPlayer/MusicPlayerSurface"
import type { FoliaLoopMode, FoliaReplayGainMode } from "@hibernalglow/folia-player"
import { DEFAULT_MUSIC_VISUALIZER_STYLE, normalizeMusicVisualizerStyle, type MusicVisualizerStyle } from "@/components/modules/musicPlayer/visualizerStyles"

export type MelodeckMode = "bottom" | "floating" | "fullscreen"

export interface MelodeckFloatingOffset {
  x: number
  y: number
}

export interface MelodeckConfig {
  config_version?: 1
  player_engine?: "folia" | "legacy"
  playback?: {
    volume?: number
    loop_mode?: FoliaLoopMode
    replay_gain_mode?: FoliaReplayGainMode
    output_device_id?: string
    active_track_id?: string
  }
  library?: { roots?: string[] }
  surfaces?: {
    mode?: MelodeckMode
    collapsed?: boolean
    follow_fullscreen_with_floating?: boolean
  }
  visualizer?: Record<string, unknown>
  source_path?: string
  saved_tracks?: PersistedTrack[]
  mode?: MelodeckMode
  floating_offset?: MelodeckFloatingOffset
  visualizer_style?: MusicVisualizerStyle
  mpv_path?: string
  ipc_path?: string
  volume?: number
  [key: string]: unknown
}

interface LegacyMusicDockConfig {
  sourcePath?: string
  savedTracks?: PersistedTrack[]
  mode?: MelodeckMode
  floatingOffset?: MelodeckFloatingOffset
  visualizerStyle?: MusicVisualizerStyle
}

interface LegacyAppUiConfig {
  musicDock?: LegacyMusicDockConfig
  [key: string]: unknown
}

export const MELODECK_CONFIG_CHANGED_EVENT = "xiranite:melodeck-config-changed"

interface SaveMelodeckConfigOptions {
  broadcast?: boolean
}

const LEGACY_STORAGE_KEYS = {
  mode: "xiranite.musicDock.mode",
  savedTracks: "xiranite.musicDock.savedTracks",
  sourcePath: "xiranite.musicDock.sourcePath",
  floatingOffset: "xiranite.musicDock.floatingOffset",
  visualizerStyle: "xiranite.musicDock.visualizerStyle",
} as const

const AUDIO_FILE_PATH_PATTERN = /\.(?:flac|mp3|wav|ogg|oga|m4a|aac|opus|webm)$/i

let migrationInFlight: Promise<MelodeckConfig> | null = null

export function loadMelodeckConfig(): Promise<MelodeckConfig> {
  if (migrationInFlight) return migrationInFlight
  migrationInFlight = loadAndMigrateMelodeckConfig().finally(() => {
    migrationInFlight = null
  })
  return migrationInFlight
}

export async function saveMelodeckConfig(
  patch: Partial<MelodeckConfig>,
  options: SaveMelodeckConfigOptions = {},
): Promise<void> {
  await saveNodeConfigToBackend("melodeck", patch)
  if (options.broadcast !== false) dispatchMelodeckConfigChanged()
}

async function loadAndMigrateMelodeckConfig(): Promise<MelodeckConfig> {
  const [{ config: rawNode }, { config: rawAppUi }] = await Promise.all([
    getNodeConfigFromBackend<MelodeckConfig>("melodeck"),
    getAppConfigFromBackend<LegacyAppUiConfig>("ui"),
  ])
  const node = normalizeMelodeckConfig(rawNode)
  const appUi = isRecord(rawAppUi) ? rawAppUi : undefined
  const legacy = readLegacyConfig(appUi?.musicDock)
  const migrated = mergeMissingLegacyConfig(node, legacy)
  const changed = JSON.stringify(migrated) !== JSON.stringify(rawNode ?? {})

  if (changed) await saveNodeConfigToBackend("melodeck", migrated)

  if (appUi && Object.hasOwn(appUi, "musicDock")) {
    const { musicDock: _legacyMusicDock, ...nextAppUi } = appUi
    await saveAppConfigToBackend("ui", nextAppUi)
  }

  if (changed || appUi?.musicDock) clearLegacyStorage()
  if (changed) dispatchMelodeckConfigChanged()
  return migrated
}

function mergeMissingLegacyConfig(node: MelodeckConfig, legacy: LegacyMusicDockConfig): MelodeckConfig {
  const sourcePath = node.source_path ?? legacy.sourcePath
  const volume = normalizeVolume(node.playback?.volume ?? node.volume)
  return {
    ...node,
    config_version: 1,
    player_engine: node.player_engine ?? "folia",
    playback: { ...node.playback, volume },
    library: {
      ...node.library,
      roots: node.library?.roots?.length
        ? node.library.roots
        : sourcePath && !isAudioFilePath(sourcePath) ? [sourcePath] : [],
    },
    surfaces: { ...node.surfaces, mode: node.surfaces?.mode ?? node.mode ?? legacy.mode },
    source_path: sourcePath,
    saved_tracks: node.saved_tracks ?? legacy.savedTracks,
    mode: node.mode ?? legacy.mode,
    floating_offset: node.floating_offset ?? legacy.floatingOffset,
    visualizer_style: node.visualizer_style ?? legacy.visualizerStyle,
  }
}

function normalizeMelodeckConfig(value: unknown): MelodeckConfig {
  if (!isRecord(value)) return {}
  const mode = isMelodeckMode(value.mode) ? value.mode : undefined
  const savedTracks = Array.isArray(value.saved_tracks) ? value.saved_tracks.filter(isPersistedTrack) : undefined
  const floatingOffset = normalizeFloatingOffset(value.floating_offset)
  const visualizerStyle = typeof value.visualizer_style === "string"
    ? normalizeMusicVisualizerStyle(value.visualizer_style)
    : undefined
  return {
    ...value,
    source_path: typeof value.source_path === "string" ? value.source_path : undefined,
    saved_tracks: savedTracks,
    mode,
    floating_offset: floatingOffset,
    visualizer_style: visualizerStyle,
    config_version: value.config_version === 1 ? 1 : undefined,
    player_engine: value.player_engine === "legacy" ? "legacy" : value.player_engine === "folia" ? "folia" : undefined,
    playback: normalizePlayback(value.playback),
    library: normalizeLibrary(value.library),
    surfaces: normalizeSurfaces(value.surfaces),
    visualizer: isRecord(value.visualizer) ? value.visualizer : undefined,
  }
}

function normalizePlayback(value: unknown): MelodeckConfig["playback"] {
  if (!isRecord(value)) return undefined
  return {
    volume: normalizeVolume(value.volume),
    loop_mode: value.loop_mode === "off" || value.loop_mode === "all" || value.loop_mode === "one" || value.loop_mode === "random" ? value.loop_mode : undefined,
    replay_gain_mode: value.replay_gain_mode === "off" || value.replay_gain_mode === "track" || value.replay_gain_mode === "album" ? value.replay_gain_mode : undefined,
    output_device_id: typeof value.output_device_id === "string" ? value.output_device_id : undefined,
    active_track_id: typeof value.active_track_id === "string" && value.active_track_id.trim() ? value.active_track_id : undefined,
  }
}

function normalizeLibrary(value: unknown): MelodeckConfig["library"] {
  if (!isRecord(value)) return undefined
  return {
    roots: Array.isArray(value.roots)
      ? value.roots.filter((root): root is string => typeof root === "string" && Boolean(root.trim()) && !isAudioFilePath(root))
      : undefined,
  }
}

function isAudioFilePath(path: string): boolean {
  return AUDIO_FILE_PATH_PATTERN.test(path.trim())
}

function normalizeSurfaces(value: unknown): MelodeckConfig["surfaces"] {
  if (!isRecord(value)) return undefined
  return {
    mode: isMelodeckMode(value.mode) ? value.mode : undefined,
    collapsed: typeof value.collapsed === "boolean" ? value.collapsed : undefined,
    follow_fullscreen_with_floating: typeof value.follow_fullscreen_with_floating === "boolean"
      ? value.follow_fullscreen_with_floating
      : undefined,
  }
}

function normalizeVolume(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.min(1, Math.max(0, value > 1 ? value / 100 : value))
}

function readLegacyConfig(appConfig: LegacyMusicDockConfig | undefined): LegacyMusicDockConfig {
  if (typeof window === "undefined") return normalizeLegacyConfig(appConfig)
  return normalizeLegacyConfig({
    sourcePath: appConfig?.sourcePath ?? window.localStorage.getItem(LEGACY_STORAGE_KEYS.sourcePath) ?? undefined,
    savedTracks: appConfig?.savedTracks ?? parseJson(window.localStorage.getItem(LEGACY_STORAGE_KEYS.savedTracks)),
    mode: appConfig?.mode ?? window.localStorage.getItem(LEGACY_STORAGE_KEYS.mode) ?? undefined,
    floatingOffset: appConfig?.floatingOffset ?? parseJson(window.localStorage.getItem(LEGACY_STORAGE_KEYS.floatingOffset)),
    visualizerStyle: appConfig?.visualizerStyle ?? window.localStorage.getItem(LEGACY_STORAGE_KEYS.visualizerStyle) ?? undefined,
  })
}

function normalizeLegacyConfig(value: unknown): LegacyMusicDockConfig {
  if (!isRecord(value)) return {}
  return {
    sourcePath: typeof value.sourcePath === "string" ? value.sourcePath : undefined,
    savedTracks: Array.isArray(value.savedTracks) ? value.savedTracks.filter(isPersistedTrack) : undefined,
    mode: isMelodeckMode(value.mode) ? value.mode : undefined,
    floatingOffset: normalizeFloatingOffset(value.floatingOffset),
    visualizerStyle: typeof value.visualizerStyle === "string"
      ? normalizeMusicVisualizerStyle(value.visualizerStyle)
      : undefined,
  }
}

function normalizeFloatingOffset(value: unknown): MelodeckFloatingOffset | undefined {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") return undefined
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return undefined
  return { x: value.x, y: value.y }
}

function isMelodeckMode(value: unknown): value is MelodeckMode {
  return value === "bottom" || value === "floating" || value === "fullscreen"
}

function isPersistedTrack(value: unknown): value is PersistedTrack {
  return isRecord(value) && typeof value.name === "string" && (value.path === undefined || typeof value.path === "string")
}

function parseJson(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function clearLegacyStorage() {
  if (typeof window === "undefined") return
  for (const key of Object.values(LEGACY_STORAGE_KEYS)) window.localStorage.removeItem(key)
}

function dispatchMelodeckConfigChanged() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(MELODECK_CONFIG_CHANGED_EVENT))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const DEFAULT_MELODECK_CONFIG = {
  config_version: 1,
  player_engine: "folia",
  playback: { volume: 0.8, loop_mode: "all", replay_gain_mode: "off" },
  library: { roots: [] },
  surfaces: { mode: "bottom", collapsed: true, follow_fullscreen_with_floating: false },
  mode: "bottom",
  saved_tracks: [],
  source_path: "",
  floating_offset: { x: 0, y: 0 },
  visualizer_style: DEFAULT_MUSIC_VISUALIZER_STYLE,
  volume: 80,
} as const satisfies MelodeckConfig
