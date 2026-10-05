import { hostCapabilities, type ExecResult } from "@xiranite/host-capabilities"
import { basename, dirname, extname, join, resolve } from "node:path"
import { analyse, type Match } from "chardet"
import * as iconv from "iconv-lite"
import type { EncodebEntry, EncodebInput, EncodebMapping, EncodebRuntime, NameTranscoder } from "./core.js"
import { createEncodebMappings, sortReplaceMappings } from "./core.js"

/**
 * encodeb's machine half, through the host capability surface (ADR-0078). The transcoding below it — chardet,
 * iconv-lite, the mojibake scoring — is pure text work and stays exactly where it was.
 *
 * The parent-directory ensure before a replace stays explicit: `fs.move` owns the cross-volume fallback, not
 * the destination's parent, and the previous behaviour created it.
 */
const { fs, proc, os } = hostCapabilities

export type NameEncodingDetector = (bytes: Uint8Array) => readonly Pick<Match, "name" | "confidence">[]

const CHARDET_TARGET_ENCODINGS: Readonly<Record<string, string>> = {
  Big5: "big5",
  "EUC-JP": "euc-jp",
  "EUC-KR": "cp949",
  GB18030: "cp936",
  "ISO-2022-JP": "iso-2022-jp",
  Shift_JIS: "cp932",
  "UTF-8": "utf8",
  "windows-1252": "windows-1252",
}

const MIN_CHARDET_CONFIDENCE = 45

export function createNodeEncodebRuntime(): EncodebRuntime {
  return {
    scanPath,
    recoverPath,
    transcodeName: iconvTranscodeName,
  }
}

export async function readClipboardText(): Promise<string> {
  const { platform } = await os.platform()

  if (platform === "win32") {
    const result = await runCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw",
    ])
    return result.exitCode === 0 ? result.stdout.trim() : ""
  }

  if (platform === "darwin") {
    const result = await runCommand("pbpaste", [])
    return result.exitCode === 0 ? result.stdout.trim() : ""
  }

  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0]!, command.slice(1))
    if (result.exitCode === 0 && result.stdout.trim()) return result.stdout.trim()
  }

  return ""
}

/**
 * `proc.exec` answers a non-zero exit as a value; it rejects only when the program could not be started, which
 * is what Node's `execFile` callback had already reported as `code 1`. A clipboard tool that is not installed
 * must keep meaning "nothing readable here" rather than throwing out of the picker.
 */
async function runCommand(command: string, args: string[]): Promise<ExecResult> {
  try {
    return await proc.exec(command, args)
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      truncated: false,
    }
  }
}

export const iconvTranscodeName: NameTranscoder = (name, srcEncoding, dstEncoding, transform = "recode") => {
  if (transform === "auto") return autoTranscodeName(name)
  if (transform === "decode-hash-u") return decodeHashUnicodeEscapes(name)
  if (transform === "normalize-middle-dot") return name.replaceAll("・", "·")

  return safelyRecodeName(name, srcEncoding, dstEncoding)
}

export function autoTranscodeName(name: string, detectEncodings: NameEncodingDetector = analyse): string {
  const escaped = decodeHashUnicodeEscapes(name)
  if (escaped !== name) return escaped

  const candidates: Array<{ value: string; score: number }> = []
  if (/[ÃÂâã]\S/.test(name)) {
    addAutoCandidate(candidates, name, "windows-1252", "utf8", 40)
  }

  if (hasDosMojibake(name)) {
    addAutoCandidate(candidates, name, "cp437", "cp936", 0)
    addAutoCandidate(candidates, name, "cp437", "cp932", 0)
    addAutoCandidate(candidates, name, "cp437", "cp949", 0)
  }

  // GBK -> Shift-JIS is ambiguous for ordinary Han text. Only attempt it
  // when characteristic legacy Japanese mojibake glyphs are present.
  if (/[僋儖儞僗僥僼傾偺丄]/.test(name)) {
    const value = safelyRecodeName(name, "cp936", "cp932")
    const kana = countMatches(value, /[\u3040-\u30ff]/u)
    if (value !== name && kana >= 2) candidates.push({ value, score: 30 + kana })
  }

  addChardetCandidates(candidates, name, detectEncodings)

  return candidates.sort((left, right) => right.score - left.score)[0]?.value ?? name
}

