export const READER_CM_RATING_SUFFIX_PATTERN = /\s*\[CM-v(?<version>\d+)-(?<label>[PN])-S(?<score>\d{4})\]$/u

export interface ReaderCmRating {
  version: bigint
  label: "P" | "N"
  score: number
}

export function parseReaderCmRating(value: string): ReaderCmRating | undefined {
  const groups = READER_CM_RATING_SUFFIX_PATTERN.exec(value)?.groups
  if (!groups) return undefined
  return {
    version: BigInt(groups.version!),
    label: groups.label as ReaderCmRating["label"],
    score: Number(groups.score),
  }
}

/** Ascending comparison; callers apply their requested sort direction. */
export function compareReaderCmRatingNames(left: string, right: string): number {
  const leftRating = parseReaderCmRating(left)
  const rightRating = parseReaderCmRating(right)
  if (!leftRating || !rightRating) return leftRating ? 1 : rightRating ? -1 : 0
  return labelRank(leftRating.label) - labelRank(rightRating.label)
    || compareBigInt(leftRating.version, rightRating.version)
    || leftRating.score - rightRating.score
}

function labelRank(label: ReaderCmRating["label"]): number {
  return label === "P" ? 1 : 0
}

function compareBigInt(left: bigint, right: bigint): number {
  return left === right ? 0 : left < right ? -1 : 1
}
