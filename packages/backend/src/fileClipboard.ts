import { spawn } from "node:child_process"
import { lstat } from "node:fs/promises"
import path from "node:path"

export interface FileClipboardOptions {
  platform?: NodeJS.Platform
  runPowerShell?: (encodedCommand: string, filesJson: string) => Promise<void>
}

export interface ReadFileClipboardOptions {
  platform?: NodeJS.Platform
  runPowerShell?: (encodedCommand: string) => Promise<string>
}

export interface ClearFileClipboardOptions {
  platform?: NodeJS.Platform
  runPowerShell?: (encodedCommand: string) => Promise<string>
}

export class NativeFileClipboardUnavailableError extends Error {
  constructor() {
    super("Native file clipboard is currently available on Windows only.")
    this.name = "NativeFileClipboardUnavailableError"
  }
}

export async function writeFilesToClipboard(paths: string[], options: FileClipboardOptions = {}): Promise<void> {
  if ((options.platform ?? process.platform) !== "win32") {
    throw new NativeFileClipboardUnavailableError()
  }
  const files = [...new Set(paths.map((item) => path.resolve(item.trim())).filter(Boolean))]
  if (files.length === 0) throw new Error("At least one local path is required.")
  if (files.length > 512) throw new Error("At most 512 local paths can be copied at once.")

  for (const file of files) {
    if (!await lstat(file).catch(() => undefined)) throw new Error(`Local path was not found: ${file}`)
  }

  const encoded = Buffer.from(fileDropListScript, "utf16le").toString("base64")
  await (options.runPowerShell ?? runPowerShell)(encoded, JSON.stringify(files))
}

export async function readFilesFromClipboard(options: ReadFileClipboardOptions = {}): Promise<string[]> {
  if ((options.platform ?? process.platform) !== "win32") throw new NativeFileClipboardUnavailableError()
  const encodedCommand = Buffer.from(readFileDropListScript, "utf16le").toString("base64")
  const output = await (options.runPowerShell ?? runPowerShellOutput)(encodedCommand)
  let decoded: string
  try {
    decoded = Buffer.from(output.trim(), "base64").toString("utf8")
  } catch {
    throw new Error("Native file clipboard returned invalid output.")
  }
  let paths: unknown
  try {
    paths = JSON.parse(decoded)
  } catch {
    throw new Error("Native file clipboard returned invalid output.")
  }
  if (!Array.isArray(paths) || paths.length > 512 || paths.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("Native file clipboard returned an invalid path list.")
  }
  return [...new Set(paths.map((item) => (item as string).trim()))]
}

export async function clearFileClipboard(options: ClearFileClipboardOptions = {}): Promise<void> {
  if ((options.platform ?? process.platform) !== "win32") throw new NativeFileClipboardUnavailableError()
  const encodedCommand = Buffer.from(clearFileDropListScript, "utf16le").toString("base64")
  await (options.runPowerShell ?? runPowerShellOutput)(encodedCommand)
}

function runPowerShell(encodedCommand: string, filesJson: string): Promise<void> {
  return runPowerShellProcess(encodedCommand, filesJson).then(() => undefined)
}

function runPowerShellOutput(encodedCommand: string): Promise<string> {
  return runPowerShellProcess(encodedCommand)
}

function runPowerShellProcess(encodedCommand: string, filesJson?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodedCommand], {
      env: { ...process.env, ...(filesJson === undefined ? {} : { XIRANITE_CLIPBOARD_FILES: filesJson }) },
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

const fileDropListScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$paths = @(ConvertFrom-Json -InputObject $env:XIRANITE_CLIPBOARD_FILES)
$items = New-Object System.Collections.Specialized.StringCollection
foreach ($path in $paths) { [void]$items.Add([System.IO.Path]::GetFullPath([string]$path)) }
for ($attempt = 0; $attempt -lt 5; $attempt++) {
  try {
    [System.Windows.Forms.Clipboard]::SetFileDropList($items)
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
$json = ConvertTo-Json -Compress -InputObject ([string[]]$values)
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
