/**
 * The Node transport: the same capabilities, answered by the real system.
 *
 * This is what the CLI and TUI faces get — they run under Node/Bun, where there is no `__xrh` global and
 * the host is a separate process. The point of putting these calls here, once, is that a node's
 * `platform.ts` no longer reaches `node:fs` / `node:child_process` itself: the same 30 capability methods
 * are available in both worlds, so the machine-touching code has two implementations in this repository
 * (realm, node) instead of one per node.
 *
 * Where a capability cannot exist here, it refuses by name rather than faking an answer: the host services
 * behind `service.invoke` live in the host process, so asking for one through this transport is an
 * error a human must see, not an empty object.
 */
import { spawn, execFile } from "node:child_process"
import {
  appendFile,
  cp,
  link,
  lstat,
  mkdir,
  open as openFile,
  type FileHandle,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  readlink,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises"
import nodePath from "node:path"
import { createHash, randomBytes as nodeRandomBytes, randomUUID } from "node:crypto"
import * as nodeOs from "node:os"
import type { ChildStatus, DirEntry, ExecResult, FileKind, FileStat, HostCapabilities } from "./contract.js"

/** The same per-stream transcript ceiling the host applies, so a face never sees more output than a realm run would. */
const MAX_TRANSCRIPT_BYTES = 1024 * 1024

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined
}

function kindFromStats(stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): FileKind {
  if (stats.isFile()) return "file"
  if (stats.isDirectory()) return "dir"
  if (stats.isSymbolicLink()) return "symlink"
  return "other"
}

interface LiveChild {
  pid: number
  handle: number
  child: ReturnType<typeof spawn>
  stdout: string
  stderr: string
  truncated: boolean
  exitCode: number | null
  signal: string | null
  settled: boolean
  waiters: Set<() => void>
}

const liveChildren = new Map<number, LiveChild>()
let nextHandle = 1

function appendTranscript(child: LiveChild, stream: "stdout" | "stderr", chunk: string): void {
  if (child[stream].length >= MAX_TRANSCRIPT_BYTES) {
    child.truncated = true
    return
  }
  const room = MAX_TRANSCRIPT_BYTES - child[stream].length
  if (chunk.length > room) {
    child.truncated = true
    child[stream] += chunk.slice(0, room)
    return
  }
  child[stream] += chunk
}

function statusOf(child: LiveChild, since = 0): ChildStatus {
  const stdout = child.stdout.slice(Math.max(0, since))
  return {
    running: !child.settled,
    exitCode: child.settled ? child.exitCode : null,
    stdout,
    stderr: child.stderr,
    truncated: child.truncated,
  }
}

