import { hostCapabilities, type ExecResult } from "@xiranite/host-capabilities"
import { cpus } from "node:os"
import type { NetCounters, PowerMode, SleeptRuntime } from "./core.js"

/**
 * sleept's machine half, through the host capability surface (ADR-0079).
 *
 * Three reads stay outside the surface because the surface does not answer them, and none of them is an
 * oversight to be swept up later:
 *
 * - `cpus()` (`node:os`, the import above) — the CPU-idle percentage needs the per-cpu `times` sample, and
 *   `os.cpus()` answers only `{ count, models }`.
 * - `setTimeout` in `sleep` — the realm has no timers, and waiting is a host binding, not a node call.
 * - `new Date()` in `now` — `clock.now()` answers an ISO string asynchronously, while `SleeptRuntime.now` is a
 *   synchronous `() => Date` the countdown loop reads twice a second.
 */
const { proc, os } = hostCapabilities

export interface PowerCommand {
  executable: string
  args: string[]
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
  const { platform } = await os.platform()

  if (platform === "win32") {
    try {
      const result = await runOrThrow("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$ProgressPreference = 'SilentlyContinue'; Get-NetAdapterStatistics | ConvertTo-Json -Compress",
      ])
      const parsed = JSON.parse(result.stdout.trim() || "[]")
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

  if (platform === "darwin") {
    const result = await runCommand("netstat", ["-ibn"])
    return result.exitCode === 0 ? parseMacInterfaceCounters(result.stdout) : { bytesSent: 0, bytesReceived: 0 }
  }

  return { bytesSent: 0, bytesReceived: 0 }
}

/**
 * `netstat -ibn` answers one row per *address*, and repeats the interface's counters on every one of them —
 * measured on this machine, `en0` appears three times with identical `Ibytes`, and only the `<Link#N>` row is
 * the interface itself. Counting every row triples the total; counting `lo0` adds 22 GB of this machine's
 * loopback traffic while `Get-NetAdapterStatistics` never reported loopback as an adapter.
 *
 * Field positions are taken from the right because the link row may or may not carry a MAC address, which
 * shifts every column by one between interfaces.
 */
export function parseMacInterfaceCounters(stdout: string): NetCounters {
  let bytesSent = 0
  let bytesReceived = 0
  for (const line of stdout.split("\n")) {
    if (!line.includes("<Link#")) continue
    const fields = line.trim().split(/\s+/)
    if (fields.length < 10) continue
    const name = fields[0].replace(/\*+$/, "")
    if (name === "lo0") continue
    const received = Number(fields[fields.length - 5])
    const sent = Number(fields[fields.length - 2])
    if (!Number.isFinite(received) || !Number.isFinite(sent)) continue
    bytesReceived += received
    bytesSent += sent
  }
  return { bytesSent, bytesReceived }
}

async function executePowerAction(mode: PowerMode, dryrun: boolean): Promise<void> {
  if (dryrun) return

  const { platform } = await os.platform()
  const command = resolvePowerCommand(platform, mode)
  if (!command) throw new Error(`Hibernate is not supported by the ${platform} Sleept adapter.`)
  await runOrThrow(command.executable, command.args)
}

/** A plain `string`, not `NodeJS.Platform`: the value comes from `os.platform()`, which is a host fact in both transports. */
export function resolvePowerCommand(platform: string, mode: PowerMode): PowerCommand | undefined {
  if (platform === "win32") {
    if (mode === "sleep") return { executable: "rundll32.exe", args: ["powrprof.dll,SetSuspendState", "0,1,0"] }
    if (mode === "hibernate") return { executable: "shutdown", args: ["/h"] }
    if (mode === "shutdown") return { executable: "shutdown", args: ["/s", "/t", "1"] }
    return { executable: "shutdown", args: ["/r", "/t", "1"] }
  }

  if (platform === "darwin") {
    if (mode === "hibernate") return undefined
    if (mode === "sleep") return { executable: "pmset", args: ["sleepnow"] }
    return { executable: "osascript", args: ["-e", `tell app "System Events" to ${mode === "shutdown" ? "shut down" : "restart"}`] }
  }

  if (mode === "sleep") return { executable: "systemctl", args: ["suspend"] }
  if (mode === "hibernate") return { executable: "systemctl", args: ["hibernate"] }
  if (mode === "shutdown") return { executable: "systemctl", args: ["poweroff"] }
  return { executable: "systemctl", args: ["reboot"] }
}

export async function readClipboardText(): Promise<string> {
  const { platform } = await os.platform()

  if (platform === "win32") {
    const result = await runCommand("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw"])
    return result.exitCode === 0 ? result.stdout.trim() : ""
  }

  if (platform === "darwin") {
    const result = await runCommand("pbpaste", [])
    return result.exitCode === 0 ? result.stdout.trim() : ""
  }

  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0], command.slice(1))
    if (result.exitCode === 0 && result.stdout.trim()) return result.stdout.trim()
  }
  return ""
}

/**
 * The two session-level arms. Windows answers both through one `WM_SYSCOMMAND` broadcast — `SC_MONITORPOWER`
 * with `2` turns the display off, `SC_SCREENSAVE` starts whatever saver the session has configured — so this
 * node's existing `powershell.exe` grant covers them and no new program enters the policy. The command is
 * handed to PowerShell as a single argv element, so nothing here is shell-interpolated.
 */
const WINDOWS_SYSCOMMAND =
  '$sig=\'[System.Runtime.InteropServices.DllImport("user32.dll")]public static extern int SendMessage(int hWnd,int Msg,int wParam,int lParam);\';' +
  " Add-Type -MemberDefinition $sig -Name SessionPower -Namespace Xiranite;"

/** A failed child is the value `proc.exec` answers with; only a program that cannot be started rejects. */
async function runCommand(command: string, args: string[]): Promise<ExecResult> {
  try {
    return await proc.exec(command, args)
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      truncated: false,
    }
  }
}

/**
 * Both old call sites went through `promisify(execFile)`, which rejected on a non-zero exit — and a power
 * action whose caller cannot see the failure is a timer that says "executed" while the machine never slept.
 * `proc.exec` reports that exit as a value, so the rejection is restored here rather than dropped.
 */
async function runOrThrow(command: string, args: string[]): Promise<ExecResult> {
  const result = await proc.exec(command, args)
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.exitCode}${detail ? `: ${detail}` : ""}`)
  }
  return result
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
