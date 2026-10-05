import { hostCapabilities } from "@xiranite/host-capabilities"
import type { NameuRuntime } from "./core.js"

const { path } = hostCapabilities
const { basename, dirname, join } = path

/**
 * nameu's machine half, written against the host capability surface.
 *
 * Path arithmetic comes from the surface's `path` group rather than a `node:path` import: it is not a host
 * operation, but in the CLI/TUI faces that group is `node:path` and in a bundle it is the realm
 * implementation. Everything that touches the machine goes through `hostCapabilities`, which is the QuickJS
 * realm's `__xrh` bridge in a bundle and the real system calls in the CLI/TUI faces — the same 30 answers,
 * implemented once each.
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
