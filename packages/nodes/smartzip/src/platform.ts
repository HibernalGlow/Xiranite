import { spawn } from "node:child_process"
import { hostCapabilities } from "@xiranite/host-capabilities"
import type { NodeRunEvent } from "@xiranite/contract"
import { executeSingleFileMutation, type FileOperationExecutor } from "@xiranite/file-operations"
import { PlatformFileMutationProvider } from "@xiranite/file-operations/platform"
import type {
  CommandResult,
  SmartZipCommandPlan,
  SmartZipConfig,
  SmartZipEncodingCandidate,
  SmartZipEncodingInspection,
  SmartZipExecutionRequest,
  SmartZipExecutionAction,
  SmartZipOperationResult,
  SmartZipRuntime,
  SmartZipTools,
} from "./core.js"

/**
 * smartzip's machine half, through the host capability surface (ADR-0079).
 *
 * Path arithmetic comes from the surface's `path` group rather than a `node:path` import: it is not a host
 * operation, but in a bundle that group is the realm implementation whose `join` follows the host's own
 * `join_paths`, which is the spelling the plan rows are keyed on. Two machine reads stay on Node, and each
 * is a limit of the surface rather than unfinished work:
 *
 * - extraction scratch goes through `fs.createTemp(absolutePrefix)`: the tree has to land next to the output,
 *   not on whatever volume the system temp directory sits on (a cross-volume scratch would double the I/O of
 *   writing the whole uncompressed tree and need free space on a drive the user never chose). An absolute
 *   prefix is honoured by both transports — the realm arm resolves it inside the grant
 *   (`filesystem.rs:699-723`), and the Node arm stops joining it onto `os.tmpdir()`, which would have built
 *   `/tmp/Users/…`. That join was a real disagreement and is now asserted against instead of assumed.
 * - `spawn` (`node:child_process`, `launchDetached`) — "Open in 7-Zip File Manager" is a fire-and-forget
 *   launch. `proc.start` hands back a handle whose transcript the run owns, and the host's process table
 *   kills whatever is still live when the run ends (`proc_operations.rs:25-26`), which is the opposite of a
 *   GUI the user just asked to open. Same reason `bandia` keeps its `openEverything`.
 *
 * Two readings moved with the surface:
 *
 * - `stat` used Node's following read; the face's `fs.stat` is `lstat` (`node.ts:100`), so a symbolic link is
 *   its own kind and no longer counts as a file for `isFile`/`isDirectory`. The call sites are extraction
 *   candidates and rename rules inside a tree this node just created, where the two agree for every path but
 *   a linked one.
 * - every 7-Zip transcript is now the host's ceiling of 1 MiB per stream (`control.rs:35`, applied at
 *   `proc_operations.rs:220-221`) instead of the 32 MiB this file asked `execFile` for, because a face must
 *   not see more output than a realm run would. `CommandResult` has no `truncated` field to carry the flag,
 *   so an archive whose `l -slt` listing is bigger than that reports a failed listing rather than a partial
 *   one.
 */
const { fs, proc, os } = hostCapabilities
const { basename, dirname, extname, join, parse } = hostCapabilities.path

export interface SmartZipRuntimeContext {
  fileOperations?: FileOperationExecutor
}

let standaloneFileMutations: PlatformFileMutationProvider | undefined

export function createNodeSmartZipRuntime(context: SmartZipRuntimeContext = {}): SmartZipRuntime {
  return {
    readText: readTextOrThrow,
    appendRecord,
    find7z,
    execute: (request, onEvent) => execute(request, onEvent, context.fileOperations),
    inspectCodePages,
    resolveInputPaths: expandExtractSources,
  }
}

export const createNodeSmartzipRuntime = createNodeSmartZipRuntime

