import { spawn } from "node:child_process"
import { lstat } from "node:fs/promises"
import path from "node:path"

export interface FileClipboardOptions {
  platform?: NodeJS.Platform
  runPowerShell?: (encodedCommand: string, filesJson: string) => Promise<void>
}

export async function writeFilesToClipboard(paths: string[], options: FileClipboardOptions = {}): Promise<void> {
  if ((options.platform ?? process.platform) !== "win32") {
    throw new Error("Native file clipboard is currently available on Windows only.")
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

function runPowerShell(encodedCommand: string, filesJson: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encodedCommand], {
      env: { ...process.env, XIRANITE_CLIPBOARD_FILES: filesJson },
      windowsHide: true,
    })
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => { stderr += chunk })
    child.once("error", reject)
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `Native file clipboard exited with ${code}.`)))
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
