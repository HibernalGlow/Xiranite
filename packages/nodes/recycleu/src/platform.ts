import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { EmptyRecycleBinResult, RecycleuRuntime } from "./core.js"

const execFileAsync = promisify(execFile)

export function createNodeRecycleuRuntime(): RecycleuRuntime {
  return {
    now: () => new Date(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    emptyRecycleBin: () => emptyRecycleBin(),
  }
}

async function emptyRecycleBin(): Promise<EmptyRecycleBinResult> {
  if (process.platform !== "win32") {
    return {
      status: "unsupported",
      message: "Recycle bin cleanup is only supported on Windows.",
    }
  }

  try {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Clear-RecycleBin -Force -ErrorAction Stop",
    ])
    return { status: "cleaned", message: "Recycle bin emptied." }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/empty|not contain|cannot find/i.test(message)) {
      return { status: "empty", message: "Recycle bin is already empty." }
    }
    return { status: "failed", message: `Failed to empty recycle bin: ${message}` }
  }
}
