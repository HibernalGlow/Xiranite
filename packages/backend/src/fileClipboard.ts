import { spawn } from "node:child_process"
import { constants, accessSync } from "node:fs"
import { lstat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export interface FileClipboardOptions {
  platform?: NodeJS.Platform
  effect?: FileClipboardEffect
  runPowerShell?: (encodedCommand: string, filesJson: string, effect: FileClipboardEffect) => Promise<void>
  runCommand?: ClipboardCommandRunner
  /** Test seam for Linux clipboard tool discovery. */
  isExecutableOnPath?: (name: string) => boolean
}

export type FileClipboardEffect = "copy" | "move"

export interface ReadFileClipboardOptions {
  platform?: NodeJS.Platform
  runPowerShell?: (encodedCommand: string) => Promise<string>
  runCommand?: ClipboardCommandRunner
  isExecutableOnPath?: (name: string) => boolean
}

export interface FileClipboardContents {
  paths: string[]
  effect: FileClipboardEffect
}

export interface ClearFileClipboardOptions {
  platform?: NodeJS.Platform
  runPowerShell?: (encodedCommand: string) => Promise<string>
  runCommand?: ClipboardCommandRunner
  isExecutableOnPath?: (name: string) => boolean
}

export interface ClipboardCommandInvocation {
  command: string
  args: string[]
  /** Written to the child's stdin before it is closed. */
  inputData?: string
  env?: NodeJS.ProcessEnv
}

export interface ClipboardCommandResult {
  code: number | null
  stdout: string
}

export type ClipboardCommandRunner = (invocation: ClipboardCommandInvocation) => Promise<ClipboardCommandResult>

export class NativeFileClipboardUnavailableError extends Error {
  constructor(detail = "Native file clipboard is not available on this system.") {
    super(detail)
    this.name = "NativeFileClipboardUnavailableError"
  }
}

export async function writeFilesToClipboard(paths: string[], options: FileClipboardOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform
  assertSupportedClipboardPlatform(platform)
  const files = [...new Set(paths.map((item) => path.resolve(item.trim())).filter(Boolean))]
  const effect = options.effect ?? "copy"
  if (files.length === 0) throw new Error("At least one local path is required.")
  if (files.length > 512) throw new Error("At most 512 local paths can be copied at once.")

  for (const file of files) {
    if (!await lstat(file).catch(() => undefined)) throw new Error(`Local path was not found: ${file}`)
  }

  if (platform === "win32") {
    const encoded = Buffer.from(fileDropListScript, "utf16le").toString("base64")
    await (options.runPowerShell ?? runPowerShell)(encoded, JSON.stringify(files), effect)
    return
  }
  if (platform === "darwin") {
    await (options.runCommand ?? runCommand)({
      command: "osascript",
      args: ["-l", "JavaScript", "-e", macWriteScript],
      env: { ...process.env, XIRANITE_CLIPBOARD_FILES: JSON.stringify(files) },
    })
    return
  }
  await (options.runCommand ?? runCommand)(linuxWriteInvocation(files, options.isExecutableOnPath ?? executableOnPath))
}

function assertSupportedClipboardPlatform(platform: NodeJS.Platform): void {
  if (platform !== "win32" && platform !== "darwin" && platform !== "linux") {
    throw new NativeFileClipboardUnavailableError(`Native file clipboard is not implemented on ${platform}.`)
  }
}

export async function readFilesFromClipboard(options: ReadFileClipboardOptions = {}): Promise<FileClipboardContents> {
  const platform = options.platform ?? process.platform
  if (platform === "win32") {
    const encodedCommand = Buffer.from(readFileDropListScript, "utf16le").toString("base64")
    const output = await (options.runPowerShell ?? runPowerShellOutput)(encodedCommand)
    return parseWindowsClipboardOutput(output)
  }
  if (platform === "darwin") {
    const result = await (options.runCommand ?? runCommand)({
      command: "osascript",
      args: ["-l", "JavaScript", "-e", macReadScript],
    })
    // macOS has no copy/move drop effect on the pasteboard; Finder always copies.
    return { paths: dedupe(parseUriList(result.stdout)), effect: "copy" }
  }
  if (platform === "linux") {
    const result = await (options.runCommand ?? runCommand)(linuxReadInvocation(options.isExecutableOnPath ?? executableOnPath))
    return { paths: dedupe(parseUriList(result.stdout)), effect: "copy" }
  }
  throw new NativeFileClipboardUnavailableError(`Native file clipboard is not implemented on ${platform}.`)
}

export async function clearFileClipboard(options: ClearFileClipboardOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform
  if (platform === "win32") {
    const encodedCommand = Buffer.from(clearFileDropListScript, "utf16le").toString("base64")
    await (options.runPowerShell ?? runPowerShellOutput)(encodedCommand)
    return
  }
  if (platform === "darwin") {
    await (options.runCommand ?? runCommand)({
      command: "osascript",
      args: ["-l", "JavaScript", "-e", macClearScript],
    })
    return
  }
  if (platform === "linux") {
    await (options.runCommand ?? runCommand)(linuxClearInvocation(options.isExecutableOnPath ?? executableOnPath))
    return
  }
  throw new NativeFileClipboardUnavailableError(`Native file clipboard is not implemented on ${platform}.`)
}

function parseWindowsClipboardOutput(output: string): FileClipboardContents {
  let decoded: string
  try {
    decoded = Buffer.from(output.trim(), "base64").toString("utf8")
  } catch {
    throw new Error("Native file clipboard returned invalid output.")
  }
  let contents: unknown
  try {
    contents = JSON.parse(decoded)
  } catch {
    throw new Error("Native file clipboard returned invalid output.")
  }
  if (!contents || typeof contents !== "object" || Array.isArray(contents)) {
    throw new Error("Native file clipboard returned invalid output.")
  }
  const { paths, effect } = contents as { paths?: unknown; effect?: unknown }
  if (!Array.isArray(paths) || paths.length > 512 || paths.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("Native file clipboard returned an invalid path list.")
  }
  if (effect !== "copy" && effect !== "move") throw new Error("Native file clipboard returned an invalid effect.")
  return { paths: dedupe(paths.map((item) => (item as string).trim())), effect }
}

function dedupe(paths: string[]): string[] {
  return [...new Set(paths)]
}

/** Parses a `text/uri-list` / newline separated list of `file://` URLs. */
function parseUriList(value: string): string[] {
  const paths: string[] = []
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    try {
      const url = new URL(line)
      if (url.protocol !== "file:") continue
      paths.push(fileURLToPath(url))
    } catch {
      continue
    }
  }
  return paths
}

