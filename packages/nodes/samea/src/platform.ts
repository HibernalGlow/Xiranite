import { hostCapabilities } from "@xiranite/host-capabilities"
import { basename, dirname, join } from "node:path"
import type { SameaRuntime } from "./core.js"

/**
 * samea's machine half, through the host capability surface (ADR-0078).
 *
 * The parent-directory ensure before a move stays explicit: the host's `fs.move` arm owns the cross-volume
 * fallback, not the destination's parent, and the previous behaviour created it — dropping that line would
 * turn a working move into a refusal on a fresh album folder.
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
    movePath: async (source, target) => {
      await fs.ensureDir(dirname(target))
      await fs.move(source, target)
    },
    join,
    dirname,
    basename,
  }
}