function safelyRecodeName(name: string, srcEncoding: string, dstEncoding: string): string {
  try {
    const encoded = encodeNameLosslessly(name, srcEncoding)
    if (!encoded) return name

    const decoded = decodeBytes(encoded, dstEncoding)
    if (!decoded || replacementCount(decoded) > replacementCount(name) || hasUnsafeControls(decoded)) return name
    return decoded
  } catch {
    return name
  }
}

function addChardetCandidates(
  candidates: Array<{ value: string; score: number }>,
  name: string,
  detectEncodings: NameEncodingDetector,
): void {
  for (const sourceEncoding of chardetSourceEncodings(name)) {
    const bytes = encodeNameLosslessly(name, sourceEncoding)
    if (!bytes) continue
    for (const detection of detectEncodings(bytes)) {
      if (detection.confidence < MIN_CHARDET_CONFIDENCE) continue
      const targetEncoding = CHARDET_TARGET_ENCODINGS[detection.name]
      if (!targetEncoding || targetEncoding === sourceEncoding) continue
      addAutoCandidate(candidates, name, sourceEncoding, targetEncoding, Math.floor(detection.confidence / 10))
    }
  }
}

function chardetSourceEncodings(name: string): string[] {
  const sources: string[] = []
  if (/[ÃÂâã]\S/.test(name)) sources.push("windows-1252")
  if (hasDosMojibake(name)) sources.push("cp437")
  if (/[僋儖儞僗僥僼傾偺丄]/.test(name)) sources.push("cp936")
  return sources
}

function encodeNameLosslessly(name: string, encoding: string): Buffer | undefined {
  const encoded = iconv.encode(name, encoding)
  // iconv-lite silently substitutes unrepresentable characters. A detector
  // must never receive substituted bytes and promote an unsafe conversion.
  return iconv.decode(encoded, encoding) === name ? encoded : undefined
}

function addAutoCandidate(
  candidates: Array<{ value: string; score: number }>,
  name: string,
  srcEncoding: string,
  dstEncoding: string,
  bonus: number,
): void {
  const value = safelyRecodeName(name, srcEncoding, dstEncoding)
  if (value === name) return
  const improvement = mojibakeWeight(name) - mojibakeWeight(value)
  if (improvement <= 0 && bonus <= 0) return
  candidates.push({ value, score: improvement * 20 + bonus + decodedScriptScore(value, dstEncoding) })
}

function hasDosMojibake(value: string): boolean {
  if (/[\u2500-\u259f]/u.test(value)) return true
  return countMatches(value, /[éâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥ƒáíóúñÑªº¿]/u) >= 2
}

function mojibakeWeight(value: string): number {
  return countMatches(value, /[\u2500-\u259f\ufffd]/u) + countMatches(value, /[ÃÂâã]/u)
}

function decodedScriptScore(value: string, encoding: string): number {
  if (encoding === "cp932") return countMatches(value, /[\u3040-\u30ff]/u) * 4 + countMatches(value, /[\u3400-\u9fff]/u)
  if (encoding === "cp949") return countMatches(value, /[\uac00-\ud7a3]/u) * 4
  if (encoding === "cp936") return countMatches(value, /[\u3400-\u9fff]/u)
  return 0
}

function countMatches(value: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
  return [...value.matchAll(new RegExp(pattern.source, flags))].length
}

export function decodeHashUnicodeEscapes(name: string): string {
  return name.replace(/#U([0-9a-fA-F]{4,6})/g, (match, hex: string) => {
    const codePoint = Number.parseInt(hex, 16)
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return match
    return String.fromCodePoint(codePoint)
  })
}

function decodeBytes(bytes: Buffer, encoding: string): string {
  if (iconv.encodingExists(encoding)) return iconv.decode(bytes, encoding)
  return new TextDecoder(encoding, { fatal: true }).decode(bytes)
}

