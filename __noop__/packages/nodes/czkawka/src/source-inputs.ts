export function parseCzkawkaList(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map((item) => clean(String(item))).filter(Boolean))
  return unique(String(value ?? "").replace(/[\u2068\u2069]/g, "").split(/\r?\n|,|;/).map(clean).filter(Boolean))
}

export function serializeCzkawkaPaths(paths: readonly string[]): string {
  return unique(paths.map(clean).filter(Boolean)).join("\n")
}

export function addCzkawkaPaths(current: unknown, additions: unknown, prepend = true): string[] {
  const existing = parseCzkawkaList(current)
  const added = parseCzkawkaList(additions)
  return unique(prepend ? [...added, ...existing] : [...existing, ...added])
}

export function addCzkawkaPathsWithReferences(current: unknown, references: unknown, additions: unknown, referenceKeywords: unknown): { paths: string[]; references: string[] } {
  const existing = parseCzkawkaList(current)
  const paths = addCzkawkaPaths(existing, additions)
  const added = new Set(paths.filter((path) => !existing.includes(path)))
  const keywords = parseCzkawkaList(referenceKeywords)
  const nextReferences = new Set(reconcileCzkawkaReferences(paths, references))
  for (const path of added) if (keywords.some((keyword) => path.includes(keyword))) nextReferences.add(path)
  return { paths, references: paths.filter((path) => nextReferences.has(path)) }
}

export function removeCzkawkaPaths(current: unknown, removed: Iterable<string>): string[] {
  const rejected = new Set(removed)
  return parseCzkawkaList(current).filter((path) => !rejected.has(path))
}

export function reconcileCzkawkaReferences(included: unknown, references: unknown): string[] {
  const allowed = new Set(parseCzkawkaList(included))
  return parseCzkawkaList(references).filter((path) => allowed.has(path))
}

export function toggleCzkawkaReference(included: unknown, references: unknown, path: string): string[] {
  const allowed = parseCzkawkaList(included)
  if (!allowed.includes(path)) return reconcileCzkawkaReferences(allowed, references)
  const selected = new Set(reconcileCzkawkaReferences(allowed, references))
  if (selected.has(path)) selected.delete(path)
  else selected.add(path)
  return allowed.filter((candidate) => selected.has(candidate))
}

export function setAllCzkawkaReferences(included: unknown, checked: boolean): string[] {
  return checked ? parseCzkawkaList(included) : []
}

export function parseCzkawkaExtensionTokens(value: unknown): string[] {
  return unique(parseCzkawkaList(value).map((token) => token.startsWith(".") ? token.slice(1) : token).filter(Boolean))
}

export function serializeCzkawkaExtensionTokens(tokens: readonly string[]): string {
  return unique(tokens.map((token) => clean(token).replace(/^\./, "")).filter(Boolean)).join(",")
}

export function isValidCzkawkaExtensionToken(token: string): boolean {
  const value = token.replace(/^\./, "")
  return Boolean(value) && !value.includes(".") && !/\s/.test(value)
}

export function isValidCzkawkaExcludedItem(rule: string): boolean {
  return rule === "DEFAULT" || rule.includes("*")
}

function clean(value: string): string {
  const trimmed = value.replace(/[\u2068\u2069]/g, "").trim()
  return trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1 ? trimmed.slice(1, -1) : trimmed
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
