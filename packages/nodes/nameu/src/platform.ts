import { hostCapabilities } from "@xiranite/host-capabilities"
import { basename, dirname, join } from "node:path"
import type { NameuRuntime } from "./core.js"

/**
 * nameu's machine half, written against the host capability surface.
 *
 * The `node:path` trio stays a Node import for now: path arithmetic is not a host operation, and moving it
 * is a single pass for all 25 first-party consumers rather than 25 small edits. Everything that touches the
 * machine goes through `hostCapabilities`, which is the QuickJS realm's `__xrh` bridge in a bundle and the
 * real system calls in the CLI/TUI faces — the same 30 answers, implemented once each.
 *
 * `move` needs no parent-directory dance: both transports create the destination's parent before renaming
 * (`filesystem.rs:357-359` on the host, `mkdir(dirname)` then `rename` in `node.ts`).
 */
export function createNodeNameuRuntime(): NameuRuntime {
  const { fs } = hostCapabilities
  return {
    pathInfo: async (path) => {
      const info = await fs.stat(path)
      return {
        path,
        exists: info !== null,
        isFile: info?.kind === "file",
        isDirectory: info?.kind === "dir",
        atimeMs: info?.atimeMs ?? 0,
        mtimeMs: info?.mtimeMs ?? 0,
      }
    },
    listDir: async (path) =>
      (await fs.list(path)).map((entry) => ({
        name: entry.name,
        path: entry.path,
        isFile: entry.kind === "file",
        isDirectory: entry.kind === "dir",
      })),
    rename: (from, to) => fs.move(from, to),
    setTimes: (path, atimeMs, mtimeMs) => fs.setTimes(path, { atimeMs, mtimeMs }),
    join,
    dirname,
    basename,
  }
}
