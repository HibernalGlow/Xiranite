import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises"
import { createReadStream } from "node:fs"
import { createHash } from "node:crypto"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import { delimiter } from "node:path"
import { tmpdir } from "node:os"
import type { XlchemyRuntime } from "./core.js"
import { runXlchemyCommand } from "./command.js"
import { convertWithSlimg, probeSlimg } from "./slimg.js"
import { convertClipToPsd } from "./clip-to-psd.js"

export function createNodeXlchemyRuntime(): XlchemyRuntime {
  return {
    pathInfo,
    listDir,
    ensureDir,
    copyFile,
    removeFile: async (path) => { await rm(path, { force: true }) },
    trashFile: moveFileToRecycleBin,
    renameFile: async (source, target) => { const { rename } = await import("node:fs/promises"); await rename(source, target) },
    setTimes: async (path, atimeMs, mtimeMs) => { await utimes(path, new Date(atimeMs), new Date(mtimeMs)) },
    hashFile: sha256File,
    runCommand: runXlchemyCommand,
    resolveCommand,
    probeSlimg,
    convertWithSlimg,
    convertClipToPsd,
    join,
    dirname,
    basename,
    extname,
    relative,
    createTemporaryFile: async (extension, base64) => {
      const workspace = await mkdtemp(join(tmpdir(), "xlchemy-clipboard-"))
      const path = join(workspace, `clipboard${/^\.[a-z0-9]+$/i.test(extension) ? extension : ".png"}`)
      await writeFile(path, Buffer.from(base64, "base64"))
      return path
    },
    readFileBase64: async (path) => (await readFile(path)).toString("base64"),
    cleanupTemporaryFile: async (path) => { await rm(dirname(path), { recursive: true, force: true }) },
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256")
  await new Promise<void>((resolvePromise, reject) => { const stream = createReadStream(path); stream.on("data", (chunk) => hash.update(chunk)); stream.once("error", reject); stream.once("end", resolvePromise) })
  return hash.digest("hex")
}

async function pathInfo(path: string) {
  try { const info = await stat(path); return { path: resolve(path), exists: true, isFile: info.isFile(), isDirectory: info.isDirectory(), size: info.size, atimeMs: info.atimeMs, mtimeMs: info.mtimeMs } }
  catch { return { path, exists: false, isFile: false, isDirectory: false, size: 0, atimeMs: 0, mtimeMs: 0 } }
}

async function listDir(path: string) { const entries = await readdir(path, { withFileTypes: true }); return entries.map((entry) => ({ path: join(path, entry.name), name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() })) }

/**
 * Bun on Windows can report EEXIST for `mkdir(path, { recursive: true })`
 * when `path` already exists as a directory. Source-output conversions call
 * this for the image's existing parent directory, so verify the target and
 * treat that one case as success.
 */
export async function ensureDir(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const existing = await stat(path).catch(() => undefined)
      if (existing?.isDirectory()) return
    }
    throw error
  }
}

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

export async function moveFileToRecycleBin(path: string) {
  if (process.platform !== "win32") throw new Error("Recycle-bin deletion is currently available on Windows only.")
  const escapedPath = resolve(path).replaceAll("'", "''")
  const script = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escapedPath}', [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const result = await runXlchemyCommand("powershell.exe", ["-NoLogo", "-NoProfile", "-STA", "-EncodedCommand", encoded])
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `Failed to move ${path} to the recycle bin.`)
}
