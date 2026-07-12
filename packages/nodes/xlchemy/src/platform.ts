import { access, copyFile, mkdir, readdir, rm, stat, utimes } from "node:fs/promises"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import { delimiter } from "node:path"
import type { XlchemyRuntime } from "./core.js"
import { runXlchemyCommand } from "./command.js"
import { convertWithSlimg, probeSlimg } from "./slimg.js"

export function createNodeXlchemyRuntime(): XlchemyRuntime {
  return {
    pathInfo,
    listDir,
    ensureDir: async (path) => { await mkdir(path, { recursive: true }) },
    copyFile,
    removeFile: async (path) => { await rm(path, { force: true }) },
    renameFile: async (source, target) => { const { rename } = await import("node:fs/promises"); await rename(source, target) },
    setTimes: async (path, atimeMs, mtimeMs) => { await utimes(path, new Date(atimeMs), new Date(mtimeMs)) },
    runCommand: runXlchemyCommand,
    resolveCommand,
    probeSlimg,
    convertWithSlimg,
    join,
    dirname,
    basename,
    extname,
    relative,
  }
}

async function pathInfo(path: string) {
  try { const info = await stat(path); return { path: resolve(path), exists: true, isFile: info.isFile(), isDirectory: info.isDirectory(), size: info.size, atimeMs: info.atimeMs, mtimeMs: info.mtimeMs } }
  catch { return { path, exists: false, isFile: false, isDirectory: false, size: 0, atimeMs: 0, mtimeMs: 0 } }
}

async function listDir(path: string) { const entries = await readdir(path, { withFileTypes: true }); return entries.map((entry) => ({ path: join(path, entry.name), name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() })) }

async function resolveCommand(candidates: string[]): Promise<string | undefined> {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]
  const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  for (const candidate of candidates) {
    if (candidate.includes("/") || candidate.includes("\\")) { if (await exists(candidate)) return candidate; continue }
    for (const directory of directories) for (const extension of extensions) { const path = join(directory, process.platform === "win32" && !extname(candidate) ? `${candidate}${extension.toLowerCase()}` : candidate); if (await exists(path)) return path }
  }
  return undefined
}

async function exists(path: string) { try { await access(path); return true } catch { return false } }
