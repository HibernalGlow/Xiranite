import { spawn } from "node:child_process"
import { constants, accessSync } from "node:fs"
import { delimiter, join } from "node:path"

export type LocalFilePickerKind = "files" | "directory"

export async function pickLocalPaths(kind: LocalFilePickerKind): Promise<string[]> {
  if (process.platform === "win32") return pickWithWindowsDialog(kind)
  if (process.platform === "darwin") return pickWithMacOsDialog(kind)
  if (process.platform === "linux") return pickWithLinuxDialog(kind)
  throw new Error(`Native local file selection is not implemented on ${process.platform}.`)
}

async function pickWithWindowsDialog(kind: LocalFilePickerKind): Promise<string[]> {
  const script = kind === "directory" ? folderPickerScript : filePickerScript
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const output = await runPowerShell(encoded)
  if (!output.trim()) return []
  const parsed = JSON.parse(output) as unknown
  if (Array.isArray(parsed)) return parsed.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
  return typeof parsed === "string" && parsed.trim() ? [parsed] : []
}

/**
 * macOS has no bundled dialog helper, so drive the native panel through
 * `osascript`. A user cancel surfaces as AppleScript error -128 and is handled
 * inside the script, leaving empty output rather than a failure.
 */
async function pickWithMacOsDialog(kind: LocalFilePickerKind): Promise<string[]> {
  const script = kind === "directory" ? macFolderPickerScript : macFilePickerScript
  const result = await runCommand("osascript", ["-e", script])
  if (result.code !== 0) return []
  return splitPickerOutput(result.stdout)
}

/**
 * Linux desktops differ: GTK environments ship `zenity`, KDE ships `kdialog`.
 * Prefer zenity and fall back, reporting a clear error when neither exists.
 */
async function pickWithLinuxDialog(kind: LocalFilePickerKind): Promise<string[]> {
  if (executableOnPath("zenity")) {
    const args = kind === "directory"
      ? ["--file-selection", "--directory", "--title=选择包含待转换图片的本地文件夹"]
      : ["--file-selection", "--multiple", "--separator=\n", "--title=选择待转换图片"]
    const result = await runCommand("zenity", args)
    if (result.code !== 0) return []
    return splitPickerOutput(result.stdout)
  }
  if (executableOnPath("kdialog")) {
    const args = kind === "directory"
      ? ["--getexistingdirectory", "."]
      : ["--getopenfilename", ".", "--multiple", "--separate-output"]
    const result = await runCommand("kdialog", args)
    if (result.code !== 0) return []
    return splitPickerOutput(result.stdout)
  }
  throw new Error("Native local file selection requires zenity or kdialog on Linux.")
}

function splitPickerOutput(value: string): string[] {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
}

function executableOnPath(name: string): boolean {
  const pathValue = process.env.PATH ?? ""
  return pathValue.split(delimiter).some((directory) => {
    if (!directory) return false
    try {
      accessSync(join(directory, name), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

interface CommandResult {
  code: number | null
  stdout: string
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args)
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => { stdout += chunk })
    child.stderr.on("data", (chunk: string) => { stderr += chunk })
    child.once("error", reject)
    child.once("close", (code) => resolve({ code, stdout }))
  })
}

function runPowerShell(encodedCommand: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-STA", "-EncodedCommand", encodedCommand], { windowsHide: true })
    let stdout = "", stderr = ""
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => { stdout += chunk })
    child.stderr.on("data", (chunk: string) => { stderr += chunk })
    child.once("error", reject)
    child.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `Native picker exited with ${code}.`)))
  })
}

const macFilePickerScript = String.raw`
try
  set chosenFiles to choose file with prompt "选择待转换图片" with multiple selections allowed
on error number -128
  return ""
end try
set output to ""
repeat with chosenFile in chosenFiles
  set output to output & POSIX path of chosenFile & linefeed
end repeat
return output
`

const macFolderPickerScript = String.raw`
try
  set chosenFolder to choose folder with prompt "选择包含待转换图片的本地文件夹"
on error number -128
  return ""
end try
return POSIX path of chosenFolder
`

const filePickerScript = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '选择待转换图片'
$dialog.Multiselect = $true
$dialog.CheckFileExists = $true
$dialog.Filter = '图片文件|*.jxl;*.jpg;*.jpeg;*.jfif;*.jif;*.jpe;*.png;*.apng;*.gif;*.webp;*.jp2;*.bmp;*.ico;*.tiff;*.tif;*.avif|所有文件|*.*'
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { @($dialog.FileNames) | ConvertTo-Json -Compress } else { '[]' }
`

const folderPickerScript = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择包含待转换图片的本地文件夹'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { @($dialog.SelectedPath) | ConvertTo-Json -Compress } else { '[]' }
`
