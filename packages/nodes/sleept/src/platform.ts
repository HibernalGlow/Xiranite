import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { cpus } from "node:os"
import type { NetCounters, PowerMode, SleeptRuntime } from "./core.js"

const execFileAsync = promisify(execFile)

interface CommandResult {
  code: number
  stdout: string
}

let lastCpuSample = readCpuSample()

export function createNodeSleeptRuntime(): SleeptRuntime {
  return {
    now: () => new Date(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    getCpuPercent: () => getCpuPercent(),
    getNetCounters: () => getNetCounters(),
    executePowerAction: (mode, dryrun) => executePowerAction(mode, dryrun),
  }
}

async function getCpuPercent(): Promise<number> {
  const current = readCpuSample()
  const idle = current.idle - lastCpuSample.idle
  const total = current.total - lastCpuSample.total
  lastCpuSample = current
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, 100 - (idle / total) * 100))
}

async function getNetCounters(): Promise<NetCounters> {
  const platform = process.platform

  if (platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$ProgressPreference = 'SilentlyContinue'; Get-NetAdapterStatistics | ConvertTo-Json -Compress",
      ])
      const parsed = JSON.parse(stdout.trim() || "[]")
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      return rows.reduce<NetCounters>(
        (acc, row) => ({
          bytesSent: acc.bytesSent + Number(row.SentBytes ?? 0),
          bytesReceived: acc.bytesReceived + Number(row.ReceivedBytes ?? 0),
        }),
        { bytesSent: 0, bytesReceived: 0 },
      )
    } catch {
      return { bytesSent: 0, bytesReceived: 0 }
    }
  }

  return { bytesSent: 0, bytesReceived: 0 }
}

async function executePowerAction(mode: PowerMode, dryrun: boolean): Promise<void> {
  if (dryrun) return

  if (process.platform === "win32") {
    if (mode === "sleep") {
      await execFileAsync("rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"])
      return
    }
    if (mode === "shutdown") {
      await execFileAsync("shutdown", ["/s", "/t", "1"])
      return
    }
    await execFileAsync("shutdown", ["/r", "/t", "1"])
    return
  }

  if (process.platform === "darwin") {
    if (mode === "sleep") await execFileAsync("pmset", ["sleepnow"])
    else await execFileAsync("osascript", ["-e", `tell app "System Events" to ${mode === "shutdown" ? "shut down" : "restart"}`])
    return
  }

  if (mode === "sleep") await execFileAsync("systemctl", ["suspend"])
  else if (mode === "shutdown") await execFileAsync("systemctl", ["poweroff"])
  else await execFileAsync("systemctl", ["reboot"])
}

export async function readClipboardText(): Promise<string> {
  if (process.platform === "win32") {
    const result = await runCommand("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw"])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  if (process.platform === "darwin") {
    const result = await runCommand("pbpaste", [])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0], command.slice(1))
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim()
  }
  return ""
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 32, encoding: "utf8" }, (error, stdout) => {
      const code = typeof (error as { code?: unknown } | null)?.code === "number" ? (error as { code: number }).code : error ? 1 : 0
      resolveResult({ code, stdout: stdout ?? "" })
    })
  })
}

function readCpuSample(): { idle: number; total: number } {
  return cpus().reduce(
    (acc, cpu) => {
      const times = cpu.times
      const total = times.user + times.nice + times.sys + times.idle + times.irq
      return { idle: acc.idle + times.idle, total: acc.total + total }
    },
    { idle: 0, total: 0 },
  )
}
