/**
 * `node:os` — the machine facts come from `__xrh.platform`, the one host-owned answer; anything that needs
 * more than those facts is an operation, and operations v1 pins only `os.tmpdir`.
 *
 * Measured use inside node closures is `tmpdir` (a scratch root for every temp-dir-using node), `homedir`
 * (shared packages) and `cpus` (one node sizing a parallelism budget). `homedir` and `cpus` are **not**
 * implementable through operations v1: a wrong home directory writes outside the granted root and a wrong CPU
 * count silently changes a node's concurrency, so they throw rather than guess. The README names them as host
 * operations to add.
 */
import { notImplemented } from "./internal.ts"
import { platformInfo, platformInfoOrFallback } from "./host.ts"
import { opTmpdir } from "./ops.ts"

export function platform(): string {
  return platformInfo().platform
}

export function arch(): string {
  return platformInfo().arch
}

/** `os.tmpdir()` is a host operation because the realm has no environment block to read. */
export function tmpdir(): string {
  return opTmpdir()
}

/** Node has no `tmpdirSync`; kept because a few shared helpers reach for it defensively. */
export const tmpdirSync: () => string = tmpdir

/** `EOL` is a value, so it reads the host when present and POSIX otherwise (see `platformInfoOrFallback`). */
export const EOL: string = platformInfoOrFallback().platform === "win32" ? "\r\n" : "\n"


export function lineEnding(): string {
  return platformInfo().platform === "win32" ? "\r\n" : "\n"
}

export function getSeparator(_options?: unknown): Promise<string> {
  return Promise.resolve(platformInfo().platform === "win32" ? "\r\n" : "\n")
}

export function version(): string {
  return `${platform()}-${arch()}`
}

/** homedir is beyond operations v1; granted roots come from the host, a guessed home writes outside them. */
export const homedir: () => never = notImplemented("os", "homedir", "os.homedir() -> path")
export const hostname: () => never = notImplemented("os", "hostname")
export const cpus: () => never = notImplemented("os", "cpus", "os.cpus() -> [ { model, speed } ]")
export const availableParallelism: () => never = notImplemented("os", "availableParallelism", "os.cpus() / os.availableParallelism()")
export const totalmem: () => never = notImplemented("os", "totalmem")
export const freemem: () => never = notImplemented("os", "freemem")
export const networkInterfaces: () => never = notImplemented("os", "networkInterfaces")
export const userInfo: () => never = notImplemented("os", "userInfo")
export const uptime: () => never = notImplemented("os", "uptime")
export const loadavg: () => never = notImplemented("os", "loadavg")
export const machine: () => never = notImplemented("os", "machine")
export const release: () => never = notImplemented("os", "release")
export const devNull: string = platformInfoOrFallback().platform === "win32" ? "\\\\.\\NUL" : "/dev/null"
export const getPriority: () => never = notImplemented("os", "getPriority")
export const setPriority: () => never = notImplemented("os", "setPriority")

const namespace = {
  platform, arch, tmpdir, tmpdirSync, EOL, lineEnding, getSeparator, version, release, devNull,
  homedir, hostname, cpus, availableParallelism, totalmem, freemem, networkInterfaces, userInfo, uptime, loadavg, machine, getPriority, setPriority,
}
export default namespace
