export interface ArchiveByteRange {
  start: number
  endExclusive?: number
}

export function normalizeArchiveRange(
  range: ArchiveByteRange | undefined,
  length: number,
): { start: number; endExclusive: number } {
  if (!range) return { start: 0, endExclusive: length }
  const start = Math.trunc(range.start)
  const endExclusive = Math.trunc(range.endExclusive ?? length)
  if (start < 0 || start > length || endExclusive < start || endExclusive > length) {
    throw new RangeError(`Invalid archive byte range: ${start}-${endExclusive}/${length}`)
  }
  return { start, endExclusive }
}
