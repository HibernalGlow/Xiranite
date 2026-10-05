/**
 * The realm transport: every capability is one `__xrh` call.
 *
 * This file is what the QuickJS bundles get. It has no `node:` import and no Node-shaped member: a call
 * here maps 1:1 onto an operation the host answers (see `CAPABILITY_FOR_OPERATION`), and the answer is
 * widened into the contract's shape. Bytes cross the byte channel (`callBytes`/`sendBytes`), never base64
 * inside JSON.
 */
import {
  hostCall,
  hostCallBytesAsync,
  hostCallAsync,
  hostEnv,
  hostSendBytesAsync,
  platformInfo,
} from "@xiranite/quickjs-shims/host"
import type { ChildStatus, DirEntry, ExecResult, FileKind, FileStat, HostCapabilities } from "./contract.js"

function kindOf(entry: Record<string, unknown>): FileKind {
  if (typeof entry.kind === "string") return entry.kind as FileKind
  if (entry.isFile === true) return "file"
  if (entry.isDirectory === true) return "dir"
  if (entry.isSymlink === true) return "symlink"
  return "other"
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`host-capabilities: the realm answered ${typeof value} where an object was pinned`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new TypeError(`host-capabilities: answer field "${field}" is not text`)
  return value
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

/**
 * Join a directory with one entry name the way the host's grant layer does it: separator from the host's
 * own platform facts, a lone root not doubled, and no `..` collapsing. `fs.list` answers `path` per entry
 * when the grant can compute it; this is the fallback for the entries it does not.
 */
function hostJoin(parent: string, name: string): string {
  const sep = platformInfo().sep || "/"
  return parent.endsWith(sep) ? `${parent}${name}` : `${parent}${sep}${name}`
}

async function stat(path: string): Promise<FileStat | null> {
  const answer = asRecord(await hostCallAsync("fs.stat", { path }))
  if (answer.exists === false) return null
  return {
    path: typeof answer.path === "string" ? answer.path : path,
    kind: kindOf(answer),
    sizeBytes: optionalNumber(answer.sizeBytes ?? answer.size),
    mtimeMs: optionalNumber(answer.mtimeMs),
    atimeMs: optionalNumber(answer.atimeMs),
  }
}

export const realmCapabilities: HostCapabilities = {
  fs: {
    stat,
    async list(path, options = {}) {
      const answer = asRecord(await hostCallAsync("fs.list", { path, ...options }))
      const entries = Array.isArray(answer.entries) ? answer.entries : []
      return entries.map((raw): DirEntry => {
        const entry = asRecord(raw)
        const name = text(entry.name, "fs.list entry name")
        return {
          name,
          path: typeof entry.path === "string" ? entry.path : hostJoin(path, name),
          kind: kindOf(entry),
        }
      })
    },
    async readText(path) {
      const answer = asRecord(await hostCallAsync("fs.readText", { path }))
      return answer.content === null || answer.content === undefined ? null : text(answer.content, "content")
    },
    async writeText(path, content) {
      await hostCallAsync("fs.writeText", { path, content })
    },
    async appendText(path, content) {
      await hostCallAsync("fs.appendText", { path, content })
    },
    async readBytes(path, options = {}) {
      return await hostCallBytesAsync("fs.readBytes", { path, ...options })
    },
    async writeBytes(path, bytes, options = {}) {
      await hostSendBytesAsync("fs.writeBytes", { path, append: options.append ?? false }, bytes)
    },
    async ensureDir(path) {
      await hostCallAsync("fs.ensureDir", { path })
    },
    async createTemp(prefix) {
      return text(asRecord(await hostCallAsync("fs.mkdtemp", { prefix })).path, "fs.mkdtemp path")
    },
    async move(source, target) {
      await hostCallAsync("fs.move", { source, target })
    },
    async copy(source, target, options = {}) {
      await hostCallAsync("fs.copy", { source, target, ...options })
    },
    async remove(path, options = {}) {
      await hostCallAsync("fs.delete", { path, recursive: options.recursive ?? false })
    },
    async hardLink(source, target) {
      await hostCallAsync("fs.link", { source, target })
    },
    async symbolicLink(target, path, kind) {
      await hostCallAsync("fs.symlink", { target, path, ...(kind === undefined ? {} : { type: kind }) })
    },
    async readLink(path) {
      return text(asRecord(await hostCallAsync("fs.readlink", { path })).target, "fs.readlink target")
    },
    async realPath(path) {
      return text(asRecord(await hostCallAsync("fs.realpath", { path })).realPath, "fs.realpath realPath")
    },
    async setTimes(path, times) {
      await hostCallAsync("fs.utimes", { path, atimeMs: times.atimeMs, mtimeMs: times.mtimeMs })
    },
  },
  proc: {
    async exec(program, args, options = {}) {
      const answer = asRecord(await hostCallAsync("proc.exec", { program, args, ...options }))
      return {
        exitCode: answer.exitCode === null || answer.exitCode === undefined ? null : Number(answer.exitCode),
        stdout: typeof answer.stdout === "string" ? answer.stdout : "",
        stderr: typeof answer.stderr === "string" ? answer.stderr : "",
        truncated: answer.truncated === true,
      }
    },
    async start(program, args, options = {}) {
      const answer = asRecord(await hostCallAsync("proc.spawn", { program, args, ...options }))
      return { handle: Number(answer.handle), pid: Number(answer.pid) }
    },
    async poll(handle, since = 0) {
      return statusOf(asRecord(await hostCallAsync("proc.poll", { handle, since })))
    },
    async wait(handle, since = 0) {
      return statusOf(asRecord(await hostCallAsync("proc.wait", { handle, since })))
    },
    async stop(handle) {
      return asRecord(await hostCallAsync("proc.kill", { handle })).killed === true
    },
  },
  clock: {
    now() {
      return text(hostCall("clock.now", {}), "clock.now")
    },
  },
  crypto: {
    uuid() {
      return text(hostCall("crypto.randomUUID", {}), "crypto.randomUUID")
    },
    async randomBytes(count) {
      const hex = text(await hostCallAsync("crypto.randomBytes", { count }), "crypto.randomBytes")
      const bytes = new Uint8Array(count)
      for (let index = 0; index < count; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
      return bytes
    },
    async digest(algorithm, bytes) {
      return text(asRecord(await hostSendBytesAsync("crypto.digest", { algorithm }, bytes)).hex, "crypto.digest hex")
    },
  },
  os: {
    tempDir() {
      return text(hostCall("os.tmpdir", {}), "os.tmpdir")
    },
    async homeDir() {
      const answer = await hostCallAsync("os.homedir", {})
      return typeof answer === "string" ? answer : null
    },
    async cpus() {
      const answer = asRecord(await hostCallAsync("os.cpus", {}))
      const listed = Array.isArray(answer.cpus) ? answer.cpus : []
      return {
        count: Number(answer.count ?? listed.length),
        models: listed.map((cpu) => text(asRecord(cpu).model, "os.cpus model")),
      }
    },
    async platform() {
      const info = platformInfo()
      return { platform: info.platform, arch: info.arch, sep: info.sep, cwd: info.cwd, env: hostEnv() }
    },
  },
  service: {
    async invoke(name, method, args = {}) {
      return await hostCallAsync("service.invoke", { service: name, method, args })
    },
  },
} as HostCapabilities

function statusOf(answer: Record<string, unknown>): ChildStatus {
  return {
    running: answer.running === true,
    exitCode: answer.exitCode === null || answer.exitCode === undefined ? null : Number(answer.exitCode),
    stdout: typeof answer.stdout === "string" ? answer.stdout : "",
    stderr: typeof answer.stderr === "string" ? answer.stderr : "",
    truncated: answer.truncated === true,
  }
}

/** Re-exported so a node imports its types from the same bare specifier in either world. */
export * from "./contract.js"

/** The name a node's `platform.ts` imports. The realm bundle build aliases this package to the realm
 * transport, and Node/Bun resolve it to this file, so one import line serves both worlds. */
export const hostCapabilities: HostCapabilities = realmCapabilities