async function find7z(configuredDirectory = ""): Promise<SmartZipTools | null> {
  const { platform, env } = await os.platform()
  const isWindows = platform === "win32"
  const configured = configuredDirectory && configuredDirectory !== "auto" && !configuredDirectory.includes("%SmartZipDir%")
    ? configuredDirectory
    : ""
  const cliCandidates = configured ? [join(configured, "7z.exe"), join(configured, "7z")] : []
  cliCandidates.push(
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
    join(env.LOCALAPPDATA ?? "", "7-Zip", "7z.exe"),
  )
  for (const candidate of cliCandidates) {
    if (!candidate || !await pathExists(candidate)) continue
    const fileManager = join(dirname(candidate), isWindows ? "7zFM.exe" : "7zFM")
    return { cli: candidate, fileManager: await pathExists(fileManager) ? fileManager : undefined }
  }
  for (const name of ["7z", "7z.exe", "7za", "7za.exe", "7zz", "7zz.exe"]) {
    const located = await runCommand(isWindows ? "where.exe" : "which", [name])
    const cli = located.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    if (located.code !== 0 || !cli) continue
    const fileManager = join(dirname(cli), isWindows ? "7zFM.exe" : "7zFM")
    return { cli, fileManager: await pathExists(fileManager) ? fileManager : undefined }
  }
  return null
}

async function execute(
  request: SmartZipExecutionRequest,
  onEvent: (event: NodeRunEvent) => void,
  fileOperations?: FileOperationExecutor,
): Promise<SmartZipOperationResult[]> {
  if (request.action === "archive") return archivePaths(request, onEvent)
  if (request.action === "open") return smartOpen(request, onEvent)
  const sources = await expandExtractSources(request.paths, request.config)
  if (!sources.length) return request.paths.map((path) => operationError(request.action, path, "No supported archive or first multipart volume was found."))
  const results: SmartZipOperationResult[] = []
  for (let index = 0; index < sources.length; index += 1) {
    const sourcePath = sources[index]!
    onEvent({ type: "progress", progress: Math.round(index / sources.length * 100), message: `Extracting ${basename(sourcePath)}` })
    results.push(await extractArchive(sourcePath, request, 0, fileOperations))
  }
  onEvent({ type: "progress", progress: 100, message: "Smart extraction completed." })
  return results
}

async function expandExtractSources(paths: string[], config: SmartZipConfig, _action?: SmartZipExecutionAction): Promise<string[]> {
  const sources: string[] = []
  for (const path of paths) {
    if (!await isDirectory(path)) {
      if (multipartKind(path) !== "continuation") sources.push(path)
      continue
    }
    const entries = await walk(path)
    const fileFlags = await Promise.all(entries.map(isFile))
    for (let index = 0; index < entries.length; index += 1) {
      const candidate = entries[index]!
      if (!fileFlags[index] || multipartKind(candidate) === "continuation" || !isConfiguredArchive(candidate, config)) continue
      sources.push(candidate)
    }
  }
  return [...new Set(sources)]
}

