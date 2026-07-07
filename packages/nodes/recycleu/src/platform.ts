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
