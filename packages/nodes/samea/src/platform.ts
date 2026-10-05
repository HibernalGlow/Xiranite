import { hostCapabilities } from "@xiranite/host-capabilities"
import { basename, dirname, join } from "node:path"
import type { SameaRuntime } from "./core.js"

/**
 * samea's machine half, through the host capability surface (ADR-0078).
 *
 * `movePath` is a single `fs.move`: the destination's parent is created by both transports
 * (`filesystem.rs:357-359`, and `mkdir(dirname)` before `rename` in `node.ts`), so the explicit
 * parent-directory ensure the Node version needed is now the surface's job — one place instead of 41.
 */
export function createNodeSameaRuntime(): SameaRuntime {
  const { fs } = hostCapabilities
  return {
    pathInfo: async (path) => {
      const info = await fs.stat(path)
      return { path, exists: info !== null, isFile: info?.kind === "file", isDirectory: info?.kind === "dir" }
    },
    listDir: async (path) =>
      (await fs.list(path)).map((entry) => ({
        name: entry.name,
        path: entry.path,
        isFile: entry.kind === "file",
        isDirectory: entry.kind === "dir",
      })),
    ensureDir: (path) => fs.ensureDir(path),
    movePath: (source, target) => fs.move(source, target),
    join,
    dirname,
    basename,
  }
}