async function extractArchive(
  sourcePath: string,
  request: SmartZipExecutionRequest,
  depth: number,
  fileOperations?: FileOperationExecutor,
): Promise<SmartZipOperationResult> {
  if (!await pathExists(sourcePath)) return operationError(request.action, sourcePath, "Path does not exist.")
  const multipart = multipartKind(sourcePath)
  if (request.config.skipMultipart && multipart === "continuation") {
    return { action: request.action, sourcePath, status: "skipped", message: "Skipped a non-first multipart archive." }
  }
  const outputRoot = request.config.targetDir && await isDirectory(request.config.targetDir)
    ? request.config.targetDir
    : dirname(sourcePath)
  await fs.ensureDir(outputRoot)
  // The one machine read that stays on Node: the scratch has to be a sibling of the output, and
  // `fs.createTemp` cannot name that directory in both transports. See the note at the top of this file.
  const temporary = await fs.createTemp(join(outputRoot, ".smartzip-"))
  const candidates = passwordCandidates(sourcePath, request.config)
  let password: string | undefined
  let tested: CommandResult | undefined
  const testFailures: CommandResult[] = []
  for (const candidate of candidates) {
    const testPassword = candidate || "__XIRANITE_NO_PASSWORD__"
    const args = ["t", sourcePath, "-y", "-sccUTF-8", `-p${testPassword}`]
    tested = await runCommand(request.tools.cli, args)
    if (tested.code === 0) {
      password = candidate || undefined
      break
    }
    testFailures.push(tested)
  }
  if (!tested || tested.code !== 0) {
    await fs.remove(temporary, { recursive: true })
    return operationError(
      request.action,
      sourcePath,
      archiveTestFailureMessage(testFailures, request.config.passwords.length),
      tested,
    )
  }
  const encodingInspection = request.action === "extract_codepage" && !request.codePage
    ? await inspectCodePage(sourcePath, request.config.codePages)
    : undefined
  const resolvedCodePage = request.codePage || encodingInspection?.recommendedCodePage
  const args = [
    "x",
    sourcePath,
    `-o${temporary}`,
    "-aoa",
    "-y",
    "-sccUTF-8",
    ...(password ? [`-p${password}`] : []),
    ...(resolvedCodePage ? [`-mcp=${resolvedCodePage}`] : []),
    ...excludeArgs(request.config),
  ]
  const displayArgs = args.map((arg) => arg.startsWith("-p") ? "-p••••" : arg)
  const command: SmartZipCommandPlan = { label: `Extract ${sourcePath}`, command: request.tools.cli, args: displayArgs }
  const commandResult = await runCommand(request.tools.cli, args)
  if (commandResult.code !== 0) {
    await fs.remove(temporary, { recursive: true })
    return operationError(request.action, sourcePath, commandResult.stderr || commandResult.stdout || "7-Zip extraction failed.", commandResult, command)
  }
  await applyPostExtractionRules(temporary, request.config)
  const outputPath = await materializeExtraction(temporary, sourcePath, outputRoot)

  if (depth < 32 && request.config.nestedExtraction) {
    const nested = await nestedArchiveCandidates(outputPath, request, request.config.nestedExtractionForMultiple)
    for (const nestedPath of nested) {
      const nestedResult = await extractArchive(nestedPath, request, depth + 1, fileOperations)
      if (nestedResult.status === "completed" && multipartKind(nestedPath) !== "continuation") {
        await recyclePath(nestedPath, fileOperations)
      }
    }
  }
  if (request.config.deleteSource || (password && request.config.deleteSourceWhenPassword)) {
    await recyclePath(sourcePath, fileOperations)
  }
  return {
    action: request.action,
    sourcePath,
    outputPath,
    status: "completed",
    message: extractionMessage(password, resolvedCodePage, encodingInspection),
    command,
    commandResult,
    passwordUsed: Boolean(password),
  }
}

const DEFAULT_CODE_PAGES = [65001, 936, 950, 932, 949] as const

async function inspectCodePages(paths: string[], config: SmartZipConfig): Promise<SmartZipEncodingInspection[]> {
  const sources: string[] = []
  for (const path of paths) {
    if (!await isDirectory(path)) {
      if (multipartKind(path) !== "continuation") sources.push(path)
      continue
    }
    const entries = await walk(path)
    const fileFlags = await Promise.all(entries.map(isFile))
    for (let index = 0; index < entries.length; index += 1) {
      const candidate = entries[index]!
      if (fileFlags[index] && multipartKind(candidate) !== "continuation" && /\.(?:zip|cbz|7z|7z\.001)$/i.test(candidate)) sources.push(candidate)
    }
  }
  const tools = await find7z(config.sevenZipDir)
  return Promise.all([...new Set(sources)].map(async (path) => {
    const inspection = await inspectCodePage(path, config.codePages)
    if (!tools) return { ...inspection, archiveStatus: "unsupported" as const, treeError: "7-Zip was not found; file-tree preview is unavailable." }
    const tree = await listArchiveEntries(path, tools.cli, config, inspection.recommendedCodePage)
    return { ...inspection, ...tree }
  }))
}

async function listArchiveEntries(
  path: string,
  cli: string,
  config: SmartZipConfig,
  codePage?: number,
): Promise<Pick<SmartZipEncodingInspection, "entries" | "archiveStatus" | "treeError">> {
  let lastResult: CommandResult | undefined
  for (const candidate of passwordCandidates(path, config)) {
    const password = candidate || "__XIRANITE_NO_PASSWORD__"
    const result = await runCommand(cli, ["l", "-slt", path, "-sccUTF-8", `-p${password}`, ...(codePage && codePage !== 65001 ? [`-mcp=${codePage}`] : [])])
    lastResult = result
    if (result.code !== 0) continue
    const entries = parseArchiveEntryPaths(result.stdout)
    return { entries, archiveStatus: candidate ? "encrypted" : "readable" }
  }
  const error = lastResult?.stderr || lastResult?.stdout || "7-Zip could not list this archive."
  return {
    entries: [],
    archiveStatus: /Unexpected end|missing volume|Can not open/i.test(error) ? "incomplete" : "unsupported",
    treeError: conciseArchiveError(error),
  }
}