function replacementCount(value: string): number {
  return [...value].filter((char) => char === "\ufffd").length
}

function hasUnsafeControls(value: string): boolean {
  return [...value].some((char) => {
    const code = char.codePointAt(0) ?? 0
    return code < 0x20 && char !== "\t"
  })
}

async function scanPath(path: string): Promise<EncodebEntry[]> {
  const resolved = resolve(path)
  const info = await fs.stat(resolved)
  if (info === null) throw missingPath(resolved)

  if (info.kind === "file") {
    return [{
      path: resolved,
      name: basename(resolved),
      type: "file",
      rootPath: dirname(resolved),
      relativeParts: [basename(resolved)],
      depth: 1,
    }]
  }

  if (info.kind !== "dir") {
    throw new Error(`Unsupported path type: ${resolved}`)
  }

  const entries: EncodebEntry[] = []
  await walkEncodebDirectory(resolved, resolved, [], 1, entries)
  return entries
}

async function recoverPath(
  path: string,
  input: Required<EncodebInput>,
): Promise<string> {
  const resolved = resolve(path)
  const info = await fs.stat(resolved)
  if (info === null) throw missingPath(resolved)
  const entries = await scanPath(resolved)

  if (info.kind === "dir" && input.strategy === "copy") {
    const destRoot = await uniquePath(`${resolved}_recovered`)
    const mappings = createEncodebMappings(entries, input, iconvTranscodeName, { changedOnly: false, destRoot })
    await applyCopyMappings(mappings)
    return destRoot
  }

  const mappings = createEncodebMappings(entries, input, iconvTranscodeName, { changedOnly: true })
  if (input.strategy === "copy") {
    await applyCopyMappings(mappings)
    return mappings[0]?.dst ?? resolved
  }

  await applyReplaceMappings(sortReplaceMappings(mappings))
  return resolved
}

async function walkEncodebDirectory(
  rootPath: string,
  currentPath: string,
  relativeParts: string[],
  depth: number,
  entries: EncodebEntry[],
): Promise<void> {
  let children
  try {
    children = await fs.list(currentPath)
  } catch {
    return
  }

  for (const child of children) {
    if (child.kind !== "dir" && child.kind !== "file") continue
    const childParts = [...relativeParts, child.name]
    entries.push({
      path: child.path,
      name: child.name,
      type: child.kind === "dir" ? "dir" : "file",
      rootPath,
      relativeParts: childParts,
      depth,
    })

    if (child.kind === "dir") {
      await walkEncodebDirectory(rootPath, child.path, childParts, depth + 1, entries)
    }
  }
}

async function applyCopyMappings(mappings: EncodebMapping[]): Promise<void> {
  const sorted = [...mappings].sort((a, b) => a.depth - b.depth)
  for (const mapping of sorted) {
    if (mapping.type === "dir") {
      await fs.ensureDir(mapping.dst)
      continue
    }

    await fs.ensureDir(dirname(mapping.dst))
    await fs.copy(mapping.src, await uniquePath(mapping.dst))
  }
}

async function applyReplaceMappings(mappings: EncodebMapping[]): Promise<void> {
  for (const mapping of mappings) {
    if (mapping.src === mapping.dst) continue
    if ((await fs.stat(mapping.src)) === null) continue
    await fs.ensureDir(dirname(mapping.dst))
    await fs.move(mapping.src, await uniquePath(mapping.dst, mapping.src))
  }
}

async function uniquePath(path: string, samePath?: string): Promise<string> {
  let candidate = path
  let index = 1
  const ext = extname(path)
  const stem = ext ? path.slice(0, -ext.length) : path

  while (true) {
    if (samePath && resolve(candidate) === resolve(samePath)) return candidate
    if ((await fs.stat(candidate)) === null) return candidate
    candidate = `${stem}_${index}${ext}`
    index += 1
  }
}

/** `fs.stat` answers `null` where `lstat` threw; callers show the message, so the absent path keeps Node's text. */
function missingPath(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), { code: "ENOENT" })
}
