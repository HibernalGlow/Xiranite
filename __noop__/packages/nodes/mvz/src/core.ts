import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type MvzAction = "delete" | "extract" | "move" | "rename"

export interface ArchiveEntry {
  archivePath: string
  internalPath: string
  rawLine: string
}

export interface MvzInput {
  action?: MvzAction
  files?: string[]
  fileText?: string
  output?: string
  near?: boolean
  autoDir?: boolean
  flatten?: boolean
  pattern?: string
  replacement?: string
  separator?: string
  dryRun?: boolean
}

export interface MvzCommandResult {
  code: number
  stdout: string
  stderr: string
  durationMs?: number
}

export interface MvzRuntime {
  find7z: () => Promise<string | null>
  runCommand: (command: string, args: string[], options?: { cwd?: string }) => Promise<MvzCommandResult>
  exists: (path: string) => Promise<boolean>
  ensureDir: (path: string) => Promise<void>
  dirname: (path: string) => string
  basename: (path: string) => string
  extname: (path: string) => string
  join: (...parts: string[]) => string
}

export interface MvzOperationResult {
  archive: string
  action: MvzAction
  success: boolean
  message: string
  files: string[]
  count: number
  output?: string
  command?: string
  renames?: Array<{ old: string; next: string }>
}

export interface MvzPreview {
  archive: string
  action: MvzAction
  files: string[]
  count: number
  output?: string
  command?: string
  renames?: Array<{ old: string; next: string }>
}

export interface MvzData {
  action: MvzAction
  totalFiles: number
  totalArchives: number
  successCount: number
  failedCount: number
  results: MvzOperationResult[]
  preview: MvzPreview[]
}

export type MvzResult = NodeRunResult<MvzData>

const LONG_FORMAT_RE = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+[\d.]+[BKMGT]?\s+(.+)$/i

export function parseMvzLine(line: string, separator = "//"): ArchiveEntry | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const pathPart = LONG_FORMAT_RE.exec(trimmed)?.[1] ?? trimmed
  const index = pathPart.indexOf(separator)
  if (index < 0) return null
  const archivePath = pathPart.slice(0, index).trim()
  const internalPath = pathPart.slice(index + separator.length).trim()
  if (!archivePath || !internalPath) return null
  return { archivePath, internalPath, rawLine: line }
}

export function parseMvzEntries(textOrLines: string | string[] = "", separator = "//"): ArchiveEntry[] {
  const lines = Array.isArray(textOrLines) ? textOrLines : textOrLines.split(/\r?\n/)
  return lines.map((line) => parseMvzLine(line, separator)).filter((entry): entry is ArchiveEntry => Boolean(entry))
}

export function groupByArchive(entries: ArchiveEntry[]): Map<string, ArchiveEntry[]> {
  const groups = new Map<string, ArchiveEntry[]>()
  for (const entry of entries) {
    const current = groups.get(entry.archivePath) ?? []
    current.push(entry)
    groups.set(entry.archivePath, current)
  }
  return groups
}

export async function runMvz(input: MvzInput, runtime: MvzRuntime, onEvent?: (event: NodeRunEvent) => void): Promise<MvzResult> {
  const action = input.action ?? "extract"
  const separator = input.separator ?? "//"
  const entries = parseMvzEntries([...(input.files ?? []), ...(input.fileText ?? "").split(/\r?\n/)], separator)
  if (!entries.length) return result(false, "No archive entries found.", emptyData(action))

  const sevenZip = input.dryRun ? "7z" : await runtime.find7z()
  if (!sevenZip) return result(false, "7-Zip executable was not found. Install 7-Zip or add 7z to PATH.", emptyData(action))

  if (action === "rename" && !input.pattern) return result(false, "Rename pattern is required.", emptyData(action))

  const groups = groupByArchive(entries)
  const data: MvzData = {
    action,
    totalFiles: entries.length,
    totalArchives: groups.size,
    successCount: 0,
    failedCount: 0,
    results: [],
    preview: [],
  }

  let index = 0
  for (const [archive, group] of groups) {
    emit(onEvent, "progress", progress(index, groups.size), `${action} ${index + 1}/${groups.size}`, runtime.basename(archive))
    const groupResult = await runGroup(action, archive, group, sevenZip, input, runtime)
    if (input.dryRun) data.preview.push(...groupResult.preview)
    data.results.push(...groupResult.results)
    index += 1
  }

  data.successCount = data.results.reduce((sum, item) => sum + (item.success ? item.count : 0), 0)
  data.failedCount = data.results.reduce((sum, item) => sum + (item.success ? 0 : item.count), 0)
  emit(onEvent, "progress", 100, "mvz complete.")
  return result(data.failedCount === 0, `${action} complete: ${data.successCount} succeeded, ${data.failedCount} failed.`, data)
}

