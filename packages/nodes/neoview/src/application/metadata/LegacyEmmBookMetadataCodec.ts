export interface ReaderBookEmmMetadata {
  translatedTitle?: string
  tags: readonly ReaderBookEmmTag[]
}

export interface ReaderBookEmmTag {
  namespace: string
  tag: string
  translatedLabel?: string
}

const MAX_TRANSLATED_TITLE_LENGTH = 4_096
const MAX_TAGS = 256
const MAX_NAMESPACE_LENGTH = 128
const MAX_TAG_LENGTH = 256

export function parseLegacyEmmBookMetadata(
  value: string | undefined,
  manualTagsValue?: string,
): ReaderBookEmmMetadata | undefined {
  const parsed = parseRecord(value)
  const manualTags = parseArray(manualTagsValue)
  if (!parsed && !manualTags) return undefined
  const translatedTitle = boundedText(parsed?.translated_title, MAX_TRANSLATED_TITLE_LENGTH)
  const tags: ReaderBookEmmTag[] = []
  const identities = new Set<string>()
  appendTags(tags, identities, parsed?.tags)
  appendTags(tags, identities, manualTags)
  return { ...(translatedTitle ? { translatedTitle } : {}), tags }
}

export function legacyEmmBookPathKey(path: string): string {
  let normalized = path.replaceAll("/", "\\")
  normalized = normalized.replace(/^([a-zA-Z]):(?!\\)/, "$1:\\")
  if (normalized.length > 3 && normalized.endsWith("\\")) normalized = normalized.slice(0, -1)
  return normalized
}

function appendTags(output: ReaderBookEmmTag[], identities: Set<string>, value: unknown): void {
  if (output.length >= MAX_TAGS) return
  if (Array.isArray(value)) {
    for (const item of value) {
      if (output.length >= MAX_TAGS) return
      if (typeof item === "string") appendTag(output, identities, "other", item)
      else if (isRecord(item)) appendTag(output, identities, item.namespace ?? item.category, item.tag)
    }
    return
  }
  if (!isRecord(value)) return
  for (const [namespace, tags] of Object.entries(value)) {
    if (!Array.isArray(tags)) continue
    for (const tag of tags) {
      if (output.length >= MAX_TAGS) return
      appendTag(output, identities, namespace, tag)
    }
  }
}

function appendTag(output: ReaderBookEmmTag[], identities: Set<string>, namespaceValue: unknown, tagValue: unknown): void {
  const namespace = boundedText(namespaceValue, MAX_NAMESPACE_LENGTH)
  const tag = boundedText(tagValue, MAX_TAG_LENGTH)
  if (!namespace || !tag) return
  const identity = `${namespace.normalize("NFKC").toLocaleLowerCase()}\0${tag.normalize("NFKC").toLocaleLowerCase()}`
  if (identities.has(identity)) return
  identities.add(identity)
  output.push({ namespace, tag })
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : undefined
}

function parseRecord(value: string | undefined): Record<string, unknown> | undefined {
  const parsed = parseJson(value)
  return isRecord(parsed) ? parsed : undefined
}

function parseArray(value: string | undefined): unknown[] | undefined {
  const parsed = parseJson(value)
  return Array.isArray(parsed) ? parsed : undefined
}

function parseJson(value: string | undefined): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
