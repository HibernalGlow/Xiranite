import type { PageMediaKind } from "./page.js"

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jxl: "image/jxl",
  jpg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
}

const VIDEO_MIME_TYPES: Readonly<Record<string, string>> = {
  "3g2": "video/3gpp2",
  "3gp": "video/3gpp",
  avi: "video/x-msvideo",
  flv: "video/x-flv",
  m4v: "video/x-m4v",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  nov: "video/mp4",
  ogg: "video/ogg",
  ogv: "video/ogg",
  webm: "video/webm",
  wmv: "video/x-ms-wmv",
}

export const DEFAULT_READER_IMAGE_FORMATS = Object.freeze(Object.keys(IMAGE_MIME_TYPES))
export const DEFAULT_READER_VIDEO_FORMATS = Object.freeze(Object.keys(VIDEO_MIME_TYPES))

export interface ReaderMediaFormatRegistryOptions {
  supportedImageFormats?: readonly string[]
  videoFormats?: readonly string[]
  mediaMimeTypes?: Readonly<Record<string, string>>
}

export interface ReaderMediaTypeResolver {
  readonly revision?: number
  resolve(path: string): PageMediaType | undefined
  supports(path: string): boolean
}

export interface PageMediaType {
  kind: PageMediaKind
  mimeType: string
}

export class ReaderMediaFormatRegistry {
  readonly #formats: ReadonlyMap<string, PageMediaType>
  readonly supportedImageFormats: readonly string[]
  readonly videoFormats: readonly string[]
  readonly mediaMimeTypes: Readonly<Record<string, string>>

  constructor(options: ReaderMediaFormatRegistryOptions = {}) {
    const imageFormats = normalizeFormatList(options.supportedImageFormats ?? DEFAULT_READER_IMAGE_FORMATS, "image formats")
    const videoFormats = normalizeFormatList(options.videoFormats ?? DEFAULT_READER_VIDEO_FORMATS, "video formats")
    const overlaps = imageFormats.filter((extension) => videoFormats.includes(extension))
    if (overlaps.length) throw new Error(`Media extensions cannot be both image and video formats: ${overlaps.join(", ")}.`)
    const overrides = normalizeMimeOverrides(options.mediaMimeTypes ?? {})
    const configured = new Set([...imageFormats, ...videoFormats])
    for (const extension of overrides.keys()) {
      if (!configured.has(extension)) throw new Error(`MIME override .${extension} is not present in the configured media formats.`)
    }
    const formats = new Map<string, PageMediaType>()
    for (const extension of imageFormats) {
      const mimeType = overrides.get(extension) ?? IMAGE_MIME_TYPES[extension]
      if (!mimeType) throw new Error(`Custom image extension .${extension} requires an explicit image/* MIME override.`)
      if (!mimeType.startsWith("image/")) throw new Error(`Image extension .${extension} requires an image/* MIME type.`)
      formats.set(extension, { kind: mimeType === "image/gif" ? "animated-image" : "image", mimeType })
    }
    for (const extension of videoFormats) {
      const mimeType = overrides.get(extension) ?? VIDEO_MIME_TYPES[extension]
      if (!mimeType) throw new Error(`Custom video extension .${extension} requires an explicit video/* MIME override.`)
      if (!mimeType.startsWith("video/")) throw new Error(`Video extension .${extension} requires a video/* MIME type.`)
      formats.set(extension, { kind: "video", mimeType })
    }
    this.supportedImageFormats = Object.freeze(imageFormats)
    this.videoFormats = Object.freeze(videoFormats)
    this.mediaMimeTypes = Object.freeze(Object.fromEntries(overrides))
    this.#formats = formats
  }

  resolve(path: string): PageMediaType | undefined {
    return this.#formats.get(pathExtension(path))
  }

  supports(path: string): boolean {
    return this.resolve(path) !== undefined
  }
}

export class ReaderMediaFormatRegistryRef implements ReaderMediaTypeResolver {
  #current: ReaderMediaFormatRegistry
  #revision = 0

  get revision(): number { return this.#revision }

  constructor(options: ReaderMediaFormatRegistryOptions = {}) {
    this.#current = new ReaderMediaFormatRegistry(options)
  }

  replace(options: ReaderMediaFormatRegistryOptions): void {
    this.#current = new ReaderMediaFormatRegistry(options)
    this.#revision += 1
  }

  resolve(path: string): PageMediaType | undefined {
    return this.#current.resolve(path)
  }

  supports(path: string): boolean {
    return this.#current.supports(path)
  }
}

export const DEFAULT_READER_MEDIA_FORMAT_REGISTRY = new ReaderMediaFormatRegistry()

export function pageMediaType(
  path: string,
  registry: ReaderMediaTypeResolver = DEFAULT_READER_MEDIA_FORMAT_REGISTRY,
): PageMediaType | undefined {
  return registry.resolve(path)
}

export function pathExtension(path: string): string {
  const filename = path.replaceAll("\\", "/").split("/").at(-1) ?? ""
  const index = filename.lastIndexOf(".")
  return index > 0 ? filename.slice(index + 1).toLowerCase() : ""
}

function normalizeFormatList(values: readonly string[], label: string): string[] {
  if (!Array.isArray(values) || values.length > 128) throw new Error(`${label} must contain at most 128 extensions.`)
  const output: string[] = []
  for (const value of values) {
    if (typeof value !== "string") throw new Error(`${label} must contain only strings.`)
    const extension = value.trim().replace(/^\.+/u, "").toLowerCase()
    if (!/^[a-z0-9][a-z0-9+_-]{0,15}$/u.test(extension)) {
      throw new Error(`${label} contains an invalid extension: ${value}.`)
    }
    if (!output.includes(extension)) output.push(extension)
  }
  return output
}

function normalizeMimeOverrides(values: Readonly<Record<string, string>>): Map<string, string> {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Media MIME overrides must be an object.")
  const entries = Object.entries(values)
  if (entries.length > 128) throw new Error("Media MIME overrides must contain at most 128 entries.")
  const output = new Map<string, string>()
  for (const [rawExtension, rawMimeType] of entries) {
    const [extension] = normalizeFormatList([rawExtension], "media MIME overrides")
    if (typeof rawMimeType !== "string") throw new Error(`MIME override .${extension} must be a string.`)
    const mimeType = rawMimeType.trim().toLowerCase()
    if (!/^(?:image|video)\/[a-z0-9][a-z0-9!#$&^_.+\-]{0,126}$/u.test(mimeType)) {
      throw new Error(`MIME override .${extension} must be a valid image/* or video/* media type.`)
    }
    output.set(extension!, mimeType)
  }
  return output
}
