import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type MarkuAction = "run" | "text" | "history" | "undo"
export type MarkuModuleId =
  | "markt"
  | "consecutive_header"
  | "content_dedup"
  | "html2sy_table"
  | "title_convert"
  | "content_replace"
  | "single_orderlist_remover"
  | "image_path_replacer"
  | "t2list"

export interface MarkuInput {
  action?: MarkuAction
  module?: MarkuModuleId | string
  paths?: string[]
  inputText?: string
  input_text?: string
  stepConfig?: Record<string, unknown>
  step_config?: Record<string, unknown>
  recursive?: boolean
  dryRun?: boolean
  dry_run?: boolean
  enableUndo?: boolean
  enable_undo?: boolean
  historyPath?: string
  history_path?: string
  undoId?: string
  undo_id?: string
}

export interface MarkuPathInfo {
  path: string
  exists: boolean
  isFile: boolean
  isDirectory: boolean
}

export interface MarkuDirEntry {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
}

export interface MarkuFileDiff {
  file: string
  diff: string
  changed: boolean
}

export interface MarkuUndoFile {
  path: string
  content: string
}

export interface MarkuUndoRecord {
  id: string
  timestamp: string
  module: string
  summary: string
  files: MarkuUndoFile[]
  undone?: boolean
}

export interface MarkuData {
  filesProcessed: number
  filesChanged: number
  inputText: string
  outputText: string
  diffText: string
  diffs: MarkuFileDiff[]
  history: MarkuUndoRecord[]
  undoId: string
  errors: string[]
}

export interface MarkuRuntime {
  pathInfo: (path: string) => Promise<MarkuPathInfo>
  listDir: (path: string) => Promise<MarkuDirEntry[]>
  readText: (path: string) => Promise<string | null>
  writeText: (path: string, content: string) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  now: () => Date
  randomId: () => string
  defaultHistoryPath: () => string
}

export type MarkuResult = NodeRunResult<MarkuData>

export const MARKU_MODULES: Array<{ id: MarkuModuleId; name: string }> = [
  { id: "markt", name: "Heading/list converter" },
  { id: "consecutive_header", name: "Consecutive heading cleanup" },
  { id: "content_dedup", name: "Content deduplication" },
  { id: "html2sy_table", name: "HTML table to Markdown" },
  { id: "title_convert", name: "Title normalization" },
  { id: "content_replace", name: "Content replacement" },
  { id: "single_orderlist_remover", name: "Single ordered-list remover" },
  { id: "image_path_replacer", name: "Image path replacer" },
  { id: "t2list", name: "Table to list" },
]

export function normalizeMarkuInput(input: MarkuInput): Required<Omit<MarkuInput, "input_text" | "step_config" | "dry_run" | "enable_undo" | "history_path" | "undo_id">> {
  return {
    action: input.action ?? (input.inputText || input.input_text ? "text" : "run"),
    module: input.module ?? "markt",
    paths: uniqueClean(input.paths ?? []),
    inputText: input.inputText ?? input.input_text ?? "",
    stepConfig: input.stepConfig ?? input.step_config ?? {},
    recursive: input.recursive ?? false,
    dryRun: input.dryRun ?? input.dry_run ?? true,
    enableUndo: input.enableUndo ?? input.enable_undo ?? true,
    historyPath: clean(input.historyPath ?? input.history_path),
    undoId: clean(input.undoId ?? input.undo_id),
  }
}

