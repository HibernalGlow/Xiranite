import {
  applyMarkuMarkdownEdits,
  collectMarkuAtxHeadings,
  collectMarkuImages,
  collectMarkuMarkdownBlocks,
  rangeWithTrailingLineBreak,
} from "./markdown-ast.js"

export function transformMarkt(text: string, config: Record<string, unknown>): string {
  const mode = stringConfig(config.mode, "h2l")
  const bullet = stringConfig(config.bullet, "- ")
  const indent = numberConfig(config.indent, 2)
  if (mode === "l2h") return transformListLinesToHeadings(text, indent, numberConfig(config.start_level ?? config.startLevel, 1))

  const ordered = booleanConfig(config.ordered, false)
  const counters: number[] = []
  const edits = collectMarkuAtxHeadings(text).flatMap((heading) => {
    const parsed = parseAtxHeading(heading.source)
    if (!parsed) return []
    const padding = " ".repeat((parsed.level - 1) * indent)
    if (ordered) {
      counters[parsed.level] = (counters[parsed.level] ?? 0) + 1
      counters.length = parsed.level + 1
      return [{ start: heading.start, end: heading.end, replacement: `${padding}${counters[parsed.level]}. ${parsed.title}` }]
    }
    return [{ start: heading.start, end: heading.end, replacement: `${padding}${bullet}${parsed.title}` }]
  })
  return applyMarkuMarkdownEdits(text, edits)
}

export function transformContentDedup(text: string, config: Record<string, unknown>): string {
  const enabled = {
    heading: booleanConfig(config.dedup_titles ?? config.dedupTitles, true),
    image: booleanConfig(config.dedup_images ?? config.dedupImages, true),
    paragraph: booleanConfig(config.dedup_paragraphs ?? config.dedupParagraphs, false),
  }
  const seen = new Map<keyof typeof enabled, Set<string>>([
    ["heading", new Set()],
    ["image", new Set()],
    ["paragraph", new Set()],
  ])
  const removals = collectMarkuMarkdownBlocks(text).flatMap((block) => {
    if (!enabled[block.kind]) return []
    const key = block.source.trim().toLowerCase()
    const values = seen.get(block.kind)!
    if (values.has(key)) return [rangeWithTrailingLineBreak(text, block)]
    values.add(key)
    return []
  })
  return applyMarkuMarkdownEdits(text, removals)
}

export function transformTitles(text: string, config: Record<string, unknown>): string {
  const offset = numberConfig(config.levels ?? config.offset, 0)
  const edits = collectMarkuAtxHeadings(text).flatMap((heading) => {
    const parsed = parseAtxHeading(heading.source)
    if (!parsed) return []
    const level = Math.min(6, Math.max(1, parsed.level + offset))
    return [{ start: heading.start, end: heading.end, replacement: `${"#".repeat(level)} ${parsed.title.replace(/\s+/g, " ")}` }]
  })
  return applyMarkuMarkdownEdits(text, edits)
}

export function transformImagePaths(text: string, config: Record<string, unknown>): string {
  const baseUrl = stringConfig(config.base_url ?? config.baseUrl, "")
  const relativePattern = stringConfig(config.relative_pattern ?? config.relativePattern, "")
  const edits = collectMarkuImages(text).flatMap((image) => {
    const match = /^!\[([^\]]*)]\(([^)]+)\)$/.exec(image.source)
    if (!match) return []
    let next = match[2]!.trim()
    if (relativePattern && next.startsWith(relativePattern)) next = next.slice(relativePattern.length).replace(/^[/\\]+/, "")
    if (baseUrl && !/^[a-z]+:\/\//i.test(next) && !next.startsWith("#")) next = `${baseUrl.replace(/\/$/, "")}/${next.replace(/^[/\\]+/, "")}`
    return [{ start: image.start, end: image.end, replacement: `![${match[1]}](${next})` }]
  })
  return applyMarkuMarkdownEdits(text, edits)
}

function transformListLinesToHeadings(text: string, indent: number, startLevel: number): string {
  return text.replace(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/gm, (_, spaces: string, _marker: string, title: string) => {
    const level = Math.min(6, startLevel + Math.floor(spaces.length / Math.max(indent, 1)))
    return `${"#".repeat(level)} ${title.trim()}`
  })
}

function parseAtxHeading(source: string): { level: number; title: string } | undefined {
  const match = /^(?: {0,3})(#{1,6})\s+(.+)$/.exec(source)
  return match ? { level: match[1]!.length, title: match[2]!.trim() } : undefined
}

function stringConfig(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function numberConfig(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function booleanConfig(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}
