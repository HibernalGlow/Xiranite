import { hostCapabilities, type ExecResult } from "@xiranite/host-capabilities"
import { cpus } from "node:os"
import type { NetCounters, PowerMode, SleeptRuntime } from "./core.js"

/**
 * sleept's machine half, through the host capability surface (ADR-0079).
 *
 * One read stays outside the surface because the surface does not answer it, and it is not an oversight to
 * be swept up later:
 *
 * - `cpus()` (`node:os`, the import above) — the CPU-idle percentage needs the per-cpu `times` sample, and
 *   `os.cpus()` answers only `{ count, models }`. The host does answer this question, but as the `os`
 *   service's `cpu.usage`, which the CLI/TUI transport refuses by design (ADR-0079 §3), so it arrives with
 *   this node's run-in-the-host step rather than before it.
 *
 * Two entries this list used to carry are now gone. `new Date()` in `now` was never a gap — `Date` is part
 * of the language runtime, so the countdown loop reads the clock with no host operation at all (7 other node
 * cores read it the same way), and `clock.now()` is a synchronous ISO *string*, not the `Date` that
 * `SleeptRuntime.now` declares. `sleep` was the realm's missing timer, and it is now a host wait:
 * `clock.sleep` on both transports, which is what lets a countdown run inside QuickJS at all.
 */
const { clock, proc, os } = hostCapabilities

interface CpuSample {
  idle: number
  total: number
}

export interface PowerCommand {
  executable: string
  args: string[]
}

export function createNodeSleeptRuntime(): SleeptRuntime {
  // The baseline sample is taken here, not at module scope: a bundle must not touch the machine while it is
  // being evaluated (that import-time read is what made `sleept` fail to load in a realm), while a single
  // `status` call still needs a previous reading to compare against.
  lastCpuSample = readCpuSample()
  return {
    now: () => new Date(),
    // The host does the waiting, so the wait is interruptible: inside a realm this call parks a promise the
    // engine's pump settles, and the host checkpoints every ≤50 ms slice, which is how a cancel or a pause
    // lands in the middle of a tick instead of after it. One call is capped at `MAX_SLEEP_MS_PER_CALL`, and
    // every wait this node's core asks for is a 1 s or 0.5 s tick, so it is a single request, not a loop.
    sleep: (milliseconds) => clock.sleep(milliseconds).then(() => undefined),
    getCpuPercent: () => getCpuPercent(),
    getNetCounters: () => getNetCounters(),
    executePowerAction: (mode, dryrun) => executePowerAction(mode, dryrun),
  }
}

let lastCpuSample: CpuSample | null = null

async function getCpuPercent(): Promise<number | null> {
  const current = readCpuSample()
  if (current === null) return null
  const previous = lastCpuSample
  lastCpuSample = current
  // The first reading has no interval to compare against; `null` says "not measured yet" the same way the
  // host's missing `times` says "not answerable", instead of an invented 0 that the CPU monitor would read
  // as an idle machine and act on.
  if (previous === null) return null
  const idle = current.idle - previous.idle
  const total = current.total - previous.total
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
  if (!command) throw new Error(`${mode} is not supported by the ${platform} Sleept adapter.`)
  await runOrThrow(command.executable, command.args)
}

/** A plain `string`, not `NodeJS.Platform`: the value comes from `os.platform()`, which is a host fact in both transports. */
export function resolvePowerCommand(platform: string, mode: PowerMode): PowerCommand | undefined {
  const table = platform === "win32" ? WINDOWS_POWER_COMMANDS : platform === "darwin" ? MACOS_POWER_COMMANDS : LINUX_POWER_COMMANDS
  return table[mode]
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

/** One `WM_SYSCOMMAND` broadcast to every window, which is how Windows asks the session to power the screen. */
function windowsSysCommand(wParam: string, lParam: number): PowerCommand {
  return {
    executable: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      // `0x0112` is WM_SYSCOMMAND and the `-1` target is HWND_BROADCAST, so the session — not this process — acts.
      `${WINDOWS_SYSCOMMAND} [Xiranite.SessionPower]::SendMessage(-1,0x0112,${wParam},${lParam}) | Out-Null`,
    ],
  }
}

