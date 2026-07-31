import { extractArtist, normalizeSameaInput } from "@xiranite/node-samea/core"
import OpenCC from "opencc-js/t2cn"

const sameaArtistInput = normalizeSameaInput({})
const toSimplifiedChinese = OpenCC.Converter({ from: "t", to: "cn" })

export interface ClassfArtistLabelParts {
  label: string
  circle?: string
  artist: string
}

/** Parse a configured keyword with the same canonicalization that SameA uses. */
export function parseSameaArtistLabel(keyword: string): ClassfArtistLabelParts | undefined {
  const source = keyword.trim()
  if (!source) return undefined
  const artist = extractArtist(source.includes("[") ? source : `[${source}]`, sameaArtistInput)
  if (!artist) return undefined
  const content = artist.label.replace(/^\[|\]$/g, "")
  const groupArtist = content.match(/^(.+?)\s*\(([^()]+)\)$/)
  return {
    label: artist.label,
    circle: groupArtist?.[1]?.trim() || undefined,
    artist: groupArtist?.[2]?.trim() ?? content,
  }
}

/** Remove only enclosing square or round brackets, preserving inner artist data. */
export function stripOuterKeywordBrackets(keyword: string): string {
  let value = keyword.trim()
  while ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("(") && value.endsWith(")"))) {
    value = value.slice(1, -1).trim()
  }
  return value
}

/** Split each `[circle (artist)]` label into independently matchable bracketed keywords. */
export function splitSameaArtistAndCircleKeywords(keywords: string[]): string[] {
  return unique(keywords.flatMap((keyword) => {
    const parts = parseSameaArtistLabel(keyword)
    if (!parts) return keyword.trim() ? [keyword.trim()] : []
    return parts.circle ? [`[${parts.circle}]`, `[${parts.artist}]`] : [parts.label]
  }))
}

/** Extract the first SameA artist label from each source name, preserving safe brackets. */
export function extractSameaArtistKeywords(keywords: string[]): string[] {
  return unique(keywords.flatMap((keyword) => parseSameaArtistLabel(keyword)?.label ?? keyword.trim()))
}

/** Append candidate labels without duplicating entries already persisted for ClassF. */
export function mergeClassfBlacklistKeywords(existing: string[], additions: string[]): string[] {
  return unique([...existing, ...additions])
}

/** Normalize both blacklist entries and extracted labels without changing stored config text. */
export function normalizeClassfBlacklistText(value: string): string {
  return toSimplifiedChinese(value).toLocaleLowerCase()
}

export function isClassfBlacklistedArtist(artist: string, keywords: string[]): boolean {
  const parts = parseSameaArtistLabel(artist)
  const labels = [artist, parts?.circle && `[${parts.circle}]`, parts?.artist && `[${parts.artist}]`]
    .filter((label): label is string => Boolean(label))
    .map(normalizeClassfBlacklistText)
  const normalizedKeywords = keywords.map(normalizeClassfBlacklistText).filter(Boolean)
  return normalizedKeywords.some((keyword) => labels.some((label) => label.includes(keyword)))
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
