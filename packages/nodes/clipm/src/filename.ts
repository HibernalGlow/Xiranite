export const CLIPM_FILENAME_SUFFIX_PATTERN = /\s*\[CM(?<version>\d+)(?<label>[PN])(?<score>\d{4})-(?<shortCode>[0-9A-HJKMNP-TV-Z]{4,})\](?=(?:\.[^./\\]+)?$)/u
const LEGACY_CLIPM_FILENAME_SUFFIX_PATTERN = /\s*\[CM-v(?<version>\d+)-(?<label>[PN])-S(?<score>\d{4})\]$/u

export interface ClipmFilenameScore {
  version: bigint
  label: "P" | "N"
  score: number
  shortCode?: string
}

export function parseClipmFilenameScore(value: string): ClipmFilenameScore | undefined {
  const canonicalGroups = CLIPM_FILENAME_SUFFIX_PATTERN.exec(value)?.groups
  if (canonicalGroups) {
    const version = BigInt(canonicalGroups.version!)
    const score = Number(canonicalGroups.score)
    if (version < 1n || score > 1000) return undefined
    return {
      version,
      label: canonicalGroups.label as ClipmFilenameScore["label"],
      score,
      shortCode: canonicalGroups.shortCode,
    }
  }

  const legacyGroups = LEGACY_CLIPM_FILENAME_SUFFIX_PATTERN.exec(value)?.groups
  if (!legacyGroups) return undefined
  const version = BigInt(legacyGroups.version!)
  const score = Number(legacyGroups.score)
  if (version < 1n || score > 1000) return undefined
  return {
    version,
    label: legacyGroups.label as ClipmFilenameScore["label"],
    score,
  }
}

/** Ascending comparison; callers apply their requested sort direction. */
export function compareClipmFilenameScores(left: string, right: string): number {
  const leftScore = parseClipmFilenameScore(left)
  const rightScore = parseClipmFilenameScore(right)
  if (!leftScore || !rightScore) return leftScore ? 1 : rightScore ? -1 : 0
  return labelRank(leftScore.label) - labelRank(rightScore.label)
    || compareBigInt(leftScore.version, rightScore.version)
    || leftScore.score - rightScore.score
}

function labelRank(label: ClipmFilenameScore["label"]): number {
  return label === "P" ? 1 : 0
}

function compareBigInt(left: bigint, right: bigint): number {
  return left === right ? 0 : left < right ? -1 : 1
}
