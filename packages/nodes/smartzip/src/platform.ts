import { execFile } from "node:child_process"
import { appendFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, extname, join, parse } from "node:path"
import type { NodeRunEvent } from "@xiranite/contract"
import type {
  CommandResult,
  SmartZipCommandPlan,
  SmartZipConfig,
  SmartZipExecutionRequest,
  SmartZipOperationResult,
  SmartZipRuntime,
  SmartZipTools,
} from "./core.js"

export function createNodeSmartZipRuntime(): SmartZipRuntime {
  return {
    readText: (path) => readFile(path, "utf8"),
    appendRecord,
    find7z,
    execute,
  }
}

export const createNodeSmartzipRuntime = createNodeSmartZipRuntime

async function find7z(configuredDirectory = ""): Promise<SmartZipTools | null> {
  const configured = configuredDirectory && configuredDirectory !== "auto" && !configuredDirectory.includes("%SmartZipDir%")
    ? configuredDirectory
    : ""
  const cliCandidates = configured ? [join(configured, "7z.exe"), join(configured, "7z")] : []
  cliCandidates.push(
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
    join(process.env.LOCALAPPDATA ?? "", "7-Zip", "7z.exe"),
  )
  for (const candidate of cliCandidates) {
    if (!candidate || !await pathExists(candidate)) continue
    const fileManager = join(dirname(candidate), process.platform === "win32" ? "7zFM.exe" : "7zFM")
    return { cli: candidate, fileManager: await pathExists(fileManager) ? fileManager : undefined }
  }
  for (const name of ["7z", "7z.exe", "7za", "7za.exe", "7zz", "7zz.exe"]) {
    const located = await runRaw(process.platform === "win32" ? "where.exe" : "which", [name])
    const cli = located.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    if (located.code !== 0 || !cli) continue
    const fileManager = join(dirname(cli), process.platform === "win32" ? "7zFM.exe" : "7zFM")
    return { cli, fileManager: await pathExists(fileManager) ? fileManager : undefined }
  }
  return null
}

async function execute(request: SmartZipExecutionRequest, onEvent: (event: NodeRunEvent) => void): Promise<SmartZipOperationResult[]> {
  if (request.action === "archive") return archivePaths(request, onEvent)
  if (request.action === "open") return smartOpen(request, onEvent)
  const results: SmartZipOperationResult[] = []
  for (let index = 0; index < request.paths.length; index += 1) {
    const sourcePath = request.paths[index]!
    onEvent({ type: "progress", progress: Math.round(index / request.paths.length * 100), message: `Extracting ${basename(sourcePath)}` })
    results.push(await extractArchive(sourcePath, request, 0))
  }
  onEvent({ type: "progress", progress: 100, message: "Smart extraction completed." })
  return results
}

