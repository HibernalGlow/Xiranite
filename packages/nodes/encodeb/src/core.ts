import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type EncodebAction = "find" | "preview" | "recover"
export type EncodebStrategy = "replace" | "copy"
export type EncodebEntryType = "file" | "dir"

export interface EncodebInput {
  action?: EncodebAction
  paths?: string[]
  srcEncoding?: string
  dstEncoding?: string
  strategy?: EncodebStrategy
  limit?: number
}

export interface EncodebEntry {
  path: string
  name: string
  type: EncodebEntryType
  rootPath: string
  relativeParts: string[]
  depth: number
  separator?: string
}

export interface EncodebMapping {
  src: string
  dst: string
  type: EncodebEntryType
  depth: number
}

export interface EncodebData {
  mappings: EncodebMapping[]
  matches: string[]
  processed: number
}

export interface EncodebRuntime {
  scanPath: (path: string) => Promise<EncodebEntry[]>
  recoverPath: (path: string, input: Required<EncodebInput>, onEvent: (event: NodeRunEvent) => void) => Promise<string>
  transcodeName?: NameTranscoder
}

export type EncodebResult = NodeRunResult<EncodebData>
export type NameTranscoder = (name: string, srcEncoding: string, dstEncoding: string) => string

export const SUSPICIOUS_CHARS = new Set("╘╙═╝║╧╞╫╔╚┌┐└┘├┤┬┴┼▓█▐▌▀▄╔╦╩╠╬")

export const ENCODEB_PRESETS = {
  cn: { label: "Chinese", srcEncoding: "cp437", dstEncoding: "cp936" },
  jp: { label: "Japanese", srcEncoding: "cp437", dstEncoding: "cp932" },
  kr: { label: "Korean", srcEncoding: "cp437", dstEncoding: "cp949" },
} as const

export function normalizeEncodebInput(input: EncodebInput): Required<EncodebInput> {
  return {
    action: input.action ?? "preview",
    paths: parseEncodebPaths(input.paths),
    srcEncoding: input.srcEncoding ?? "cp437",
    dstEncoding: input.dstEncoding ?? "cp936",
    strategy: input.strategy ?? "replace",
    limit: Math.max(1, Math.trunc(input.limit ?? 200)),
  }
}

export function parseEncodebPaths(textOrPaths: string | string[] | undefined): string[] {
  const values = Array.isArray(textOrPaths) ? textOrPaths : (textOrPaths ?? "").split(/\r?\n/)
  return values.map((path) => path.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
}

export function defaultTranscodeName(name: string): string {
  return name
}

export function isSuspiciousName(name: string): boolean {
  return [...name].some((char) => SUSPICIOUS_CHARS.has(char))
}

export function findSuspicious(entries: EncodebEntry[], limit = 200): EncodebEntry[] {
  const results: EncodebEntry[] = []
  for (const entry of entries) {
    if (isSuspiciousName(entry.name)) {
      results.push(entry)
      if (results.length >= limit) break
    }
  }
  return results
}

export function createEncodebMappings(
  entries: EncodebEntry[],
  input: Pick<Required<EncodebInput>, "srcEncoding" | "dstEncoding" | "limit">,
  transcodeName: NameTranscoder = defaultTranscodeName,
  options: { changedOnly?: boolean; destRoot?: string } = {},
): EncodebMapping[] {
  const changedOnly = options.changedOnly ?? true
  const mappings: EncodebMapping[] = []

  for (const entry of entries) {
    const newParts = entry.relativeParts.map((part) => transcodeName(part, input.srcEncoding, input.dstEncoding))
    const changed = newParts.join("\0") !== entry.relativeParts.join("\0")
    if (changedOnly && !changed) continue

    mappings.push({
      src: entry.path,
      dst: joinPath(options.destRoot ?? entry.rootPath, newParts, entry.separator),
      type: entry.type,
      depth: entry.depth,
    })

    if (changedOnly && mappings.length >= input.limit) break
  }

  return mappings
}

export function sortReplaceMappings(mappings: EncodebMapping[]): EncodebMapping[] {
  return [...mappings].sort((a, b) => b.depth - a.depth || b.src.length - a.src.length)
}

export async function runEncodeb(
  input: EncodebInput,
  runtime: EncodebRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<EncodebResult> {
  const normalized = normalizeEncodebInput(input)
  if (!normalized.paths.length) {
    return { success: false, message: "No valid paths provided.", data: emptyData() }
  }

  if (normalized.action === "recover") {
    let processed = 0
    for (const path of normalized.paths) {
      await runtime.recoverPath(path, normalized, onEvent)
      processed += 1
    }
    return { success: true, message: `Recovery completed, processed ${processed} path(s).`, data: { ...emptyData(), processed } }
  }

  const mappings: EncodebMapping[] = []
  const matches: string[] = []

  for (let index = 0; index < normalized.paths.length; index += 1) {
    const path = normalized.paths[index]
    onEvent({ type: "progress", progress: Math.round((index / normalized.paths.length) * 80), message: `Scanning ${path}` })
    const entries = await runtime.scanPath(path)
    if (normalized.action === "find") {
      matches.push(...findSuspicious(entries, normalized.limit).map((entry) => entry.path))
    } else {
      mappings.push(...createEncodebMappings(entries, normalized, runtime.transcodeName))
    }
  }

  onEvent({ type: "progress", progress: 100, message: "Scan completed." })
  const count = normalized.action === "find" ? matches.length : mappings.length
  return {
    success: true,
    message: `${normalized.action === "find" ? "Find" : "Preview"} completed, ${count} item(s).`,
    data: { mappings, matches, processed: 0 },
  }
}

function joinPath(root: string, parts: string[], separator = root.includes("\\") ? "\\" : "/"): string {
  const trimmedRoot = root.replace(/[\\/]+$/, "")
  return [trimmedRoot, ...parts].filter(Boolean).join(separator)
}

function emptyData(): EncodebData {
  return { mappings: [], matches: [], processed: 0 }
}