export async function runMarku(
  input: MarkuInput,
  runtime: MarkuRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<MarkuResult> {
  const normalized = normalizeMarkuInput(input)
  try {
    if (normalized.action === "history") return await history(normalized, runtime)
    if (normalized.action === "undo") return await undo(normalized, runtime, onEvent)
    if (!isMarkuModuleId(normalized.module)) return failure(`Unknown module: ${normalized.module}`)

    if (normalized.inputText || normalized.action === "text") {
      const outputText = applyMarkuModule(normalized.module, normalized.inputText, normalized.stepConfig)
      const diffText = createUnifiedDiff(normalized.inputText, outputText, "input.md")
      return success(outputText === normalized.inputText ? "Text processed: no changes." : "Text processed: changed.", {
        filesProcessed: 1,
        filesChanged: outputText === normalized.inputText ? 0 : 1,
        inputText: normalized.inputText,
        outputText,
        diffText,
      })
    }

    if (!normalized.paths.length) return failure("No input paths or text provided.")
    onEvent({ type: "progress", progress: 10, message: "Collecting Markdown files." })
    const files = await collectMarkdownFiles(normalized.paths, normalized.recursive, runtime)
    if (!files.length) return failure("No Markdown files found.")

    const diffs: MarkuFileDiff[] = []
    const originals: MarkuUndoFile[] = []
    let changed = 0
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      onEvent({ type: "progress", progress: 10 + Math.round((index / files.length) * 80), message: runtime.basename(file) })
      const original = await runtime.readText(file)
      if (original === null) continue
      const output = applyMarkuModule(normalized.module, original, normalized.stepConfig)
      const didChange = output !== original
      if (didChange) {
        changed += 1
        originals.push({ path: file, content: original })
        if (!normalized.dryRun) await runtime.writeText(file, output)
      }
      diffs.push({ file, changed: didChange, diff: didChange ? createUnifiedDiff(original, output, runtime.basename(file)) : "" })
    }

    const undoId = normalized.enableUndo && !normalized.dryRun && originals.length
      ? await recordUndo(normalized, originals, runtime)
      : ""

    onEvent({ type: "progress", progress: 100, message: "Marku completed." })
    return success(`Processed ${files.length} file(s), ${changed} changed${normalized.dryRun ? " (dry-run)" : ""}.`, {
      filesProcessed: files.length,
      filesChanged: changed,
      diffs,
      undoId,
    })
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function collectMarkdownFiles(paths: string[], recursive: boolean, runtime: MarkuRuntime): Promise<string[]> {
  const files: string[] = []
  async function visit(path: string) {
    const info = await runtime.pathInfo(path)
    if (!info.exists) return
    if (info.isFile && isMarkdownFile(path)) {
      files.push(info.path)
      return
    }
    if (!info.isDirectory) return
    for (const entry of await runtime.listDir(info.path)) {
      if (entry.isFile && isMarkdownFile(entry.name)) files.push(entry.path)
      else if (entry.isDirectory && recursive) await visit(entry.path)
    }
  }
  for (const path of paths) await visit(path)
  return [...new Set(files)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
}

export function applyMarkuModule(module: MarkuModuleId, text: string, config: Record<string, unknown> = {}): string {
  switch (module) {
    case "markt": return transformMarkt(text, config)
    case "consecutive_header": return transformConsecutiveHeaders(text, config)
    case "content_dedup": return transformContentDedup(text, config)
    case "html2sy_table": return transformHtmlTables(text)
    case "title_convert": return transformTitles(text, config)
    case "content_replace": return transformContentReplace(text, config)
    case "single_orderlist_remover": return transformSingleOrderList(text)
    case "image_path_replacer": return transformImagePaths(text, config)
    case "t2list": return transformTableToList(text)
  }
}

export function createUnifiedDiff(original: string, processed: string, filename = "input.md"): string {
  if (original === processed) return ""
  const originalLines = splitKeepEnd(original)
  const processedLines = splitKeepEnd(processed)
  return [
    `--- a/${filename}\n`,
    `+++ b/${filename}\n`,
    `@@ -1,${originalLines.length} +1,${processedLines.length} @@\n`,
    ...originalLines.map((line) => `-${line}`),
    ...processedLines.map((line) => `+${line}`),
  ].join("")
}

function transformMarkt(text: string, config: Record<string, unknown>): string {
  const mode = stringConfig(config.mode, "h2l")
  const bullet = stringConfig(config.bullet, "- ")
  const indent = numberConfig(config.indent, 2)
  if (mode === "l2h") {
    const startLevel = numberConfig(config.start_level ?? config.startLevel, 1)
    return text.replace(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/gm, (_, spaces: string, _marker: string, title: string) => {
      const level = Math.min(6, startLevel + Math.floor(spaces.length / Math.max(indent, 1)))
      return `${"#".repeat(level)} ${title.trim()}`
    })
  }
  const ordered = booleanConfig(config.ordered, false)
  const counters: number[] = []
  return text.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes: string, title: string) => {
    const level = hashes.length
    const padding = " ".repeat((level - 1) * indent)
    if (ordered) {
      counters[level] = (counters[level] ?? 0) + 1
      counters.length = level + 1
      return `${padding}${counters[level]}. ${title.trim()}`
    }
    return `${padding}${bullet}${title.trim()}`
  })
}

function transformConsecutiveHeaders(text: string, config: Record<string, unknown>): string {
  const mode = stringConfig(config.processing_mode ?? config.mode, "remove")
  const lines = text.split(/\n/)
  const output: string[] = []
  for (const line of lines) {
    const previous = output[output.length - 1] ?? ""
    if (/^#{1,6}\s+/.test(previous) && /^#{1,6}\s+/.test(line)) {
      if (mode === "merge") output[output.length - 1] = `${previous} / ${line.replace(/^#{1,6}\s+/, "").trim()}`
      else if (mode === "keep_first" || mode === "remove") continue
    } else {
      output.push(line)
    }
  }
  return output.join("\n")
}

function transformContentDedup(text: string, config: Record<string, unknown>): string {
  const dedupTitles = booleanConfig(config.dedup_titles ?? config.dedupTitles, true)
  const dedupImages = booleanConfig(config.dedup_images ?? config.dedupImages, true)
  const dedupParagraphs = booleanConfig(config.dedup_paragraphs ?? config.dedupParagraphs, false)
  const seenTitles = new Set<string>()
  const seenImages = new Set<string>()
  const seenParagraphs = new Set<string>()
  const output: string[] = []
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim()
    if (dedupTitles && /^#{1,6}\s+/.test(trimmed)) {
      const key = trimmed.toLowerCase()
      if (seenTitles.has(key)) continue
      seenTitles.add(key)
    }
    if (dedupImages && /^!\[[^\]]*]\([^)]+\)/.test(trimmed)) {
      const key = trimmed.toLowerCase()
      if (seenImages.has(key)) continue
      seenImages.add(key)
    }
    if (dedupParagraphs && trimmed && !/^([#>*\-+]|\d+[.)]|\|)/.test(trimmed)) {
      const key = trimmed.toLowerCase()
      if (seenParagraphs.has(key)) continue
      seenParagraphs.add(key)
    }
    output.push(line)
  }
  return output.join("\n")
}