function toUriList(files: string[]): string {
  return files.map((file) => pathToFileURL(file).href).join("\r\n")
}

function linuxWriteInvocation(files: string[], isExecutable: (name: string) => boolean): ClipboardCommandInvocation {
  const payload = toUriList(files)
  if (isExecutable("wl-copy")) {
    return { command: "wl-copy", args: ["--type", "text/uri-list"], inputData: payload }
  }
  if (isExecutable("xclip")) {
    return { command: "xclip", args: ["-selection", "clipboard", "-t", "text/uri-list", "-i"], inputData: payload }
  }
  throw new NativeFileClipboardUnavailableError("Native file clipboard on Linux requires wl-copy or xclip.")
}

function linuxReadInvocation(isExecutable: (name: string) => boolean): ClipboardCommandInvocation {
  if (isExecutable("wl-paste")) {
    return { command: "wl-paste", args: ["--no-newline", "--type", "text/uri-list"] }
  }
  if (isExecutable("xclip")) {
    return { command: "xclip", args: ["-selection", "clipboard", "-o", "-t", "text/uri-list"] }
  }
  throw new NativeFileClipboardUnavailableError("Native file clipboard on Linux requires wl-paste or xclip.")
}

function linuxClearInvocation(isExecutable: (name: string) => boolean): ClipboardCommandInvocation {
  if (isExecutable("wl-copy")) return { command: "wl-copy", args: ["--clear"] }
  if (isExecutable("xclip")) {
    return { command: "xclip", args: ["-selection", "clipboard", "-t", "text/uri-list", "-i"], inputData: "" }
  }
  throw new NativeFileClipboardUnavailableError("Native file clipboard on Linux requires wl-copy or xclip.")
}

function executableOnPath(name: string): boolean {
  const pathValue = process.env.PATH ?? ""
  return pathValue.split(path.delimiter).some((directory) => {
    if (!directory) return false
    try {
      accessSync(path.join(directory, name), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

function runCommand(invocation: ClipboardCommandInvocation): Promise<ClipboardCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      env: invocation.env,
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    let outputTooLarge = false
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      if (stdout.length > MAX_CLIPBOARD_OUTPUT_BYTES && !outputTooLarge) {
        outputTooLarge = true
        child.kill()
      }
    })
    child.stderr.on("data", (chunk: string) => { stderr += chunk })
    child.once("error", reject)
    child.once("close", (code) => {
      if (outputTooLarge) reject(new Error("Native file clipboard output exceeded the limit."))
      else if (code === 0) resolve({ code, stdout })
      else reject(new Error(stderr.trim() || `Native file clipboard exited with ${code}.`))
    })
    if (invocation.inputData === undefined) child.stdin.end()
    else child.stdin.end(invocation.inputData)
  })
}

function runPowerShell(encodedCommand: string, filesJson: string, effect: FileClipboardEffect): Promise<void> {
  return runPowerShellProcess(encodedCommand, { filesJson, effect }).then(() => undefined)
}