/**
 * The Windows table. Sleep goes through `SetSuspendState` rather than `shutdown /p` because hibernation has
 * to be requested as an option, not inferred, and the two session-level arms reuse the node's existing
 * `powershell.exe` grant instead of adding a program to the policy.
 */
const WINDOWS_POWER_COMMANDS = {
  sleep: { executable: "rundll32.exe", args: ["powrprof.dll,SetSuspendState", "0,1,0"] },
  hibernate: { executable: "shutdown", args: ["/h"] },
  shutdown: { executable: "shutdown", args: ["/s", "/t", "1"] },
  restart: { executable: "shutdown", args: ["/r", "/t", "1"] },
  "display-sleep": windowsSysCommand("0xF170", 2),
  screensaver: windowsSysCommand("0xF140", 0),
} as const satisfies Record<PowerMode, PowerCommand>

/**
 * The macOS table. `hibernate` is `undefined` on purpose — writing `pmset hibernatenow` here would turn a
 * refusal into a silent sleep, and the caller's message names the platform so the operator learns which
 * machine lacks the state. The two session arms are the ones measured on this machine as an ordinary user:
 * `pmset displaysleepnow` exits 0 and blanks the panel, and `open -a ScreenSaverEngine` returns in ~0.07s
 * while the engine really starts. `open` rather than the engine binary itself, because that binary runs until
 * the user dismisses it and a power action that never returns would hold the operation open.
 */
const MACOS_POWER_COMMANDS = {
  sleep: { executable: "pmset", args: ["sleepnow"] },
  hibernate: undefined,
  shutdown: { executable: "osascript", args: ["-e", 'tell app "System Events" to shut down'] },
  restart: { executable: "osascript", args: ["-e", 'tell app "System Events" to restart'] },
  "display-sleep": { executable: "pmset", args: ["displaysleepnow"] },
  screensaver: { executable: "open", args: ["-a", "ScreenSaverEngine"] },
} as const satisfies Record<PowerMode, PowerCommand | undefined>

/**
 * The Linux table. Not a delivery target yet, so the arms are stated rather than dressed up: `systemctl` for
 * the machine states, `xset dpms` for the panel, and the X11 saver's own control command for the saver.
 * There is no portal-backed way to say "start the saver now", and naming a lock instead would be a different
 * answer than the one asked for.
 */
const LINUX_POWER_COMMANDS = {
  sleep: { executable: "systemctl", args: ["suspend"] },
  hibernate: { executable: "systemctl", args: ["hibernate"] },
  shutdown: { executable: "systemctl", args: ["poweroff"] },
  restart: { executable: "systemctl", args: ["reboot"] },
  "display-sleep": { executable: "xset", args: ["dpms", "force", "off"] },
  screensaver: { executable: "xscreensaver-command", args: ["-activate"] },
} as const satisfies Record<PowerMode, PowerCommand>

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

/**
 * A `node:os` CPU sample, or `null` when the answer carries no per-cpu `times`.
 *
 * The face gets Node's array; inside a bundle `node:os` is the shim, whose `cpus()` forwards the host's
 * `os.cpus` answer — `{ count, models }` with no `times` (ADR-0079 gap ④). Returning `null` is what keeps
 * that from reading as "0% busy": the metric is unanswerable there, not idle.
 */
function readCpuSample(): CpuSample | null {
  const list = cpus()
  if (!Array.isArray(list) || list.length === 0) return null
  let idle = 0
  let total = 0
  for (const cpu of list) {
    const times = cpu?.times
    if (!times || typeof times.idle !== "number") return null
    total += times.user + times.nice + times.sys + times.idle + times.irq
    idle += times.idle
  }
  return { idle, total }
}
