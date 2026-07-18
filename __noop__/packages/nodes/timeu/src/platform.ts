import { mkdir, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import type { TimeuRuntime } from "./core.js"

export function createNodeTimeuRuntime(): TimeuRuntime {
  return {
    pathInfo,
    listDir,
    readText,
    writeText: async (path, content) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, "utf8")
    },
    ensureDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    setTimes: (path, atimeMs, mtimeMs) => utimes(path, new Date(atimeMs), new Date(mtimeMs)),
    now: () => new Date(),
    join,
    dirname,
    basename,
  }
}

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

async function listDir(path: string) {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    path: join(path, entry.name),
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
  }))
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}
