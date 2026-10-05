import { hostCapabilities } from "@xiranite/host-capabilities"

interface CommandResult {
  code: number
  stdout: string
}

/**
 * linedup's only machine answer is the clipboard, so this file is one probe deep.
 *
 * The platform read is `os.platform()` and each helper program is `proc.exec`, both host operations now;
 * which programs this node may run is the manifest's decision, not this file's. A non-zero exit is a value
 * there rather than a throw, which is what `runCommand` already modelled, and a program that is not
 * installed at all is what keeps the Linux candidate loop walking.
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

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  const { proc } = hostCapabilities
  try {
    const result = await proc.exec(command, args)
    // `exitCode: null` means the host killed the child; the old `execFile` callback reported that as `1` too.
    return { code: result.exitCode ?? 1, stdout: result.stdout }
  } catch {
    // A missing binary is what this probe expects on a machine without that clipboard helper: both
    // transports reject the launch, and the caller must keep walking its candidates instead of failing.
    return { code: 1, stdout: "" }
  }
}