function transformHtmlTables(text: string): string {
  return text.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((row) => {
      return [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cleanHtml(cell[1]))
    }).filter((row) => row.length)
    if (!rows.length) return table
    const width = Math.max(...rows.map((row) => row.length))
    const normalized = rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => "")])
    const [head, ...body] = normalized
    return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...body.map((row) => `| ${row.join(" | ")} |`)].join("\n")
  })
}

function transformTitles(text: string, config: Record<string, unknown>): string {
  const offset = numberConfig(config.levels ?? config.offset, 0)
  return text.replace(/^(#{1,6})\s*(.+)$/gm, (_, hashes: string, title: string) => {
    const level = Math.min(6, Math.max(1, hashes.length + offset))
    return `${"#".repeat(level)} ${title.trim().replace(/\s+/g, " ")}`
  })
}

function transformContentReplace(text: string, config: Record<string, unknown>): string {
  const patterns = parsePatterns(config.patterns)
  let output = text
  for (const pattern of patterns) {
    if (!pattern.from) continue
    const replacement = pattern.to ?? ""
    output = pattern.regex
      ? output.replace(new RegExp(pattern.from, pattern.flags ?? "g"), replacement)
      : output.split(pattern.from).join(replacement)
  }
  return output
}

function transformSingleOrderList(text: string): string {
  const lines = text.split(/\n/)
  return lines.map((line, index) => {
    if (!/^\s*\d+[.)]\s+/.test(line)) return line
    const prev = lines[index - 1] ?? ""
    const next = lines[index + 1] ?? ""
    if (/^\s*\d+[.)]\s+/.test(prev) || /^\s*\d+[.)]\s+/.test(next)) return line
    return line.replace(/^(\s*)\d+[.)]\s+/, "$1")
  }).join("\n")
}

function transformImagePaths(text: string, config: Record<string, unknown>): string {
  const baseUrl = stringConfig(config.base_url ?? config.baseUrl, "")
  const relativePattern = stringConfig(config.relative_pattern ?? config.relativePattern, "")
  return text.replace(/!\[([^\]]*)]\(([^)]+)\)/g, (_, alt: string, path: string) => {
    let next = path.trim()
    if (relativePattern && next.startsWith(relativePattern)) next = next.slice(relativePattern.length).replace(/^[/\\]+/, "")
    if (baseUrl && !/^[a-z]+:\/\//i.test(next) && !next.startsWith("#")) next = `${baseUrl.replace(/\/$/, "")}/${next.replace(/^[/\\]+/, "")}`
    return `![${alt}](${next})`
  })
}

