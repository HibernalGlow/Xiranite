const NATURAL_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
  usage: "sort",
})

export function compareNaturalPath(left: string, right: string): number {
  const primary = NATURAL_COLLATOR.compare(left.replaceAll("\\", "/"), right.replaceAll("\\", "/"))
  return primary || compareCodePoints(left, right)
}

function compareCodePoints(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}
