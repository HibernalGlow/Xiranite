import { spawn } from "node:child_process"

export type LocalFilePickerKind = "files" | "directory"

export async function pickLocalPaths(kind: LocalFilePickerKind): Promise<string[]> {
  if (process.platform !== "win32") throw new Error("Native local file selection is currently available on Windows desktop only.")
  const script = kind === "directory" ? folderPickerScript : filePickerScript
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const output = await runPowerShell(encoded)
  if (!output.trim()) return []
  const parsed = JSON.parse(output) as unknown
  if (Array.isArray(parsed)) return parsed.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
  return typeof parsed === "string" && parsed.trim() ? [parsed] : []
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