function transformTableToList(text: string): string {
  const lines = text.split(/\n/)
  const output: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const next = lines[index + 1] ?? ""
    if (isTableRow(line) && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next)) {
      const headers = splitTableRow(line)
      index += 1
      while (isTableRow(lines[index + 1] ?? "")) {
        index += 1
        const values = splitTableRow(lines[index])
        output.push(`- ${headers.map((header, i) => `${header}: ${values[i] ?? ""}`).join("; ")}`)
      }
      continue
    }
    output.push(line)
  }
  return output.join("\n")
}

async function history(input: ReturnType<typeof normalizeMarkuInput>, runtime: MarkuRuntime): Promise<MarkuResult> {
  const records = parseHistory(await runtime.readText(historyPath(input, runtime)))
  return success(`Loaded ${records.length} history record(s).`, { history: records.slice(0, 20) })
}

async function undo(input: ReturnType<typeof normalizeMarkuInput>, runtime: MarkuRuntime, onEvent: (event: NodeRunEvent) => void): Promise<MarkuResult> {
  const path = historyPath(input, runtime)
  const records = parseHistory(await runtime.readText(path))
  const record = input.undoId ? records.find((item) => item.id === input.undoId) : records.find((item) => !item.undone)
  if (!record) return failure(input.undoId ? `Undo record not found: ${input.undoId}` : "No undoable record found.")
  for (let index = 0; index < record.files.length; index += 1) {
    const file = record.files[index]
    onEvent({ type: "progress", progress: Math.round((index / Math.max(record.files.length, 1)) * 100), message: file.path })
    await runtime.writeText(file.path, file.content)
  }
  record.undone = true
  await runtime.writeText(path, `${JSON.stringify(records, null, 2)}\n`)
  return success(`Undo completed: ${record.files.length} file(s).`, { history: records, undoId: record.id })
}

async function recordUndo(input: ReturnType<typeof normalizeMarkuInput>, files: MarkuUndoFile[], runtime: MarkuRuntime): Promise<string> {
  const path = historyPath(input, runtime)
  const records = parseHistory(await runtime.readText(path))
  const record: MarkuUndoRecord = {
    id: runtime.randomId(),
    timestamp: runtime.now().toISOString(),
    module: String(input.module),
    summary: `marku ${input.module}: ${files.length} file(s)`,
    files,
  }
  records.unshift(record)
  await runtime.writeText(path, `${JSON.stringify(records.slice(0, 100), null, 2)}\n`)
  return record.id
}

function historyPath(input: ReturnType<typeof normalizeMarkuInput>, runtime: MarkuRuntime): string {
  return input.historyPath || runtime.defaultHistoryPath()
}

function parseHistory(content: string | null): MarkuUndoRecord[] {
  if (!content?.trim()) return []
  try {
    const parsed = JSON.parse(content) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is MarkuUndoRecord => Boolean(item && typeof item === "object" && typeof (item as MarkuUndoRecord).id === "string" && Array.isArray((item as MarkuUndoRecord).files)))
  } catch {
    return []
  }
}

function parsePatterns(value: unknown): Array<{ from: string; to?: string; regex?: boolean; flags?: string }> {
  if (Array.isArray(value)) return value.filter(isPattern)
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? parsed.filter(isPattern) : []
    } catch {
      return []
    }
  }
  return []
}

function isPattern(value: unknown): value is { from: string; to?: string; regex?: boolean; flags?: string } {
  return Boolean(value && typeof value === "object" && typeof (value as { from?: unknown }).from === "string")
}

function splitKeepEnd(text: string): string[] {
  if (!text) return []
  const matches = text.match(/.*(?:\n|$)/g) ?? []
  return matches.filter((line) => line.length).map((line) => line.endsWith("\n") ? line : `${line}\n`)
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim())
}

function isTableRow(line: string): boolean {
  return /^\s*\|.+\|\s*$/.test(line)
}

function cleanHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
}

function isMarkdownFile(path: string): boolean {
  return /\.(md|markdown|mdown)$/i.test(path)
}

function isMarkuModuleId(value: string): value is MarkuModuleId {
  return MARKU_MODULES.some((item) => item.id === value)
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

function uniqueClean(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

function data(partial: Partial<MarkuData>): MarkuData {
  return {
    filesProcessed: 0,
    filesChanged: 0,
    inputText: "",
    outputText: "",
    diffText: "",
    diffs: [],
    history: [],
    undoId: "",
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<MarkuData>): MarkuResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): MarkuResult {
  return { success: false, message, data: data({ errors: [message] }) }
}
