import { readdir, stat } from "node:fs/promises"
import { basename, dirname, join, relative } from "node:path"
import { runCrashu } from "@xiranite/node-crashu/core"
import { createNodeCrashuRuntime } from "@xiranite/node-crashu/platform"
import { runMigratef } from "@xiranite/node-migratef/core"
import { createNodeMigratefRuntime, readClipboardText } from "@xiranite/node-migratef/platform"
import { runSamea } from "@xiranite/node-samea/core"
import { createNodeSameaRuntime } from "@xiranite/node-samea/platform"
import type { ClassfRuntime } from "./core.js"

export function createNodeClassfRuntime(): ClassfRuntime {
  return {
    runSamea: (input, onEvent) => runSamea(input, createNodeSameaRuntime(), onEvent),
    runCrashu: (input, onEvent) => runCrashu(input, createNodeCrashuRuntime(), onEvent),
    runMigratef: (input, onEvent) => runMigratef(input, createNodeMigratefRuntime(), onEvent),
    readClipboardPaths: async () => (await readClipboardText()).split(/\r?\n/).map((path) => path.trim()).filter(Boolean),
    pathInfo: async (path) => { try { const info = await stat(path); return { path, exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() } } catch { return { path, exists: false, isFile: false, isDirectory: false } } },
    listDir: async (path) => (await readdir(path, { withFileTypes: true })).map((entry) => ({ name: entry.name, path: join(path, entry.name), isFile: entry.isFile(), isDirectory: entry.isDirectory() })),
    join, dirname, basename, relative,
  }
}