function parseArchiveEntryPaths(stdout: string): string[] {
  const body = stdout.split(/\r?\n-{10,}\r?\n/).slice(1).join("\n")
  return [...body.matchAll(/^Path = (.+)$/gm)].map((match) => match[1]!.trim()).filter(Boolean)
}

function conciseArchiveError(value: string): string {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines.find((line) => /Unexpected end|Wrong password|missing volume|Headers Error|Can not open/i.test(line)) ?? lines.at(-1) ?? "Unable to list archive entries."
}

function archiveTestFailureMessage(results: CommandResult[], configuredPasswordCount: number): string {
  const output = results.map((result) => `${result.stderr}\n${result.stdout}`).join("\n")
  const detail = conciseArchiveError(output)
  if (/Unexpected end|missing volume/i.test(output)) return `Archive is incomplete or a multipart volume is missing. 7-Zip: ${detail}`
  if (/Wrong password|Cannot open encrypted archive|Headers Error/i.test(output)) {
    const count = configuredPasswordCount
      ? `${configuredPasswordCount} configured password${configuredPasswordCount === 1 ? "" : "s"}`
      : "no configured passwords"
    return `Encrypted archive could not be unlocked after trying ${count}. 7-Zip: ${detail}`
  }
  return `Archive test failed. 7-Zip: ${detail}`
}

/**
 * The two positioned reads the codepage probe needs, as `fs.stat` plus `fs.readBytes` with an offset.
 *
 * An absent or unreadable archive used to fail in `open` and land in the `catch` below with Node's message;
 * the surface answers `null` for "no bytes" instead, so the throw is synthesized here to keep the reported
 * message the same shape (`readBytes` also refuses to read a directory, which the old handle did too).
 */
async function inspectCodePage(path: string, configuredCodePages: number[] = []): Promise<SmartZipEncodingInspection> {
  try {
    const info = await fs.stat(path)
    if (info === null) throw enoent(path, "open")
    const size = info.sizeBytes ?? 0
    const signature = await fs.readBytes(path, { length: Math.min(8, size) })
    if (signature && isSevenZipSignature(signature)) {
      return { sourcePath: path, confidence: "certain", unicodeMetadata: true, candidates: [], message: "7z stores Unicode filenames; legacy ZIP codepage selection is not applicable." }
    }
    const tailSize = Math.min(size, 32 * 1024 * 1024)
    const tailOffset = size - tailSize
    const tail = await fs.readBytes(path, { offset: tailOffset, length: tailSize })
    if (tail === null) throw enoent(path, "open")
    return detectZipFilenameEncoding(tail, path, configuredCodePages, tailOffset)
  } catch (error) {
    return {
      sourcePath: path,
      confidence: "unknown",
      unicodeMetadata: false,
      candidates: [],
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export function detectZipFilenameEncoding(
  bytes: Uint8Array,
  sourcePath = "archive.zip",
  configuredCodePages: number[] = [],
  baseOffset = 0,
): SmartZipEncodingInspection {
  if (isSevenZipSignature(bytes)) {
    return { sourcePath, confidence: "certain", unicodeMetadata: true, candidates: [], message: "7z stores Unicode filenames; legacy ZIP codepage selection is not applicable." }
  }
  const names = readZipCentralDirectoryNames(bytes, baseOffset)
  if (!names.length) {
    return { sourcePath, confidence: "unknown", unicodeMetadata: false, candidates: [], message: "No ZIP central-directory filenames were found." }
  }
  const nonAscii = names.filter((entry) => entry.bytes.some((byte) => byte > 0x7f))
  if (!nonAscii.length) {
    return { sourcePath, confidence: "certain", unicodeMetadata: false, candidates: [], message: "All archived filenames are ASCII; no codepage override is required." }
  }
  const unicodeMetadata = nonAscii.every((entry) => (entry.flags & 0x0800) !== 0)
  if (unicodeMetadata) {
    const preview = decodeNames(nonAscii.map((entry) => entry.bytes), 65001) ?? []
    return {
      sourcePath,
      recommendedCodePage: 65001,
      confidence: "certain",
      unicodeMetadata: true,
      candidates: [{ codePage: 65001, label: codePageLabel(65001), score: 100, preview }],
      message: "ZIP UTF-8 filename metadata is present.",
    }
  }

  const requested = [...new Set([...configuredCodePages, ...DEFAULT_CODE_PAGES])]
  const candidates = requested
    .map((codePage) => buildEncodingCandidate(nonAscii.map((entry) => entry.bytes), codePage))
    .filter((candidate): candidate is SmartZipEncodingCandidate => Boolean(candidate))
    .sort((left, right) => right.score - left.score || requested.indexOf(left.codePage) - requested.indexOf(right.codePage))
  const best = candidates[0]
  const margin = best ? best.score - (candidates[1]?.score ?? best.score - 20) : 0
  const confidence = !best ? "unknown" : margin >= 16 ? "high" : margin >= 6 ? "medium" : "low"
  return {
    sourcePath,
    recommendedCodePage: best?.codePage,
    confidence,
    unicodeMetadata: false,
    candidates,
    message: best
      ? `Recommended ${best.label} (${confidence} confidence); review filename previews before extraction.`
      : "No candidate codepage could decode the archived filenames.",
  }
}

function readZipCentralDirectoryNames(bytes: Uint8Array, baseOffset = 0): Array<{ bytes: Uint8Array; flags: number }> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let offset = Math.max(0, buffer.length - 65_557); offset <= buffer.length - 22; offset += 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) eocd = offset
  }
  if (eocd < 0) return []
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16) - baseOffset
  const result: Array<{ bytes: Uint8Array; flags: number }> = []
  for (let index = 0; index < count && offset + 46 <= buffer.length; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break
    const flags = buffer.readUInt16LE(offset + 8)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const start = offset + 46
    const end = start + nameLength
    if (end > buffer.length) break
    result.push({ bytes: buffer.subarray(start, end), flags })
    offset = end + extraLength + commentLength
  }
  return result
}

function isSevenZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf && bytes[4] === 0x27 && bytes[5] === 0x1c
}

function buildEncodingCandidate(names: Uint8Array[], codePage: number): SmartZipEncodingCandidate | null {
  const preview = decodeNames(names, codePage)
  if (!preview) return null
  return {
    codePage,
    label: codePageLabel(codePage),
    score: preview.reduce((total, name) => total + filenameScore(name, codePage), 0),
    preview,
  }
}

function decodeNames(names: Uint8Array[], codePage: number): string[] | null {
  const encoding = codePageEncoding(codePage)
  if (!encoding) return null
  try {
    const decoder = new TextDecoder(encoding, { fatal: true })
    return names.slice(0, 12).map((name) => decoder.decode(name))
  } catch {
    return null
  }
}

function filenameScore(value: string, codePage: number): number {
  let score = 0
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0
    if (point === 0xfffd || point < 0x20) score -= 40
    else if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) score += codePage === 932 ? 14 : 2
    else if (/\p{Script=Hangul}/u.test(character)) score += codePage === 949 ? 14 : 2
    else if (/\p{Script=Han}/u.test(character)) score += 4
    else if (/[A-Za-z0-9 ._()[\]{}+\-\\/]/.test(character)) score += 1
    else score -= 1
  }
  if (/\.[A-Za-z0-9]{1,8}$/.test(value)) score += 4
  if (/[这为国画动压缩档测试目录文件]/.test(value)) score += codePage === 936 ? 3 : 0
  if (/[這為國畫動壓縮檔測試目錄文件]/.test(value)) score += codePage === 950 ? 3 : 0
  return score
}

function codePageEncoding(codePage: number): string | null {
  if (codePage === 65001) return "utf-8"
  if (codePage === 936) return "gbk"
  if (codePage === 950) return "big5"
  if (codePage === 932) return "shift_jis"
  if (codePage === 949) return "euc-kr"
  return null
}

function codePageLabel(codePage: number): string {
  return ({ 65001: "UTF-8 / CP65001", 936: "GBK / CP936", 950: "Big5 / CP950", 932: "Shift_JIS / CP932", 949: "EUC-KR / CP949" } as Record<number, string>)[codePage] ?? `CP${codePage}`
}

