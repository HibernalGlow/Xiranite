import { hostCapabilities } from "@xiranite/host-capabilities"
import { resolveXiraniteConfigPath } from "@xiranite/config"
import type { MigratefDirEntry, MigratefPathInfo, MigratefRuntime } from "./core.js"

const { path } = hostCapabilities
const { basename, dirname, isAbsolute, join, resolve } = path

/**
 * migratef's machine half, through the host capability surface (ADR-0079).
 *
 * Path arithmetic comes from the surface's `path` group rather than a `node:path` import: it is not a host
 * operation, and in this face that group is `node:path`. Nothing here reaches `node:fs` or
 * `node:child_process` any more.
 *
 * What the surface changed, and what it deliberately did not:
 *
 * - `copyFile`/`copyDir` keep their `mkdir(dirname(target))` as an explicit `fs.ensureDir`, because neither
 *   transport creates a destination's parent for a copy (only `fs.move` does, `filesystem.rs:357-359`). The
 *   old `force:false, errorOnExist:true` pair on the directory copy is `force:false` here: the host refuses
 *   an existing destination (`filesystem.rs:605-607`), and so does `node.ts:183-199`, which also carries the
 *   host's two shape refusals a merged-directory plan can otherwise walk into.
 * - `deletePath` used `rm(force: true)`, which answers "done" to an absent path, while `fs.remove` refuses
 *   one (`filesystem.rs:370-373`). `core.ts:331` deletes a copied target during undo, where "already gone"
 *   must not become a failed row, so the guard below keeps the old answer.
 * - `movePath` is one `fs.move`; the destination's parent and the cross-volume fallback both belong to the
 *   surface (`filesystem.rs:357-365`). The face's fallback copies with `force` on (`node.ts:179`) where the
 *   old local `cp(force:false, errorOnExist:true)` refused. That is only reachable for a move that crosses
 *   volumes onto a taken name — `direct` mode skips such a row before it gets here (`core.ts:167-173`), and
 *   the `preserve` file plan (`core.ts:182-187`) is the one path that can still ask for it.
 * - `readText` no longer swallows every error into `null` the way the old `try { readFile } catch { null }`
 *   did: `null` is now "no file" and a real failure (a directory, a permission refusal) is an error, which is
 *   what the host's `fs.readText` arm answers (`filesystem.rs:394-412`).
 * - `pathInfo` keeps Node's `lstat` reading in the face, because that is what `node.ts:100` is. The realm
 *   transport sends no `follow` argument and the host's `fs.stat` arm defaults it to true
 *   (`fs_operations.rs:207`), so a realm run follows a final link where this face does not; the capability
 *   has no knob to ask for either reading. migratef only branches on `exists`/`isDirectory`, where the two
 *   agree for every path but a symbolic one.
 *
 * `now` stays a synchronous `new Date()`: `MigratefRuntime.now` is `() => Date` and the journal writes its
 * ISO text straight out of it, while `clock.now()` is an async host operation — `timeu` and `sleept` carry
 * the same note. `randomId` does reach the surface, because `crypto.uuid()` is answered synchronously.
 */
export function createNodeMigratefRuntime(): MigratefRuntime {
  const { fs, crypto } = hostCapabilities
  return {
    pathInfo,
    listDir: async (path) =>
      (await fs.list(path)).map((entry) => ({
        name: entry.name,
        path: entry.path,
        isFile: entry.kind === "file",
        isDirectory: entry.kind === "dir",
      })),
    ensureDir: (path) => fs.ensureDir(path),
    copyFile: async (source, target) => {
      await fs.ensureDir(dirname(target))
      await fs.copy(source, target)
    },
    copyDir: async (source, target) => {
      await fs.ensureDir(dirname(target))
      await fs.copy(source, target, { recursive: true, force: false })
    },
    movePath: (source, target) => fs.move(source, target),
    deletePath: removeIfPresent,
    readText: (path) => fs.readText(path),
    writeText: (path, content) => fs.writeText(path, content),
    join,
    dirname,
    basename,
    isAbsolute,
    resolve,
    now: () => new Date(),
    randomId: () => crypto.uuid().slice(0, 8),
    defaultHistoryPath: () => join(dirname(resolveXiraniteConfigPath()), "artifacts", "undo", "migratef.undo.json"),
  }
}

/** The clipboard probe, one `proc.exec` per candidate program. */
export async function readClipboardText(): Promise<string> {
  const { platform } = await hostCapabilities.os.platform()
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
  try {
    const result = await hostCapabilities.proc.exec(command, args)
    return { code: result.exitCode ?? 1, stdout: result.stdout }
  } catch {
    // A program that is simply not installed. Both transports answer that as an error rather than an exit
    // code (`node.ts:242-245` re-throws `ENOENT`, `proc_operations.rs:159-161` answers "could not start"),
    // while this loop's contract is "try the next candidate" — `execFile` used to hand back code 1 for it.
    return { code: 1, stdout: "" }
  }
}

async function pathInfo(path: string): Promise<MigratefPathInfo> {
  const resolved = resolve(path)
  const info = await hostCapabilities.fs.stat(resolved)
  return {
    path: resolved,
    exists: info !== null,
    isFile: info?.kind === "file",
    isDirectory: info?.kind === "dir",
  }
}

async function removeIfPresent(path: string): Promise<void> {
  const { fs } = hostCapabilities
  if ((await fs.stat(path)) === null) return
  await fs.remove(path, { recursive: true })
}
