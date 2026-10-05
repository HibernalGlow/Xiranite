import { hostCapabilities } from "@xiranite/host-capabilities"
import { basename, dirname, join, resolve } from "node:path"
import type { CrashuDirEntry, CrashuPathInfo, CrashuRuntime } from "./core.js"

/**
 * crashu's machine half, through the host capability surface (ADR-0078).
 *
 * `node:path` stays a Node import: path arithmetic is not a host operation and one pass owns it for every
 * consumer. Nothing here reaches `node:fs` or `node:child_process` any more.
 *
 * Two readings moved with the surface, both of them documented at the boundary:
 *
 * - `pathInfo` used Node's `stat`, which follows a final link. The face's `fs.stat` is `lstat`
 *   (`node.ts:100`), while a realm run answers the host's follow arm by default (`fs_operations.rs:207`), so
 *   the two transports do not agree on a symlink yet, and the face is the one that changed here. crashu only
 *   branches on `exists`/`isDirectory` (`core.ts:167-182`, `core.ts:313`), so the visible effect is that the
 *   face no longer walks into a symlinked source folder — the same answer `listDir` already gave for that
 *   entry, since a `readdir` dirent is never a directory it linked to.
 * - `deletePath` used `rm(force: true)`, which answers "done" to an absent path, while `fs.remove` refuses
 *   one (`filesystem.rs:370-373`). The refusal is a real difference to a run report, so the guard below keeps
 *   the old answer instead of routing a throw into `core.ts:335`.
 *
 * `movePath` needs no parent-directory dance: both transports create the destination's parent before the
 * rename (`filesystem.rs:357-359`, and `mkdir(dirname)` then `rename` in `node.ts`).
 */
export function createNodeCrashuRuntime(): CrashuRuntime {
  const { fs } = hostCapabilities
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
    movePath: (source, target) => fs.move(source, target),
    deletePath: removeIfPresent,
    writeText: (path, content) => fs.writeText(path, content),
    join,
    dirname,
    basename,
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

async function pathInfo(path: string): Promise<CrashuPathInfo> {
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