function extractionMessage(password: string | undefined, codePage: number | undefined, inspection: SmartZipEncodingInspection | undefined): string {
  const passwordText = password ? " with a configured password" : ""
  if (codePage && inspection) return `Extracted${passwordText}; auto-selected ${codePageLabel(codePage)} (${inspection.confidence} confidence).`
  if (codePage) return `Extracted${passwordText}; filename encoding ${codePageLabel(codePage)}.`
  return `Extracted${passwordText}.`
}

async function archivePaths(request: SmartZipExecutionRequest, onEvent: (event: NodeRunEvent) => void): Promise<SmartZipOperationResult[]> {
  const existing = [] as string[]
  for (const path of request.paths) if (await pathExists(path)) existing.push(path)
  if (!existing.length) return request.paths.map((path) => operationError("archive", path, "Path does not exist."))
  const allDirectories = (await Promise.all(existing.map(isDirectory))).every(Boolean)
  const groups = allDirectories ? existing.map((path) => [path]) : [existing]
  const archiveSettings = parseLegacyArchiveArgs(request.config.archiveArgs)
  const results: SmartZipOperationResult[] = []
  for (let index = 0; index < groups.length; index += 1) {
    const paths = groups[index]!
    onEvent({ type: "progress", progress: Math.round(index / groups.length * 100), message: `Archiving ${basename(paths[0]!)}` })
    const output = await uniquePath(archiveTarget(paths, archiveSettings.extension))
    const sources = allDirectories && paths.length === 1 ? [join(paths[0]!, "*")] : paths
    const args = ["a", output, ...archiveSettings.args, ...sources, "-y", "-sccUTF-8"]
    const command: SmartZipCommandPlan = { label: `Archive ${paths.join(", ")}`, command: request.tools.cli, args }
    const commandResult = await runCommand(command.command, command.args)
    results.push(commandResult.code === 0
      ? { action: "archive", sourcePath: paths.join("\n"), outputPath: output, status: "completed", message: "Archived.", command, commandResult }
      : operationError("archive", paths.join("\n"), commandResult.stderr || commandResult.stdout || "7-Zip archive creation failed.", commandResult, command))
  }
  onEvent({ type: "progress", progress: 100, message: "Archive creation completed." })
  return results
}

async function smartOpen(request: SmartZipExecutionRequest, onEvent: (event: NodeRunEvent) => void): Promise<SmartZipOperationResult[]> {
  onEvent({ type: "progress", progress: 20, message: "Inspecting selected paths." })
  const singlePath = request.paths.length === 1 ? request.paths[0]! : undefined
  const archiveDetected = singlePath
    ? isConfiguredArchive(singlePath, request.config) || (await runCommand(request.tools.cli, ["l", singlePath, "-sccUTF-8"])).code === 0
    : false
  if (singlePath && archiveDetected && request.tools.fileManager) {
    const path = singlePath
    const command: SmartZipCommandPlan = { label: `Open ${path}`, command: request.tools.fileManager, args: [path], detached: true }
    const commandResult = await launchDetached(command.command, command.args)
    onEvent({ type: "progress", progress: 100, message: "Opened in 7-Zip File Manager." })
    return [commandResult.code === 0
      ? { action: "open", sourcePath: path, status: "completed", message: "Opened in 7-Zip File Manager.", command, commandResult }
      : operationError("open", path, commandResult.stderr || "Unable to open 7-Zip File Manager.", commandResult, command)]
  }
  return archivePaths({ ...request, action: "archive", config: { ...request.config, archiveArgs: request.config.openArchiveArgs } }, onEvent).then((items) => items.map((item) => ({ ...item, action: "open" })))
}

async function applyPostExtractionRules(root: string, config: SmartZipConfig): Promise<void> {
  const entries = await walk(root)
  entries.sort((a, b) => b.length - a.length)
  for (const path of entries) {
    if (!await pathExists(path)) continue
    const name = basename(path)
    if (matchesAnyPattern(name, config.deletePatterns)) {
      await fs.remove(path, { recursive: true })
      continue
    }
    let nextName = name
    if (await isFile(path)) {
      const currentExtension = extname(name).slice(1)
      const extensionRule = config.renameExtensions.find((rule) => rule.match.toLowerCase() === currentExtension.toLowerCase())
      if (extensionRule) nextName = `${parse(name).name}${extensionRule.replacement ? `.${extensionRule.replacement}` : ""}`
    }
    for (const rule of config.renameNames) nextName = nextName.split(rule.match).join(rule.replacement)
    for (const rule of config.renamePatterns) {
      try { nextName = nextName.replace(new RegExp(rule.match, "g"), rule.replacement) } catch { /* Invalid legacy regex: leave unchanged. */ }
    }
    if (nextName && nextName !== name) await fs.move(path, await uniquePath(join(dirname(path), nextName)))
  }
}

