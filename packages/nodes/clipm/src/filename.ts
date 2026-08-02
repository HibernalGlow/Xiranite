export const CLIPM_FILENAME_SUFFIX_PATTERN = /\s*\[CM(?<version>\d+)(?<label>[PN])(?<score>\d{4})-(?<shortCode>[0-9A-HJKMNP-TV-Z]{4,})\](?=(?:\.[^./\\]+)?$)/u
const LEGACY_CLIPM_FILENAME_SUFFIX_PATTERN = /\s*\[CM-v(?<version>\d+)-(?<label>[PN])-S(?<score>\d{4})\](?=(?:\.[^./\\]+)?$)/u

export interface ClipmFilenameScore {
  version: bigint
  label: "P" | "N"
  score: number
  shortCode?: string
}

export type ClipmPortableScore = Pick<ClipmFilenameScore, "label" | "score" | "shortCode"> & {
  version: bigint | number
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

/** Keeps only the stable short code from a valid portable score block. */
export function clipmStableFilenameIdentity(value: string): string {
  const score = parseClipmFilenameScore(value)
  if (!score) return value
  const pattern = score.shortCode ? CLIPM_FILENAME_SUFFIX_PATTERN : LEGACY_CLIPM_FILENAME_SUFFIX_PATTERN
  return value.replace(pattern, score.shortCode ? ` [CM-${score.shortCode}]` : "")
}

/** Ascending comparison; callers apply their requested sort direction. */
export function compareClipmFilenameScores(left: string, right: string): number {
  return compareClipmPortableScores(parseClipmFilenameScore(left), parseClipmFilenameScore(right))
}

export function compareClipmPortableScores(
  leftScore: ClipmPortableScore | undefined,
  rightScore: ClipmPortableScore | undefined,
): number {
  if (!leftScore || !rightScore) return leftScore ? 1 : rightScore ? -1 : 0
  return labelRank(leftScore.label) - labelRank(rightScore.label)
    || compareBigInt(BigInt(leftScore.version), BigInt(rightScore.version))
    || leftScore.score - rightScore.score
}

function labelRank(label: ClipmFilenameScore["label"]): number {
  return label === "P" ? 1 : 0
}

function compareBigInt(left: bigint, right: bigint): number {
  return left === right ? 0 : left < right ? -1 : 1
}