async function runGroup(action: MvzAction, archive: string, entries: ArchiveEntry[], sevenZip: string, input: MvzInput, runtime: MvzRuntime): Promise<{ results: MvzOperationResult[]; preview: MvzPreview[] }> {
  if (!input.dryRun && !await runtime.exists(archive)) {
    return { results: [operation(action, archive, entries, false, `Archive not found: ${archive}`)], preview: [] }
  }

  if (action === "delete") {
    const command = deleteCommand(sevenZip, archive, entries)
    return executeOrPreview(action, archive, entries, command, input, runtime)
  }

  if (action === "extract") {
    const output = outputDir(archive, input, runtime)
    const command = extractCommand(sevenZip, archive, entries, output, input.flatten ?? false)
    return executeOrPreview(action, archive, entries, command, input, runtime, output)
  }

  if (action === "move") {
    const output = outputDir(archive, input, runtime)
    const extract = extractCommand(sevenZip, archive, entries, output, input.flatten ?? false)
    const deleteAfter = deleteCommand(sevenZip, archive, entries)
    if (input.dryRun) {
      return {
        preview: [
          preview("extract", archive, entries, extract.command, output),
          preview("delete", archive, entries, deleteAfter.command),
        ],
        results: [operation("move", archive, entries, true, `[dry-run] Would move ${entries.length} file(s).`, output, `${extract.command} && ${deleteAfter.command}`)],
      }
    }
    await runtime.ensureDir(output)
    const extracted = await runtime.runCommand(extract.args[0]!, extract.args.slice(1))
    if (extracted.code !== 0) return { preview: [], results: [operation("move", archive, entries, false, `Extract failed: ${shortError(extracted)}`, output, extract.command)] }
    const deleted = await runtime.runCommand(deleteAfter.args[0]!, deleteAfter.args.slice(1))
    const ok = deleted.code === 0 || deleted.code === 1
    return { preview: [], results: [operation("move", archive, entries, ok, ok ? `Moved ${entries.length} file(s) to ${output}.` : `Delete failed after extract: ${shortError(deleted)}`, output, `${extract.command} && ${deleteAfter.command}`)] }
  }

  return runRename(archive, entries, sevenZip, input, runtime)
}

async function runRename(archive: string, entries: ArchiveEntry[], sevenZip: string, input: MvzInput, runtime: MvzRuntime): Promise<{ results: MvzOperationResult[]; preview: MvzPreview[] }> {
  const pattern = input.pattern ?? ""
  const replacement = input.replacement ?? ""
  const regex = new RegExp(pattern, "g")
  const renames = entries
    .map((entry) => ({ old: entry.internalPath, next: entry.internalPath.replace(regex, replacement) }))
    .filter((pair) => pair.old !== pair.next)

  if (!renames.length) return { results: [operation("rename", archive, entries, false, "No files matched the rename pattern.")], preview: [] }

  const args = ["rn", archive, ...renames.flatMap((pair) => [pair.old, pair.next])]
  const command = formatCommand(sevenZip, args)
  if (input.dryRun) {
    return {
      preview: [{ archive, action: "rename", files: renames.map((pair) => pair.old), count: renames.length, command, renames }],
      results: [{ archive, action: "rename", success: true, message: `[dry-run] Would rename ${renames.length} file(s).`, files: renames.map((pair) => pair.old), count: renames.length, command, renames }],
    }
  }

  const executed = await runtime.runCommand(sevenZip, args)
  const ok = executed.code === 0
  return {
    preview: [],
    results: [{ archive, action: "rename", success: ok, message: ok ? `Renamed ${renames.length} file(s).` : `Rename failed: ${shortError(executed)}`, files: renames.map((pair) => pair.old), count: renames.length, command, renames }],
  }
}