async function materializeExtraction(temporary: string, archivePath: string, outputRoot: string): Promise<string> {
  const top = await fs.list(temporary)
  const walked = await walk(temporary)
  const fileFlags = await Promise.all(walked.map(isFile))
  const files = walked.filter((_path, index) => fileFlags[index])
  let source: string
  if (top.length === 1) source = top[0]!.path
  else if (files.length === 1) source = files[0]!
  else source = temporary
  const defaultName = source === temporary ? parse(basename(archivePath)).name : basename(source)
  const output = await uniquePath(join(outputRoot, defaultName))
  await fs.move(source, output)
  if (source !== temporary) await fs.remove(temporary, { recursive: true })
  return output
}

async function nestedArchiveCandidates(outputPath: string, request: SmartZipExecutionRequest, multiple: boolean): Promise<string[]> {
  if (await isFile(outputPath)) return await isArchiveByContent(outputPath, request) ? [outputPath] : []
  const entries = await walk(outputPath)
  const fileFlags = await Promise.all(entries.map(isFile))
  const files = entries.filter((_path, index) => fileFlags[index])
  const detected: string[] = []
  for (const path of files) if (await isArchiveByContent(path, request)) detected.push(path)
  return detected.length === 1 || multiple ? detected : []
}

async function isArchiveByContent(path: string, request: SmartZipExecutionRequest): Promise<boolean> {
  if (isConfiguredArchive(path, request.config)) return true
  for (const candidate of passwordCandidates(path, request.config)) {
    const password = candidate || "__XIRANITE_NO_PASSWORD__"
    const result = await runCommand(request.tools.cli, ["l", "-slt", path, "-sccUTF-8", `-p${password}`])
    if (result.code === 0 || /(?:^|\r?\n)Type = (?!ERROR)/m.test(result.stdout)) return true
  }
  return false
}

function passwordCandidates(sourcePath: string, config: SmartZipConfig): string[] {
  const directoryPassword = config.addDirectoryAsPassword ? basename(dirname(sourcePath)) : ""
  return [...new Set(["", directoryPassword, ...config.passwords].filter((value, index) => index === 0 || Boolean(value)))]
}

function excludeArgs(config: SmartZipConfig): string[] {
  const args = [
    ...config.excludeExtensions.map((extension) => `-x!*.${extension.replace(/^\./, "")}`),
    ...config.excludeNames.map((name) => `-x!*${name}*`),
  ]
  return args.length ? [...args, "-r"] : args
}

function isConfiguredArchive(path: string, config: SmartZipConfig): boolean {
  const extension = extname(path).slice(1).toLowerCase()
  if (!extension) return true
  if (config.archiveExtensions.some((item) => item === extension) || config.openArchiveExtensions.some((item) => item === extension)) return true
  return config.archiveExtensionPatterns.some((pattern) => {
    try { return new RegExp(pattern, "i").test(extension) } catch { return false }
  })
}

function multipartKind(path: string): "first" | "continuation" | "none" {
  const name = basename(path).toLowerCase()
  const rar = /\.part(\d+)\.rar$/.exec(name)
  if (rar) return Number(rar[1]) === 1 ? "first" : "continuation"
  const numeric = /\.[^.]+\.(\d+)$/.exec(name)
  if (numeric) return Number(numeric[1]) === 1 ? "first" : "continuation"
  return "none"
}

function archiveTarget(paths: string[], extension = ".zip"): string {
  const first = paths[0]!
  if (paths.length === 1) return join(dirname(first), `${basename(first, extname(first))}${extension}`)
  const directory = dirname(first)
  return join(directory, `${basename(directory).replace(/:/g, "") || "archive"}${extension}`)
}