async function extractArchive(sourcePath: string, request: SmartZipExecutionRequest, depth: number): Promise<SmartZipOperationResult> {
  if (!await pathExists(sourcePath)) return operationError(request.action, sourcePath, "Path does not exist.")
  const multipart = multipartKind(sourcePath)
  if (request.config.skipMultipart && multipart === "continuation") {
    return { action: request.action, sourcePath, status: "skipped", message: "Skipped a non-first multipart archive." }
  }
  const outputRoot = request.config.targetDir && await isDirectory(request.config.targetDir)
    ? request.config.targetDir
    : dirname(sourcePath)
  await mkdir(outputRoot, { recursive: true })
  const temporary = await mkdtemp(join(outputRoot, ".smartzip-"))
  const candidates = passwordCandidates(sourcePath, request.config)
  let password: string | undefined
  let tested: CommandResult | undefined
  for (const candidate of candidates) {
    const testPassword = candidate || "__XIRANITE_NO_PASSWORD__"
    const args = ["t", sourcePath, "-y", "-sccUTF-8", `-p${testPassword}`]
    tested = await runRaw(request.tools.cli, args)
    if (tested.code === 0) {
      password = candidate || undefined
      break
    }
  }
  if (!tested || tested.code !== 0) {
    await rm(temporary, { force: true, recursive: true })
    return operationError(request.action, sourcePath, "Archive test failed; no configured password succeeded.", tested)
  }
  const args = [
    "x",
    sourcePath,
    `-o${temporary}`,
    "-aoa",
    "-y",
    "-sccUTF-8",
    ...(password ? [`-p${password}`] : []),
    ...(request.codePage ? [`-mcp=${request.codePage}`] : []),
    ...excludeArgs(request.config),
  ]
  const displayArgs = args.map((arg) => arg.startsWith("-p") ? "-p••••" : arg)
  const command: SmartZipCommandPlan = { label: `Extract ${sourcePath}`, command: request.tools.cli, args: displayArgs }
  const commandResult = await runRaw(request.tools.cli, args)
  if (commandResult.code !== 0) {
    await rm(temporary, { force: true, recursive: true })
    return operationError(request.action, sourcePath, commandResult.stderr || commandResult.stdout || "7-Zip extraction failed.", commandResult, command)
  }
  await applyPostExtractionRules(temporary, request.config)
  const outputPath = await materializeExtraction(temporary, sourcePath, outputRoot)

  if (depth < 32 && request.config.nestedExtraction) {
    const nested = await nestedArchiveCandidates(outputPath, request, request.config.nestedExtractionForMultiple)
    for (const nestedPath of nested) {
      const nestedResult = await extractArchive(nestedPath, request, depth + 1)
      if (nestedResult.status === "completed" && multipartKind(nestedPath) !== "continuation") {
        await recyclePath(nestedPath)
      }
    }
  }
  if (request.config.deleteSource || (password && request.config.deleteSourceWhenPassword)) {
    await recyclePath(sourcePath)
  }
  return {
    action: request.action,
    sourcePath,
    outputPath,
    status: "completed",
    message: password ? "Extracted with a configured password." : "Extracted.",
    command,
    commandResult,
    passwordUsed: Boolean(password),
  }
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
    const commandResult = await runRaw(command.command, command.args)
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
    ? isConfiguredArchive(singlePath, request.config) || (await runRaw(request.tools.cli, ["l", singlePath, "-sccUTF-8"])).code === 0
    : false
  if (singlePath && archiveDetected && request.tools.fileManager) {
    const path = singlePath
    const command: SmartZipCommandPlan = { label: `Open ${path}`, command: request.tools.fileManager, args: [path], detached: true }
    const commandResult = await runRaw(command.command, command.args, true)
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
      await rm(path, { force: true, recursive: true })
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
    if (nextName && nextName !== name) await rename(path, await uniquePath(join(dirname(path), nextName)))
  }
}

async function materializeExtraction(temporary: string, archivePath: string, outputRoot: string): Promise<string> {
  const top = await readdir(temporary, { withFileTypes: true })
  const walked = await walk(temporary)
  const fileFlags = await Promise.all(walked.map(isFile))
  const files = walked.filter((_path, index) => fileFlags[index])
  let source: string
  if (top.length === 1) source = join(temporary, top[0]!.name)
  else if (files.length === 1) source = files[0]!
  else source = temporary
  const defaultName = source === temporary ? parse(basename(archivePath)).name : basename(source)
  const output = await uniquePath(join(outputRoot, defaultName))
  await rename(source, output)
  if (source !== temporary) await rm(temporary, { force: true, recursive: true })
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
    const result = await runRaw(request.tools.cli, ["l", "-slt", path, "-sccUTF-8", `-p${password}`])
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

async function walk(root: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    result.push(path)
    if (entry.isDirectory()) result.push(...await walk(path))
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
  try { await stat(path); return true } catch { return false }
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory() } catch { return false }
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile() } catch { return false }
}

async function recyclePath(path: string): Promise<void> {
  if (process.platform === "win32") {
    const method = await isDirectory(path) ? "DeleteDirectory" : "DeleteFile"
    const escaped = path.replaceAll("'", "''")
    const script = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${method}('${escaped}', [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`
    const result = await runRaw("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
    if (result.code !== 0) throw new Error(result.stderr || `Unable to move ${path} to the Recycle Bin.`)
    return
  }
  const command = process.platform === "darwin" ? "osascript" : "gio"
  const args = process.platform === "darwin"
    ? ["-e", `tell application \"Finder\" to delete POSIX file \"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}\"`]
    : ["trash", path]
  const result = await runRaw(command, args)
  if (result.code !== 0) throw new Error(result.stderr || `Unable to move ${path} to trash.`)
}

async function runRaw(command: string, args: string[], detached = false): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 32 }, (error, stdout, stderr) => {
      const rawCode = (error as { code?: unknown } | null)?.code
      const code = typeof rawCode === "number" ? rawCode : error ? 1 : 0
      resolveResult({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? (error instanceof Error ? error.message : "")) })
    })
    if (detached) {
      child.once("spawn", () => resolveResult({ code: 0, stdout: "", stderr: "" }))
      child.unref()
    }
  })
}

async function appendRecord(path: string, record: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8")
}
