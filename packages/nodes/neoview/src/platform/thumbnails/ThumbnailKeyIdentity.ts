import { clipmStableFilenameIdentity } from "@xiranite/node-clipm/filename"

const STABLE_CLIPM_SUFFIX_PATTERN = /\s\[CM-(?<shortCode>[0-9A-HJKMNP-TV-Z]{4,})\](?=(?:\.[^./\\]+)?$)/u

export function stableThumbnailKey(value: string): string {
  const separator = value.indexOf("::")
  if (separator < 0) return clipmStableFilenameIdentity(value)
  return `${clipmStableFilenameIdentity(value.slice(0, separator))}${value.slice(separator)}`
}

export function legacyThumbnailKeyLikePattern(value: string): string {
  const separator = value.indexOf("::")
  const source = separator < 0 ? value : value.slice(0, separator)
  const archiveTail = separator < 0 ? "" : value.slice(separator)
  const stableSource = clipmStableFilenameIdentity(source)
  const stableSuffix = STABLE_CLIPM_SUFFIX_PATTERN.exec(stableSource)
  if (stableSuffix?.groups?.shortCode && stableSuffix.index !== undefined) {
    const prefix = stableSource.slice(0, stableSuffix.index)
    const extension = stableSource.slice(stableSuffix.index + stableSuffix[0].length)
    return `${escapeSqliteLike(prefix)}%[CM%-${escapeSqliteLike(stableSuffix.groups.shortCode)}]${escapeSqliteLike(extension + archiveTail)}`
  }

  const extension = /(?:\.[^./\\]+)?$/u.exec(stableSource)?.[0] ?? ""
  const prefix = stableSource.slice(0, stableSource.length - extension.length)
  return `${escapeSqliteLike(prefix)}%[CM-v%-%-S____]${escapeSqliteLike(extension + archiveTail)}`
}

export function usesStableClipmThumbnailAlias(value: string): boolean {
  const separator = value.indexOf("::")
  const source = separator < 0 ? value : value.slice(0, separator)
  return STABLE_CLIPM_SUFFIX_PATTERN.test(source)
}

function escapeSqliteLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")
}
