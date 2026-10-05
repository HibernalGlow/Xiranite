import { hostCapabilities } from "@xiranite/host-capabilities"
import type { NetCounters, PowerMode, SleeptRuntime } from "./core.js"

/**
 * sleept's machine half: every question about this machine is asked of the host, in one vocabulary.
 *
 * This file used to shell out — `netstat -ibn` and `Get-NetAdapterStatistics` for traffic, `pmset`/
 * `osascript`/`open`/`shutdown`/`rundll32.exe`/`systemctl`/`xset`/`xscreensaver-command` for the six power
 * modes — because that is what a Node process does when nothing else answers. ADR-0074's grant audit refused
 * to sign those call sites (an interpreter on an allowlist is a script runner), and ADR-0079 §3 put the answers
 * on host services instead. So a bundle running here reaches the machine through exactly two names: `os` for
 * readings, `power` for state changes. The node keeps its verdict — the threshold, how many quiet samples
 * count, what to do about it — and the host keeps the mechanism.
 *
 * What that costs and what it buys is stated where it matters below: the `restart` → `reboot` spelling, the
 * loopback exclusion this file owns because the host reports every interface, and a `dryRun` that now reaches
 * the host's gate so a rehearsal reports a platform refusal instead of printing success about an action this
 * machine cannot perform.
 */
const { clock, service } = hostCapabilities

/**
 * The node's word for a mode → the action the `power` service answers.
 *
 * Five of six are the same string; `restart` is the one place the product vocabulary and the host's differ,
 * because the host names its arms after the OS calls (`system_shutdown`'s `reboot`) while the faces and this
 * node's help text say what the operator sees. A translation table this short is the honest shape: the
 * alternative was two vocabularies in three faces plus the manifest.
 */
export const POWER_ACTIONS: Record<PowerMode, string> = {
  sleep: "sleep",
  hibernate: "hibernate",
  shutdown: "shutdown",
  restart: "reboot",
  "display-sleep": "display-sleep",
  screensaver: "screensaver",
}

/** One row of the host's `os.net.counters` answer, as far as this file needs it. */
export interface InterfaceCounters {
  name: string
  receivedTotal: number
  transmittedTotal: number
}

export function createNodeSleeptRuntime(): SleeptRuntime {
  return {
    now: () => new Date(),
    // The host does the waiting, so the wait is interruptible: inside a realm this call parks a promise the
    // engine's pump settles, and the host checkpoints every ≤50 ms slice, which is how a cancel or a pause
    // lands in the middle of a tick instead of after it. One call is capped at `MAX_SLEEP_MS_PER_CALL`, and
    // every wait this node's core asks for is a 1 s or 0.5 s tick, so it is a single request, not a loop.
    sleep: (milliseconds) => clock.sleep(milliseconds).then(() => undefined),
    getCpuPercent: () => getCpuBusyPercent(),
    getNetCounters: () => getNetCounters(),
    executePowerAction: (mode, dryrun) => executePowerAction(mode, dryrun),
  }
}

async function getCpuBusyPercent(): Promise<number> {
  const answer = (await service.invoke("os", "cpu.usage", {})) as { busyPercent?: unknown }
  if (typeof answer.busyPercent !== "number") {
    throw new Error(`os.cpu.usage answered no busyPercent, got ${JSON.stringify(answer)}`)
  }
  // There is no `null` channel any more. The reading used to be unanswerable because the host's `os.cpus`
  // carried no per-cpu `times` (ADR-0079 gap ④); `cpu.usage` answers a busy figure over a stated window, so
  // anything that comes back is either that figure or a refusal worth throwing over.
  return answer.busyPercent
}

/**
 * Traffic for the whole machine, from the host's counters.
 *
 * The host lists every interface it was told about, loopback included, while the shell path this replaced
 * either skipped it by construction (`Get-NetAdapterStatistics` never reports Windows' loopback as an adapter)
 * or filtered it here (measured on this Mac: `lo0` carries ~22 GB of local traffic, and `netstat -ibn` repeats
 * an interface's counters on every address row it has). So the exclusion is this file's job and is written as
 * a predicate with a test, not buried in a parser that no longer exists.
 */
async function getNetCounters(): Promise<NetCounters> {
  const answer = (await service.invoke("os", "net.counters", {})) as { interfaces?: unknown }
  if (!Array.isArray(answer.interfaces)) {
    throw new Error(`os.net.counters answered no interface list, got ${JSON.stringify(answer)}`)
  }
  return sumInterfaceCounters(answer.interfaces as InterfaceCounters[])
}

/**
 * Cumulative totals, not the host's since-last-sample figures: the core computes its own rate from the
 * difference over the wall clock it reads itself, while the host's delta is measured against the previous
 * call *from this thread* — a different interval from this node's tick.
 */
export function sumInterfaceCounters(rows: InterfaceCounters[]): NetCounters {
  let bytesSent = 0
  let bytesReceived = 0
  for (const row of rows) {
    if (isLoopbackInterface(row.name)) continue
    bytesReceived += row.receivedTotal
    bytesSent += row.transmittedTotal
  }
  return { bytesSent, bytesReceived }
}

/** `lo`, `lo0`, `lo1` … and the spelling Windows uses in some adapters. */
export function isLoopbackInterface(name: string): boolean {
  return /^(lo\d*|loopback)$/i.test(name)
}

/**
 * Ask the host to change the machine's state, or to rehearse it.
 *
 * `dryRun` is sent rather than honoured here, because the gate, the platform table and the mechanism live on
 * the other side of the call. Measured on this host: a `dryRun: true` sent to a host without a rehearsal arm
 * had the flag ignored and the machine slept anyway — that is why the flag is part of the request and not a
 * property of this function.
 *
 * The consequence an operator sees: a rehearsal on a platform that lacks the action now says so. Before,
 * `--dryrun --mode hibernate` on macOS reported success about a state this machine cannot enter.
 */
async function executePowerAction(mode: PowerMode, dryrun: boolean): Promise<void> {
  try {
    await service.invoke("power", "request", { action: POWER_ACTIONS[mode], dryRun: dryrun })
  } catch (error) {
    // A host answer whose document says `ok: false` never reaches a caller as a value: the shim raises it
    // (`packages/quickjs-shims/src/host.ts:296`). Measured here, only the text survives into the bundle's
    // catch — `error.details.code` was undefined inside the realm — so this adds the mode the host's words
    // cannot know ("hibernate was refused…") and does not print a code it cannot read.
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${mode} was refused by the host: ${message}`)
  }
}