function parseLegacyArchiveArgs(value: string): { extension: string; args: string[] } {
  const normalized = value.trim()
  const match = /^(\.[A-Za-z0-9]+)"?\s*(.*)$/.exec(normalized)
  const extension = match?.[1] ?? ".zip"
  const remainder = match?.[2] ?? ""
  const args = [...remainder.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((item) => item[1] ?? item[2] ?? item[3]!).filter(Boolean)
  return { extension, args }
}

async function uniquePath(path: string): Promise<string> {
  if (!await pathExists(path)) return path
  const parsed = parse(path)
  for (let index = 1; ; index += 1) {
    const candidate = join(parsed.dir, `${parsed.name}_${index}${parsed.ext}`)
    if (!await pathExists(candidate)) return candidate
  }
}

/**
 * The tree walk, one directory per `fs.list` call.
 *
 * `fs.list` answers a single level in both transports (`filesystem.rs:302-332` takes no `recursive`, and the
 * host's own comment on the operation says the same), so the descent stays here — the shape `kisaki` documents
 * for the same reason. `entry.path` is the host's own join of the caller's spelling and the entry name, which
 * is what `join(root, entry.name)` produced.
 */
async function walk(root: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await fs.list(root)) {
    result.push(entry.path)
    if (entry.kind === "dir") result.push(...await walk(entry.path))
  }
  return result
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    try { return new RegExp(pattern, "i").test(value) } catch { return false }
  })
}

function operationError(action: SmartZipOperationResult["action"], sourcePath: string, message: string, commandResult?: CommandResult, command?: SmartZipCommandPlan): SmartZipOperationResult {
  return { action, sourcePath, status: "error", message, commandResult, command }
}

async function pathExists(path: string): Promise<boolean> {
  return (await fs.stat(path)) !== null
}

async function isDirectory(path: string): Promise<boolean> {
  return (await fs.stat(path))?.kind === "dir"
}

async function isFile(path: string): Promise<boolean> {
  return (await fs.stat(path))?.kind === "file"
}

export async function recyclePath(path: string, executor?: FileOperationExecutor): Promise<void> {
  const operation = { kind: "trash" as const, sourcePath: path }
  if (executor) {
    await executeSingleFileMutation(executor, operation)
    return
  }
  standaloneFileMutations ??= new PlatformFileMutationProvider()
  await standaloneFileMutations.execute(operation)
}

/**
 * One 7-Zip run, through `proc.exec`.
 *
 * A non-zero exit is a value in both transports, which is what the password loop and every `code !== 0`
 * branch below already assume. A child that cannot be launched is an error there rather than exit code 1
 * (`node.ts:242-245` re-throws `ENOENT`, `proc_operations.rs:159-161` answers "could not start"), and
 * `execFile` used to hand back code 1 for exactly that case — the `catch` keeps "7-Zip is not here" a failed
 * result instead of throwing away the run report that names it.
 */
async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  try {
    const result = await proc.exec(command, args)
    return { code: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return { code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * "Open in 7-Zip File Manager": a fire-and-forget launch that must outlive the call, so it stays on Node —
 * see the note at the top of this file. Answers the same `CommandResult` the caller reads, with `0` meaning
 * "it spawned" and `1` meaning it could not be started.
 */
function launchDetached(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true })
    child.once("spawn", () => {
      child.unref()
      resolveResult({ code: 0, stdout: "", stderr: "" })
    })
    child.once("error", (error) => resolveResult({ code: 1, stdout: "", stderr: error.message }))
  })
}

async function appendRecord(path: string, record: unknown): Promise<void> {
  // `fs.appendText` creates the parent directory in both transports (`filesystem.rs:451-453`,
  // `node.ts:139-142`), so the old `mkdir(dirname)` here is the surface's job.
  await fs.appendText(path, `${JSON.stringify(record)}\n`)
}

/** `SmartZipRuntime.readText` is `() => Promise<string>`: `core.ts:162` reports a missing ini through the throw. */
async function readTextOrThrow(path: string): Promise<string> {
  const text = await fs.readText(path)
  if (text === null) throw enoent(path, "open")
  return text
}

/** Node's wording, kept because the run report and the codepage probe's message show it. */
function enoent(path: string, member: "open"): Error & { code: string } {
  return Object.assign(new Error(`ENOENT: no such file or directory, ${member} '${path}'`), { code: "ENOENT" })
}
