import type {
  MelodeckLibraryTrackRecord,
  MelodeckRepository,
  MelodeckTrackMetadataRecord,
} from "@xiranite/repository"
import { stat } from "node:fs/promises"
import path from "node:path"

const MAX_COVER_BYTES = 32 * 1024 * 1024

interface MelodeckMetadataRequest {
  path?: unknown
  title?: unknown
  artist?: unknown
  album?: unknown
  duration?: unknown
  replayGainTrackDb?: unknown
  replayGainAlbumDb?: unknown
  lyrics?: unknown
  lyricsHydrated?: unknown
  cover?: unknown
}

export async function handleMelodeckRequest(
  request: Request,
  url: URL,
  repository: MelodeckRepository,
): Promise<Response | undefined> {
  if (url.pathname === "/melodeck/library" && request.method === "GET") {
    const snapshot = await repository.loadLibrary()
    return Response.json(snapshot)
  }

  if (url.pathname === "/melodeck/library" && request.method === "PUT") {
    const body = await request.json().catch(() => undefined) as { tracks?: unknown } | undefined
    if (!body || !Array.isArray(body.tracks)) {
      return Response.json({ error: "tracks must be an array" }, { status: 400 })
    }
    const tracks = body.tracks.map((track, index) => parseLibraryTrack(track, index))
    await repository.replaceLibrary(dedupeLibraryTracks(tracks), Date.now())
    return new Response(null, { status: 204 })
  }

  if (url.pathname === "/melodeck/metadata" && request.method === "GET") {
    const trackPath = requireQueryPath(url)
    const fingerprint = await readFingerprint(trackPath)
    const metadata = await repository.getMetadata(normalizeMelodeckTrackKey(trackPath))
    if (!metadata || !sameFingerprint(metadata, fingerprint)) {
      return Response.json({ metadata: null })
    }
    return Response.json({ metadata: toMetadataResponse(metadata) })
  }

  if (url.pathname === "/melodeck/metadata" && request.method === "PUT") {
    const body = await request.json().catch(() => undefined) as MelodeckMetadataRequest | undefined
    const trackPath = requireBodyPath(body?.path)
    const fingerprint = await readFingerprint(trackPath)
    const existing = await repository.getMetadata(normalizeMelodeckTrackKey(trackPath))
    const cover = parseCover(body?.cover)
    const preserveCover = body && !("cover" in body) && existing && sameFingerprint(existing, fingerprint)
    const metadata: MelodeckTrackMetadataRecord = {
      key: normalizeMelodeckTrackKey(trackPath),
      path: path.resolve(trackPath),
      fileSize: fingerprint.fileSize,
      lastModified: fingerprint.lastModified,
      title: optionalString(body?.title),
      artist: optionalString(body?.artist),
      album: optionalString(body?.album),
      duration: optionalFiniteNumber(body?.duration),
      replayGainTrackDb: optionalFiniteNumber(body?.replayGainTrackDb),
      replayGainAlbumDb: optionalFiniteNumber(body?.replayGainAlbumDb),
      lyrics: body?.lyrics,
      lyricsHydrated: body?.lyricsHydrated === true,
      coverMimeType: cover?.mimeType ?? (preserveCover ? existing.coverMimeType : undefined),
      coverData: cover?.data ?? (preserveCover ? existing.coverData : undefined),
      updatedAt: Date.now(),
    }
    await repository.saveMetadata(metadata)
    return Response.json({ metadata: toMetadataResponse(metadata) })
  }

  if (url.pathname === "/melodeck/cover" && request.method === "GET") {
    const trackPath = requireQueryPath(url)
    const fingerprint = await readFingerprint(trackPath)
    const metadata = await repository.getMetadata(normalizeMelodeckTrackKey(trackPath))
    if (!metadata || !sameFingerprint(metadata, fingerprint) || !metadata.coverData?.byteLength) {
      return new Response("Melo deck cover was not found.", { status: 404 })
    }
    const etag = `"${metadata.fileSize}-${Math.trunc(metadata.lastModified)}-${metadata.updatedAt}"`
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag } })
    }
    const coverBody = new Uint8Array(metadata.coverData).buffer
    return new Response(coverBody, {
      headers: {
        "cache-control": "private, max-age=3600",
        "content-type": metadata.coverMimeType || "application/octet-stream",
        etag,
      },
    })
  }

  return undefined
}