async function executeOrPreview(action: MvzAction, archive: string, entries: ArchiveEntry[], commandSpec: { args: string[]; command: string }, input: MvzInput, runtime: MvzRuntime, output?: string): Promise<{ results: MvzOperationResult[]; preview: MvzPreview[] }> {
  if (input.dryRun) {
    return {
      preview: [preview(action, archive, entries, commandSpec.command, output)],
      results: [operation(action, archive, entries, true, `[dry-run] Would ${action} ${entries.length} file(s).`, output, commandSpec.command)],
    }
  }

  if (output) await runtime.ensureDir(output)
  const executed = await runtime.runCommand(commandSpec.args[0]!, commandSpec.args.slice(1))
  const ok = action === "delete" ? executed.code === 0 || executed.code === 1 : executed.code === 0
  return {
    preview: [],
    results: [operation(action, archive, entries, ok, ok ? `${action} ${entries.length} file(s).` : `${action} failed: ${shortError(executed)}`, output, commandSpec.command)],
  }
}

function deleteCommand(sevenZip: string, archive: string, entries: ArchiveEntry[]) {
  const args = [sevenZip, "d", archive, ...entries.map((entry) => entry.internalPath)]
  return { args, command: formatCommand(sevenZip, args.slice(1)) }
}

function extractCommand(sevenZip: string, archive: string, entries: ArchiveEntry[], output: string, flatten: boolean) {
  const args = [sevenZip, flatten ? "e" : "x", archive, `-o${output}`, "-y", ...entries.map((entry) => entry.internalPath)]
  return { args, command: formatCommand(sevenZip, args.slice(1)) }
}

function outputDir(archive: string, input: MvzInput, runtime: MvzRuntime): string {
  let output = input.near ? runtime.dirname(archive) : (input.output || ".")
  if (input.autoDir ?? false) output = runtime.join(output, archiveStem(archive, runtime))
  return output
}

function archiveStem(path: string, runtime: MvzRuntime): string {
  const name = runtime.basename(path)
  const ext = runtime.extname(name)
  return ext ? name.slice(0, -ext.length) : name
}

function operation(action: MvzAction, archive: string, entries: ArchiveEntry[], success: boolean, message: string, output?: string, command?: string): MvzOperationResult {
  return { archive, action, success, message, files: entries.map((entry) => entry.internalPath), count: entries.length, output, command }
}

function preview(action: MvzAction, archive: string, entries: ArchiveEntry[], command?: string, output?: string): MvzPreview {
  return { archive, action, files: entries.map((entry) => entry.internalPath), count: entries.length, output, command }
}

function emptyData(action: MvzAction): MvzData {
  return { action, totalFiles: 0, totalArchives: 0, successCount: 0, failedCount: 0, results: [], preview: [] }
}

function result(success: boolean, message: string, data: MvzData): MvzResult {
  return { success, message, data }
}

function emit(onEvent: ((event: NodeRunEvent) => void) | undefined, type: NodeRunEvent["type"], progressValue: number, message: string, current?: string) {
  onEvent?.({ type, progress: progressValue, message: current ? `${message}|${current}` : message })
}

function progress(done: number, total: number): number {
  return Math.min(100, Math.max(0, Math.round((done / Math.max(total, 1)) * 100)))
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map((part) => /\s/.test(part) ? `"${part.replace(/"/g, "\\\"")}"` : part).join(" ")
}

function shortError(resultValue: MvzCommandResult): string {
  const message = (resultValue.stderr || resultValue.stdout || `exit code ${resultValue.code}`).trim()
  return message.length > 500 ? `...${message.slice(-497)}` : message
}