function runPowerShellOutput(encodedCommand: string): Promise<string> {
  return runPowerShellProcess(encodedCommand)
}

function runPowerShellProcess(
  encodedCommand: string,
  clipboardInput?: { filesJson: string; effect: FileClipboardEffect },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodedCommand], {
      env: {
        ...process.env,
        ...(clipboardInput === undefined ? {} : {
          XIRANITE_CLIPBOARD_FILES: clipboardInput.filesJson,
          XIRANITE_CLIPBOARD_EFFECT: clipboardInput.effect,
        }),
      },
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    let outputTooLarge = false
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      if (stdout.length > MAX_CLIPBOARD_OUTPUT_BYTES && !outputTooLarge) {
        outputTooLarge = true
        child.kill()
      }
    })
    child.stderr.on("data", (chunk: string) => { stderr += chunk })
    child.once("error", reject)
    child.once("close", (code) => {
      if (outputTooLarge) {
        reject(new Error("Native file clipboard output exceeded the limit."))
      } else if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(stderr.trim() || `Native file clipboard exited with ${code}.`))
      }
    })
  })
}

const macWriteScript = String.raw`
ObjC.import("AppKit");
ObjC.import("Foundation");
var pasteboard = $.NSPasteboard.generalPasteboard;
pasteboard.clearContents;
var raw = $.NSProcessInfo.processInfo.environment.objectForKey("XIRANITE_CLIPBOARD_FILES").js;
var files = JSON.parse(raw);
var urls = files.map(function (filePath) { return $.NSURL.fileURLWithPath($(filePath)); });
pasteboard.writeObjects($(urls));
`

const macReadScript = String.raw`
ObjC.import("AppKit");
var pasteboard = $.NSPasteboard.generalPasteboard;
var items = pasteboard.pasteboardItems;
var out = [];
for (var index = 0; index < items.count; index++) {
  var value = items.objectAtIndex(index).stringForType("public.file-url");
  if (value) out.push(ObjC.unwrap(value));
}
out.join("\n");
`

const macClearScript = String.raw`
ObjC.import("AppKit");
$.NSPasteboard.generalPasteboard.clearContents;
`

const fileDropListScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$paths = @(ConvertFrom-Json -InputObject $env:XIRANITE_CLIPBOARD_FILES)
$items = New-Object System.Collections.Specialized.StringCollection
foreach ($path in $paths) { [void]$items.Add([System.IO.Path]::GetFullPath([string]$path)) }
$dropEffect = if ($env:XIRANITE_CLIPBOARD_EFFECT -eq 'move') { [byte[]](2, 0, 0, 0) } else { [byte[]](1, 0, 0, 0) }
$dropEffectStream = New-Object System.IO.MemoryStream
$dropEffectStream.Write($dropEffect, 0, $dropEffect.Length)
$dropEffectStream.Position = 0
$data = New-Object System.Windows.Forms.DataObject
$data.SetFileDropList($items)
$data.SetData('Preferred DropEffect', $dropEffectStream)
for ($attempt = 0; $attempt -lt 5; $attempt++) {
  try {
    [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
    exit 0
  } catch {
    if ($attempt -eq 4) { throw }
    Start-Sleep -Milliseconds 80
  }
}
`

const readFileDropListScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$values = New-Object 'System.Collections.Generic.List[string]'
foreach ($path in [System.Windows.Forms.Clipboard]::GetFileDropList()) { [void]$values.Add([string]$path) }
$effect = 'copy'
$data = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($null -ne $data -and $data.GetDataPresent('Preferred DropEffect')) {
  $rawEffect = $data.GetData('Preferred DropEffect')
  $bytes = if ($rawEffect -is [System.IO.Stream]) {
    $rawEffect.Position = 0
    $buffer = New-Object byte[] 4
    [void]$rawEffect.Read($buffer, 0, $buffer.Length)
    $buffer
  } elseif ($rawEffect -is [byte[]]) { $rawEffect } else { [byte[]](0, 0, 0, 0) }
  if ($bytes.Length -ge 4 -and (([BitConverter]::ToUInt32($bytes, 0) -band 2) -eq 2)) { $effect = 'move' }
}
$json = ConvertTo-Json -Compress -InputObject @{ paths = [string[]]$values; effect = $effect }
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
`

const clearFileDropListScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
for ($attempt = 0; $attempt -lt 5; $attempt++) {
  try {
    [System.Windows.Forms.Clipboard]::Clear()
    exit 0
  } catch {
    if ($attempt -eq 4) { throw }
    Start-Sleep -Milliseconds 80
  }
}
`

const MAX_CLIPBOARD_OUTPUT_BYTES = 2 * 1024 * 1024
