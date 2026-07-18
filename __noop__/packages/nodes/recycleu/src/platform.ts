import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { EmptyRecycleBinResult, RecycleuRuntime } from "./core.js"

const execFileAsync = promisify(execFile)

export function createNodeRecycleuRuntime(): RecycleuRuntime {
  return {
    now: () => new Date(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    emptyRecycleBin: (driveLetter) => emptyRecycleBin(driveLetter),
  }
}

export async function readClipboardText(): Promise<string> {
  if (process.platform === "win32") {
    const result = await runCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw",
    ])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  if (process.platform === "darwin") {
    const result = await runCommand("pbpaste", [])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0]!, command.slice(1))
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim()
  }

  return ""
}

interface CommandResult {
  code: number
  stdout: string
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      const code = typeof (error as NodeJS.ErrnoException | null)?.code === "number" ? Number((error as NodeJS.ErrnoException).code) : error ? 1 : 0
      resolve({ code, stdout: stdout ?? "" })
    })
  })
}

async function emptyRecycleBin(driveLetter?: string): Promise<EmptyRecycleBinResult> {
  if (process.platform !== "win32") {
    return {
      status: "unsupported",
      message: "Recycle bin cleanup is only supported on Windows.",
    }
  }

  const scopedDrive = driveLetter?.trim().match(/^([a-zA-Z])(?::)?$/)?.[1].toUpperCase()
  if (driveLetter && !scopedDrive) {
    return { status: "failed", message: `Invalid recycle bin drive letter: ${driveLetter}` }
  }

  try {
    const clearCommand = scopedDrive
      ? `Clear-RecycleBin -DriveLetter ${scopedDrive} -Force -ErrorAction Stop`
      : "Clear-RecycleBin -Force -ErrorAction Stop"
    const command = `$ProgressPreference = 'SilentlyContinue'; ${clearCommand}`
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ])
    return { status: "cleaned", message: scopedDrive ? `Recycle bin emptied for drive ${scopedDrive}:.` : "Recycle bin emptied." }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/empty|not contain|cannot find/i.test(message)) {
      return { status: "empty", message: "Recycle bin is already empty." }
    }
    return { status: "failed", message: `Failed to empty recycle bin: ${message}` }
  }
}
