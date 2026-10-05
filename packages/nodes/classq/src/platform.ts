import { hostCapabilities } from "@xiranite/host-capabilities"
import type { ClassqRuntime, ClassqTransferMode } from "./core.js"

/**
 * classq's machine half, through the host capability surface (ADR-0079).
 *
 * `transfer` keeps the two modes the node plans on. `copy` asks for `force: false`, which is the host's
 * `AlreadyExists` arm (`filesystem.rs:605`) and the answer `errorOnExist: true` used to mean: a wait folder
 * that already holds the name must fail the item, not merge into it. `move` is one `fs.move` call because
 * both transports own the cross-volume fallback (`filesystem.rs:361-365`), so the node no longer has to
 * hand-roll the copy-then-delete that `rename` used to need on a second drive.
 */
export function createNodeClassqRuntime(): ClassqRuntime {
  const { fs, path } = hostCapabilities
  const { basename, dirname, join, relative } = path
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
    transfer: async (source, target, mode: ClassqTransferMode) => {
      if (mode === "copy") {
        await fs.copy(source, target, { recursive: true, force: false })
        return
      }
      await fs.move(source, target)
    },
    join,
    dirname,
    basename,
    relative,
  }
}
