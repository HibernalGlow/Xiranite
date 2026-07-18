export interface ReaderBookEmmMetadata {
  translatedTitle?: string
}

const MAX_TRANSLATED_TITLE_LENGTH = 4_096

export function parseLegacyEmmBookMetadata(value: string | undefined): ReaderBookEmmMetadata | undefined {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    const translatedTitle = (parsed as Record<string, unknown>).translated_title
    if (typeof translatedTitle !== "string") return undefined
    const normalized = translatedTitle.trim()
    if (!normalized || normalized.length > MAX_TRANSLATED_TITLE_LENGTH) return undefined
    return { translatedTitle: normalized }
  } catch {
    return undefined
  }
}

export function legacyEmmBookPathKey(path: string): string {
  let normalized = path.replaceAll("/", "\\")
  normalized = normalized.replace(/^([a-zA-Z]):(?!\\)/, "$1:\\")
  if (normalized.length > 3 && normalized.endsWith("\\")) normalized = normalized.slice(0, -1)
  return normalized
}