export function normalizeMelodeckTrackKey(trackPath: string): string {
  const resolved = path.resolve(trackPath).replaceAll("\\", "/")
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved
}

function parseLibraryTrack(value: unknown, sortOrder: number): MelodeckLibraryTrackRecord {
  if (!value || typeof value !== "object") throw badRequest("Each Melo deck track must be an object.")
  const track = value as Record<string, unknown>
  const trackPath = requireBodyPath(track.path)
  const title = requireString(track.title, "title")
  return {
    key: normalizeMelodeckTrackKey(trackPath),
    path: path.resolve(trackPath),
    title,
    artist: optionalString(track.artist),
    fileName: optionalString(track.fileName),
    relativePath: optionalString(track.relativePath),
    fileSize: optionalSafeInteger(track.fileSize),
    lastModified: optionalSafeInteger(track.lastModified),
    mimeType: optionalString(track.mimeType),
    sortOrder,
  }
}

function dedupeLibraryTracks(tracks: MelodeckLibraryTrackRecord[]): MelodeckLibraryTrackRecord[] {
  const unique = new Map<string, MelodeckLibraryTrackRecord>()
  for (const track of tracks) {
    if (!unique.has(track.key)) unique.set(track.key, { ...track, sortOrder: unique.size })
  }
  return [...unique.values()]
}

function toMetadataResponse(metadata: MelodeckTrackMetadataRecord) {
  return {
    path: metadata.path,
    fileSize: metadata.fileSize,
    lastModified: metadata.lastModified,
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    duration: metadata.duration,
    replayGainTrackDb: metadata.replayGainTrackDb,
    replayGainAlbumDb: metadata.replayGainAlbumDb,
    lyrics: metadata.lyrics,
    lyricsHydrated: metadata.lyricsHydrated,
    hasCover: Boolean(metadata.coverData?.byteLength),
    updatedAt: metadata.updatedAt,
  }
}

function parseCover(value: unknown): { mimeType: string; data: Uint8Array } | undefined {
  if (value === null || value === undefined) return undefined
  if (!value || typeof value !== "object") throw badRequest("cover must be null or an encoded cover object.")
  const cover = value as Record<string, unknown>
  const mimeType = requireString(cover.mimeType, "cover.mimeType")
  const base64 = requireString(cover.base64, "cover.base64")
  const data = Uint8Array.from(Buffer.from(base64, "base64"))
  if (!data.byteLength || data.byteLength > MAX_COVER_BYTES) {
    throw badRequest(`cover must contain between 1 and ${MAX_COVER_BYTES} decoded bytes.`)
  }
  return { mimeType, data }
}

async function readFingerprint(trackPath: string): Promise<{ fileSize: number; lastModified: number }> {
  const info = await stat(path.resolve(trackPath))
  if (!info.isFile()) throw badRequest("Melo deck metadata path must identify a file.")
  return { fileSize: Number(info.size), lastModified: Math.trunc(info.mtimeMs) }
}

function sameFingerprint(
  metadata: Pick<MelodeckTrackMetadataRecord, "fileSize" | "lastModified">,
  fingerprint: { fileSize: number; lastModified: number },
): boolean {
  return metadata.fileSize === fingerprint.fileSize
    && Math.trunc(metadata.lastModified) === Math.trunc(fingerprint.lastModified)
}

function requireQueryPath(url: URL): string {
  const trackPath = url.searchParams.get("path")
  if (!trackPath?.trim()) throw badRequest("Missing Melo deck track path.")
  return trackPath
}

function requireBodyPath(value: unknown): string {
  return requireString(value, "path")
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw badRequest(`${field} must be a non-empty string.`)
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function optionalSafeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function badRequest(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 400 })
}
