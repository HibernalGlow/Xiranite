import type { LyricData } from "@hibernalglow/folia-player/parser"
import { localBackendUrl, resolveLocalBackendConfig } from "./localBackendConfig"

export interface MelodeckDatabaseTrack {
  path: string
  title: string
  artist?: string
  fileName?: string
  relativePath?: string
  fileSize?: number
  lastModified?: number
  mimeType?: string
  metadata?: MelodeckDatabaseMetadataSummary
}

export interface MelodeckDatabaseMetadataSummary {
  fileSize: number
  lastModified: number
  title?: string
  artist?: string
  album?: string
  duration?: number
  replayGainTrackDb?: number
  replayGainAlbumDb?: number
  lyricsHydrated: boolean
  hasCover: boolean
  updatedAt: number
}

export interface MelodeckDatabaseMetadata extends MelodeckDatabaseMetadataSummary {
  path: string
  lyrics?: LyricData | null
}

export interface MelodeckDatabaseLibrary {
  initialized: boolean
  tracks: MelodeckDatabaseTrack[]
}

export interface SaveMelodeckMetadataInput {
  path: string
  title?: string
  artist?: string
  album?: string
  duration?: number
  replayGainTrackDb?: number
  replayGainAlbumDb?: number
  lyrics?: LyricData | null
  lyricsHydrated: boolean
  cover?: Blob | null
}

export class MelodeckDatabaseRequestError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string) {
    super(detail || `Melo deck database service returned ${status}.`)
    this.name = "MelodeckDatabaseRequestError"
    this.status = status
    this.detail = detail
  }
}

export function isMelodeckDatabaseMissingFileError(error: unknown): boolean {
  return error instanceof MelodeckDatabaseRequestError
    && error.status === 404
    && /\bENOENT\b/i.test(error.detail)
}

export async function loadMelodeckDatabaseLibrary(signal?: AbortSignal): Promise<MelodeckDatabaseLibrary> {
  const response = await melodeckRequest("/melodeck/library", { signal })
  const body = await response.json() as Partial<MelodeckDatabaseLibrary>
  return {
    initialized: body.initialized === true,
    tracks: Array.isArray(body.tracks) ? body.tracks.filter(isDatabaseTrack) : [],
  }
}

export async function saveMelodeckDatabaseLibrary(
  tracks: readonly Omit<MelodeckDatabaseTrack, "metadata">[],
  signal?: AbortSignal,
): Promise<void> {
  await melodeckRequest("/melodeck/library", {
    method: "PUT",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tracks }),
  })
}

export async function loadMelodeckDatabaseMetadata(
  path: string,
  signal?: AbortSignal,
): Promise<MelodeckDatabaseMetadata | null> {
  const response = await melodeckRequest("/melodeck/metadata", { signal }, { path })
  const body = await response.json() as { metadata?: unknown }
  return isDatabaseMetadata(body.metadata) ? body.metadata : null
}

export async function saveMelodeckDatabaseMetadata(
  input: SaveMelodeckMetadataInput,
  signal?: AbortSignal,
): Promise<MelodeckDatabaseMetadata> {
  const cover = input.cover === undefined
    ? undefined
    : input.cover
      ? {
          mimeType: input.cover.type || "application/octet-stream",
          base64: bytesToBase64(new Uint8Array(await input.cover.arrayBuffer())),
        }
      : null
  const requestBody = { ...input } as Record<string, unknown>
  if (cover !== undefined) requestBody.cover = cover
  const response = await melodeckRequest("/melodeck/metadata", {
    method: "PUT",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  })
  const body = await response.json() as { metadata?: unknown }
  if (!isDatabaseMetadata(body.metadata)) throw new Error("Melo deck metadata service returned an invalid record.")
  return body.metadata
}

export function melodeckDatabaseCoverUrl(path: string): string {
  const config = resolveLocalBackendConfig()
  const url = localBackendUrl("/melodeck/cover", config)
  url.searchParams.set("path", path)
  if (config.token) url.searchParams.set("token", config.token)
  return url.href
}

async function melodeckRequest(
  pathname: string,
  init: RequestInit = {},
  query: Record<string, string> = {},
): Promise<Response> {
  const config = resolveLocalBackendConfig()
  const url = localBackendUrl(pathname, config)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  if (config.token) url.searchParams.set("token", config.token)
  const headers = new Headers(init.headers)
  if (config.token) headers.set("x-xiranite-token", config.token)
  const response = await fetch(url.href, { ...init, cache: "no-store", headers })
  if (response.ok) return response
  const detail = await response.text().catch(() => "")
  throw new MelodeckDatabaseRequestError(response.status, detail)
}

function isDatabaseTrack(value: unknown): value is MelodeckDatabaseTrack {
  if (!value || typeof value !== "object") return false
  const track = value as Partial<MelodeckDatabaseTrack>
  return typeof track.path === "string" && Boolean(track.path)
    && typeof track.title === "string" && Boolean(track.title)
}

function isDatabaseMetadata(value: unknown): value is MelodeckDatabaseMetadata {
  if (!value || typeof value !== "object") return false
  const metadata = value as Partial<MelodeckDatabaseMetadata>
  return typeof metadata.path === "string" && Boolean(metadata.path)
    && typeof metadata.fileSize === "number"
    && typeof metadata.lastModified === "number"
    && typeof metadata.lyricsHydrated === "boolean"
    && typeof metadata.hasCover === "boolean"
    && typeof metadata.updatedAt === "number"
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