export const nodeCapabilities: HostCapabilities = {
  path: {
    // The faces get Node's own implementation; `path` is not a host operation, so there is nothing to ask
    // the host for. See `PathTools` for why the realm side is not this object.
    join: (...parts: string[]) => nodePath.join(...parts),
    resolve: (...parts: string[]) => nodePath.resolve(...parts),
    normalize: (target: string) => nodePath.normalize(target),
    dirname: (target: string) => nodePath.dirname(target),
    basename: (target: string, suffix?: string) => (suffix === undefined ? nodePath.basename(target) : nodePath.basename(target, suffix)),
    extname: (target: string) => nodePath.extname(target),
    relative: (from: string, to: string) => nodePath.relative(from, to),
    isAbsolute: (target: string) => nodePath.isAbsolute(target),
    parse: (target: string) => nodePath.parse(target),
    sep: nodePath.sep,
  },
  fs: {
    async stat(path) {
      try {
        const stats = await lstat(path)
        return {
          path,
          kind: kindFromStats(stats),
          sizeBytes: stats.size,
          mtimeMs: stats.mtimeMs,
          atimeMs: stats.atimeMs,
        }
      } catch (error) {
        if (codeOf(error) === "ENOENT") return null
        throw error
      }
    },
    async list(path, options = {}) {
      const entries = await readdir(path, { withFileTypes: true, ...(options.recursive ? { recursive: true } : {}) })
      const mapped: DirEntry[] = []
      for (const entry of entries) {
        const parent = "parentPath" in entry ? String(entry.parentPath) : path
        mapped.push({
          name: entry.name,
          path: nodePath.join(parent, entry.name),
          kind: entry.isFile() ? "file" : entry.isDirectory() ? "dir" : entry.isSymbolicLink() ? "symlink" : "other",
        })
        if (options.limit !== undefined && mapped.length >= options.limit) break
      }
      return mapped
    },
    async readText(path) {
      try {
        return await readFile(path, "utf8")
      } catch (error) {
        if (codeOf(error) === "ENOENT") return null
        throw error
      }
    },
    async writeText(path, content) {
      await mkdir(nodePath.dirname(path), { recursive: true })
      await writeFile(path, content, "utf8")
    },
    async appendText(path, content) {
      await mkdir(nodePath.dirname(path), { recursive: true })
      await appendFile(path, content, "utf8")
    },
    async readBytes(path, options = {}) {
      let handle: FileHandle | null = null
      try {
        handle = await openForRead(path)
        const stats = await handle.stat()
        const offset = Math.max(0, options.offset ?? 0)
        if (offset >= stats.size) return new Uint8Array(0)
        const length = Math.min(options.length ?? stats.size - offset, stats.size - offset)
        const target = new Uint8Array(length)
        const { bytesRead } = await handle.read(target, 0, length, offset)
        return bytesRead === length ? target : target.subarray(0, bytesRead)
      } catch (error) {
        if (codeOf(error) === "ENOENT") return null
        throw error
      } finally {
        await handle?.close()
      }
    },
    async writeBytes(path, bytes, options = {}) {
      await mkdir(nodePath.dirname(path), { recursive: true })
      if (options.append) await appendFile(path, bytes)
      else await writeFile(path, bytes)
    },
    async ensureDir(path) {
      await mkdir(path, { recursive: true })
    },
    async createTemp(prefix) {
      return await mkdtemp(nodePath.join(nodeOs.tmpdir(), prefix || "xiranite-"))
    },
    async move(source, target) {
      await mkdir(nodePath.dirname(target), { recursive: true })
      try {
        await rename(source, target)
      } catch {
        // The host falls back to copy-then-remove for *any* rename failure (`filesystem.rs:361-365`), not
        // only the cross-volume one: an EXDEV-only arm here would refuse a move that a realm run completes.
        await cp(source, target, { recursive: true })
        await rm(source, { recursive: true, force: true })
      }
    },
    async copy(source, target, options = {}) {
      // The host's own two shape refusals (`filesystem.rs:575-597`: copy onto self, and a tree copied into
      // its own subtree, which nests a copy of itself until the path-length limit answers instead). Node's
      // `cp` has neither, so a face that skipped them would succeed where a realm run refuses — the one
      // thing this package must never do is be more permissive than the host.
      const from = nodePath.resolve(source)
      const to = nodePath.resolve(target)
      if (from === to) throw new Error(`host-capabilities: ${source} cannot be copied onto itself`)
      if (to === from + nodePath.sep || to.startsWith(from + nodePath.sep)) {
        throw new Error(`host-capabilities: ${source} cannot be copied inside itself`)
      }
      await cp(source, target, {
        recursive: options.recursive ?? false,
        force: options.force ?? true,
        errorOnExist: options.force === false,
      })
    },
    async remove(path, options = {}) {
      // `force: false`, because the host's delete arm reads the path first and refuses when it is not there
      // (`filesystem.rs:370-373` → `stat_failed`). A `force: true` here would answer "done" to a delete of an
      // absent file that a realm run reports as a failure, which is the divergence this package exists to
      // prevent — and for `dissolvef`'s undo path, "the file was already gone" is exactly the answer a node
      // must be able to see.
      await rm(path, { recursive: options.recursive ?? false, force: false })
    },
    async hardLink(source, target) {
      await mkdir(nodePath.dirname(target), { recursive: true })
      await link(source, target)
    },
    async symbolicLink(target, path, kind) {
      await mkdir(nodePath.dirname(path), { recursive: true })
      await symlink(target, path, kind ?? (process.platform === "win32" ? "file" : undefined))
    },
    async readLink(path) {
      // No ENOENT arm: the host refuses an absent or non-link path through `fs.readlink`, so this transport
      // propagates it too rather than inventing a "no link" answer.
      return await readlink(path)
    },
    async realPath(path) {
      return await realpath(path)
    },
    async setTimes(path, times) {
      await utimes(path, times.atimeMs / 1000, times.mtimeMs / 1000)
    },
  },
  proc: {
    exec(program, args, options = {}) {
      return new Promise<ExecResult>((resolve, reject) => {
        execFile(
          program,
          args,
          {
            cwd: options.cwd,
            env: options.env ? { ...process.env, ...options.env } : process.env,
            encoding: "utf8",
            maxBuffer: MAX_TRANSCRIPT_BYTES,
            windowsHide: true,
          },
          (error, stdout, stderr) => {
            if (error && codeOf(error) === "ENOENT") {
              reject(error)
              return
            }
            const failure = error as (NodeJS.ErrnoException & { code?: number; killed?: boolean }) | null
            // A non-zero exit is a value: this is the host's rule and a face must not disagree with it.
            resolve({
              exitCode: failure ? (typeof failure.code === "number" ? failure.code : failure.killed ? null : 1) : 0,
              stdout: String(stdout ?? ""),
              stderr: String(stderr ?? ""),
              truncated: false,
            })
          },
        )
      })
    },
    start(program, args, options = {}) {
      const handle = nextHandle++
      const child = spawn(program, args, {
        cwd: options.cwd,
        // The host's proc.spawn answers no env, so neither does this transport: a face that could set one
        // would run a program under conditions the realm run never sees.
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })
      const live: LiveChild = {
        pid: child.pid ?? -1,
        handle,
        child,
        stdout: "",
        stderr: "",
        truncated: false,
        exitCode: null,
        signal: null,
        settled: false,
        waiters: new Set(),
      }
      child.stdout?.on("data", (chunk: Buffer) => appendTranscript(live, "stdout", chunk.toString("utf8")))
      child.stderr?.on("data", (chunk: Buffer) => appendTranscript(live, "stderr", chunk.toString("utf8")))
      child.on("error", () => {
        live.settled = true
        live.exitCode = 1
        for (const wake of live.waiters) wake()
      })
      child.on("close", (code, signal) => {
        live.settled = true
        live.exitCode = code
        live.signal = signal
        for (const wake of live.waiters) wake()
      })
      liveChildren.set(handle, live)
      return Promise.resolve({ handle, pid: live.pid })
    },
    poll(handle, since = 0) {
      return Promise.resolve(statusOf(liveOf(handle), since))
    },
    wait(handle, since = 0) {
      const live = liveOf(handle)
      if (live.settled) return Promise.resolve(statusOf(live, since))
      return new Promise<ChildStatus>((resolve) => {
        live.waiters.add(() => {
          liveChildren.delete(handle)
          resolve(statusOf(live, since))
        })
      })
    },
    stop(handle) {
      const live = liveOf(handle)
      live.child.kill()
      return Promise.resolve(true)
    },
  },
  clock: {
    now() {
      return new Date().toISOString()
    },
  },
  crypto: {
    uuid() {
      return randomUUID()
    },
    async randomBytes(count) {
      return new Uint8Array(nodeRandomBytes(count))
    },
    async digest(algorithm, bytes) {
      return createHash(algorithm).update(bytes).digest("hex")
    },
  },
  os: {
    tempDir() {
      return nodeOs.tmpdir()
    },
    async homeDir() {
      try {
        return nodeOs.homedir()
      } catch {
        return null
      }
    },
    async cpus() {
      const listed = nodeOs.cpus()
      return { count: listed.length, models: listed.map((cpu) => cpu.model) }
    },
    async platform() {
      const env: Record<string, string> = {}
      for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
      return { platform: process.platform, arch: process.arch, sep: nodePath.sep, cwd: process.cwd(), env }
    },
  },
  service: {
    async invoke(name, method) {
      throw new Error(
        `host-capabilities: service "${name}.${method}" is answered by the host process; a CLI/TUI face reaches it through /operations, not through this transport.`,
      )
    },
  },
}

function liveOf(handle: number): LiveChild {
  const live = liveChildren.get(handle)
  if (!live) throw new Error(`host-capabilities: no live child for handle ${handle}`)
  return live
}

async function openForRead(path: string): Promise<FileHandle> {
  return await openFile(path, "r")
}

/** Re-exported so a node imports its types from the same bare specifier in either world. */
export * from "./contract.js"

/** The name a node's `platform.ts` imports. The realm bundle build aliases this package to the realm
 * transport, and Node/Bun resolve it to this file, so one import line serves both worlds. */
export const hostCapabilities: HostCapabilities = nodeCapabilities
