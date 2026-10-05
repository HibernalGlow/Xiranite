import { stat } from "node:fs/promises"
import { hostCapabilities } from "@xiranite/host-capabilities"
import { basename, dirname, join, resolve } from "node:path"
import type { TimeuRuntime } from "./core.js"

/**
 * timeu's machine half, through the host capability surface (ADR-0078).
 *
 * `readText` no longer swallows every error into `null` the way the old `try { readFile } catch { null }`
 * did: in both transports "no document" is the `null` answer and a real failure (permission, a directory, a
 * non-UTF-8 journal) is an error, which is what the host's `fs.readText` arm does
 * (`filesystem.rs:394-412`). `writeText` keeps its parent-directory creation because both transports do
 * what `mkdir(dirname)` + `writeFile` did (`filesystem.rs:427-430`).
 *
 * One reader stays on Node — `pathInfo` at the bottom of this file, see the note there.
 */
export function createNodeTimeuRuntime(): TimeuRuntime {
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
    readText: (path) => fs.readText(path),
    writeText: (path, content) => fs.writeText(path, content),
    ensureDir: (path) => fs.ensureDir(path),
    setTimes: (path, atimeMs, mtimeMs) => fs.setTimes(path, { atimeMs, mtimeMs }),
    // The runtime contract is a synchronous `Date` (`core.ts:72`), so this cannot be the async
    // `clock.now()` capability without changing `TimeuRuntime`; a face and a realm both read the wall clock.
    now: () => new Date(),
    join,
    dirname,
    basename,
  }
}

/**
 * The one call still on `node:fs`.
 *
 * `TimeuPathInfo` carries `ctimeMs` and `birthtimeMs` (`core.ts:24-25`), and `currentTimestampRecords`
 * (`core.ts:178-179`) rounds both into the journal it writes and later restores. The contract's `FileStat`
 * answers size, atime and mtime only, so mapping this reader would mean storing two zeroes as if they were
 * creation times. `stat` also follows symlinks here, which is the reading timeu wants for a timestamp
 * target, while `fs.stat` is the host's `lstat` arm (`filesystem.rs:259-265`) with no follow argument on
 * the capability. Both gaps are host-side, not node-side; when creation times reach `FileStat` this reader
 * moves with them.
 */
async function pathInfo(path: string) {
  try {
    const info = await stat(path)
    return {
      path: resolve(path),
      exists: true,
      isFile: info.isFile(),
      isDirectory: info.isDirectory(),
      atimeMs: info.atimeMs,
      mtimeMs: info.mtimeMs,
      ctimeMs: info.ctimeMs,
      birthtimeMs: info.birthtimeMs,
    }
  } catch {
    return { path, exists: false, isFile: false, isDirectory: false, atimeMs: 0, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0 }
  }
}
