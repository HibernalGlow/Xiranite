import { mkdir, readdir, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, resolve } from "node:path"
import { createArchiveThumbnail, getArcThumbInfo } from "@xiranite/arcthumb-native"
import type { ArcThumbRuntime } from "./core.js"

export function createArcThumbRuntime(): ArcThumbRuntime {
  return {
    info: getArcThumbInfo,
    createArchiveThumbnail,
    pathInfo: async (path) => {
      try { const value = await stat(path); return { path: resolve(path), exists: true, isFile: value.isFile(), isDirectory: value.isDirectory() } }
      catch { return { path, exists: false, isFile: false, isDirectory: false } }
    },
    listDir: async (path) => (await readdir(path, { withFileTypes: true })).map((entry) => ({ path: join(path, entry.name), isFile: entry.isFile(), isDirectory: entry.isDirectory() })),
    writeFile,
    mkdir: async (path) => { await mkdir(path, { recursive: true }) },
    dirname, basename, extname, join,
  }
}
