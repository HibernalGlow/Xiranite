import { localBackendFileUrl, resolveLocalBackendConfig } from "./localBackendConfig"

export interface LocalFileEntry {
  name: string
  path: string
  isDirectory: boolean
  sizeBytes: number
  lastModified: number
  type: string
}

export interface LocalAudioTrack {
  name: string
  writer?: string
  fileName: string
  path: string
  relativePath?: string
  size?: number
  type?: string
  src: string
}

const AUDIO_EXTENSIONS = [".flac", ".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".opus", ".webm"]

export async function resolveLocalAudioTracks(sourcePath: string): Promise<LocalAudioTrack[]> {
  const trimmed = sourcePath.trim()
  if (!trimmed) return []

  const entries = await listLocalFiles(trimmed, {
    recursive: true,
    extensions: AUDIO_EXTENSIONS,
    limit: 5000,
  })

  return entries
    .filter((entry) => !entry.isDirectory && isSupportedAudioPath(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }))
    .map((entry) => {
      const metadata = parseTrackPathMetadata(entry.path, trimmed)
      return {
        ...metadata,
        path: entry.path,
        size: entry.sizeBytes,
        type: entry.type || inferMimeType(entry.path),
        src: localBackendFileUrl(entry.path),
      }
    })
}

export async function listLocalFiles(
  sourcePath: string,
  options: {
    recursive?: boolean
    extensions?: string[]
    limit?: number
  } = {},
): Promise<LocalFileEntry[]> {
  const config = resolveLocalBackendConfig()
  const url = new URL("/local-files/list", config.baseUrl)
  url.searchParams.set("path", sourcePath)
  if (options.recursive) url.searchParams.set("recursive", "1")
  if (options.extensions?.length) url.searchParams.set("extensions", options.extensions.join(","))
  if (options.limit) url.searchParams.set("limit", String(options.limit))
  if (config.token) url.searchParams.set("token", config.token)

  const response = await fetch(url.href, {
    cache: "no-store",
    headers: config.token ? { "x-xiranite-token": config.token } : undefined,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(text || `Local file service returned ${response.status}.`)
  }

  const body = await response.json() as { entries?: LocalFileEntry[] }
  return Array.isArray(body.entries) ? body.entries : []
}

export async function pickLocalPaths(kind: "files" | "directory"): Promise<string[]> {
  const config = resolveLocalBackendConfig()
  const url = new URL("/local-files/pick", config.baseUrl)
  if (config.token) url.searchParams.set("token", config.token)
  const response = await fetch(url.href, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(config.token && { "x-xiranite-token": config.token }) },
    body: JSON.stringify({ kind }),
  })
  if (!response.ok) throw new Error(await response.text().catch(() => `Native picker returned ${response.status}.`))
  const body = await response.json() as { paths?: unknown }
  return Array.isArray(body.paths) ? body.paths.filter((path): path is string => typeof path === "string" && Boolean(path.trim())) : []
}

export function isSupportedAudioPath(filePath: string): boolean {
  return AUDIO_EXTENSIONS.some((extension) => filePath.toLowerCase().endsWith(extension))
}

function parseTrackPathMetadata(filePath: string, rootPath: string): Omit<LocalAudioTrack, "path" | "src" | "size" | "type"> {
  const normalizedPath = filePath.replace(/\\/g, "/")
  const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/+$/, "")
  const fileName = normalizedPath.split("/").pop() ?? filePath
  const baseName = fileName.replace(/\.[^.]+$/, "")
  const [namePart, writerPart] = baseName.split(/\s+-\s+/, 2)
  const relativePath = normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : undefined

  return {
    name: (namePart || baseName).trim(),
    writer: writerPart?.trim() || inferWriterFromPath(relativePath ?? normalizedPath),
    fileName,
    relativePath,
  }
}

function inferWriterFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : undefined
}

function inferMimeType(filePath: string): string | undefined {
  const extension = filePath.toLowerCase().split(".").pop()
  switch (extension) {
    case "flac":
      return "audio/flac"
    case "mp3":
      return "audio/mpeg"
    case "wav":
      return "audio/wav"
    case "ogg":
    case "oga":
      return "audio/ogg"
    case "m4a":
      return "audio/mp4"
    case "aac":
      return "audio/aac"
    case "opus":
      return "audio/opus"
    case "webm":
      return "audio/webm"
    default:
      return undefined
  }
}
