import { hostCapabilities } from "@xiranite/host-capabilities"
import type { EmptyRecycleBinResult, RecycleuRuntime } from "./core.js"

export function createNodeRecycleuRuntime(): RecycleuRuntime {
  return {
    now: () => new Date(),
    // `RecycleuRuntime.sleep` is a synchronous-contract timer (`core.ts:21`) and the realm has no timers by
    // design, so this stays the JS global it was: the host answers a wait, it does not start one here.
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    emptyRecycleBin: (driveLetter) => emptyRecycleBin(driveLetter),
  }
}

/**
 * The clipboard probe, through `proc.exec`.
 *
 * Which programs this node may run is the manifest's decision (`docs/xiranite-target-node-manifest.json`),
 * not this file's: an undeclared program is refused by the host and the refusal lands in the same
 * "no text from this backend" answer a missing binary already gave.
 */
export async function readClipboardText(): Promise<string> {
  const { os } = hostCapabilities
  const platform = (await os.platform()).platform

  if (platform === "win32") {
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

  if (platform === "darwin") {
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
  const { proc } = hostCapabilities
  try {
    const result = await proc.exec(command, args)
    return { code: result.exitCode ?? 1, stdout: result.stdout }
  } catch {
    // Both transports reject an unlaunchable program; the old callback read that as a non-zero exit, and the
    // candidate loop in `readClipboardText` has to keep walking.
    return { code: 1, stdout: "" }
  }
}

/**
 * `Clear-RecycleBin`, with PowerShell's own wording kept as the only signal for "already empty".
 *
 * `proc.exec` answers a non-zero exit as a value instead of the throw `execFileAsync` raised, so the exit
 * code is turned back into the stderr text the status regex reads — the same text Node used to fold into the
 * rejection message. A launch that never happened (no such program, or a host refusal) still arrives here as
 * an error and keeps its own message.
 */
async function emptyRecycleBin(driveLetter?: string): Promise<EmptyRecycleBinResult> {
  const { os, proc } = hostCapabilities
  if ((await os.platform()).platform !== "win32") {
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
    const result = await proc.exec("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ])
    if (result.exitCode === 0) {
      return { status: "cleaned", message: scopedDrive ? `Recycle bin emptied for drive ${scopedDrive}:.` : "Recycle bin emptied." }
    }
    return classifyFailure(result.stderr.trim() || `Clear-RecycleBin exited with code ${result.exitCode}.`)
  } catch (error) {
    return classifyFailure(error instanceof Error ? error.message : String(error))
  }
}

function classifyFailure(message: string): EmptyRecycleBinResult {
  if (/empty|not contain|cannot find/i.test(message)) {
    return { status: "empty", message: "Recycle bin is already empty." }
  }
  return { status: "failed", message: `Failed to empty recycle bin: ${message}` }
}
