import { hostCapabilities } from "@xiranite/host-capabilities"
import { runCrashu } from "@xiranite/node-crashu/core"
import { createNodeCrashuRuntime } from "@xiranite/node-crashu/platform"
import { runMigratef } from "@xiranite/node-migratef/core"
import { createNodeMigratefRuntime, readClipboardText } from "@xiranite/node-migratef/platform"
import { runSamea } from "@xiranite/node-samea/core"
import { createNodeSameaRuntime } from "@xiranite/node-samea/platform"
import type { ClassfRuntime } from "./core.js"

/**
 * classf's machine half, through the host capability surface (ADR-0079). Its other edges are sibling
 * nodes' own runtimes, and those come along unchanged — the point of the surface is that a node reused by
 * another node does not need a second machine path.
 */
export function createNodeClassfRuntime(): ClassfRuntime {
  const { fs, path } = hostCapabilities
  const { basename, dirname, join, relative } = path
  return {
    runSamea: (input, onEvent) => runSamea(input, createNodeSameaRuntime(), onEvent),
    runCrashu: (input, onEvent) => runCrashu(input, createNodeCrashuRuntime(), onEvent),
    runMigratef: (input, onEvent) => runMigratef(input, createNodeMigratefRuntime(), onEvent),
    readClipboardPaths: async () =>
      (await readClipboardText())
        .split(/\r?\n/)
        .map((path) => path.trim())
        .filter(Boolean),
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
    join,
    dirname,
    basename,
    relative,
  }
}
