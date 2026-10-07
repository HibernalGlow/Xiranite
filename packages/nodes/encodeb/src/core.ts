import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { createEncodebMappings } from "./mappings.js"

export type EncodebAction = "find" | "preview" | "recover"
export type EncodebStrategy = "replace" | "copy"
export type EncodebEntryType = "file" | "dir"
export type EncodebTransform = "auto" | "recode" | "decode-hash-u" | "normalize-middle-dot"

export interface EncodebInput {
  action?: EncodebAction
  paths?: string[]
  srcEncoding?: string
  dstEncoding?: string
  transform?: EncodebTransform
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
export type NameTranscoder = (name: string, srcEncoding: string, dstEncoding: string, transform?: EncodebTransform) => string

export const SUSPICIOUS_CHARS = new Set("╘╙═╝║╧╞╫╔╚┌┐└┘├┤┬┴┼▓█▐▌▀▄╔╦╩╠╬")

/** The preset table lives in `presets.ts` and is forwarded here: `interaction.ts`, which `cli.ts` loads, reads it
 * from that module instead of value-importing core, because a core value import evaluates the whole engine in the
 * face process (ADR-0074 §5). The name the host bundle and `./core.js` consumers use is unchanged. */
export { ENCODEB_PRESETS } from "./presets.js"

export function normalizeEncodebInput(input: EncodebInput): Required<EncodebInput> {
  return {
    action: input.action ?? "preview",
    paths: parseEncodebPaths(input.paths),
    srcEncoding: input.srcEncoding ?? "cp437",
    dstEncoding: input.dstEncoding ?? "cp936",
    transform: input.transform ?? "recode",
    strategy: input.strategy ?? "replace",
    limit: Math.max(1, Math.trunc(input.limit ?? 200)),
  }
}

export function parseEncodebPaths(textOrPaths: string | string[] | undefined): string[] {
  const values = Array.isArray(textOrPaths) ? textOrPaths : (textOrPaths ?? "").split(/\r?\n/)
  return values.map((path) => path.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
}

export function isSuspiciousName(name: string): boolean {
  return [...name].some((char) => SUSPICIOUS_CHARS.has(char))
    || /#U[0-9a-fA-F]{4,6}/.test(name)
    || /[ÃÂâã]\S/.test(name)
    || /[僋儖儞僗僥僼傾偺丄]/.test(name)
    || ([...name].filter((char) => /[éâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥ƒáíóúñÑªº¿]/u.test(char)).length >= 2)
    || name.includes("\ufffd")
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

/** The mapping builder, its fallback transcoder and the rename order live in `mappings.ts`; `runEncodeb` below
 * imports the builder from there and the three names are forwarded, so `platform.ts` — loaded by `cli.ts` —
 * reaches them without a core value import (ADR-0074 §5). One definition, unchanged public names. */
export { createEncodebMappings, defaultTranscodeName, sortReplaceMappings } from "./mappings.js"

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

function emptyData(): EncodebData {
  return { mappings: [], matches: [], processed: 0 }
}
