import { execFile } from "node:child_process"
import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises"
import { basename, dirname, extname, join, resolve } from "node:path"
import { open } from "node:fs/promises"
import type { CommandResult, GifuCommandPlan, GifuRuntime } from "./core.js"
import { isGifuArchive } from "./core.js"

export function createNodeGifuRuntime(): GifuRuntime {
  return {
    readText: (path) => readFile(path, "utf8"),
    appendRecord,
    pathInfo,
    listDir,
    countArchiveImages,
    runCommand,
    join,
    dirname,
    basename,
    extname,
  }
}

async function pathInfo(path: string) {
  try {
    const info = await stat(path)
    return { path: resolve(path), exists: true, isFile: info.isFile(), isDirectory: info.isDirectory() }
  } catch {
    return { path, exists: false, isFile: false, isDirectory: false }
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

async function countArchiveImages(path: string): Promise<number> {
  if (!isGifuArchive(path)) return 0
  const lower = path.toLowerCase()
  if (lower.endsWith(".zip") || lower.endsWith(".cbz")) return countZipImageEntries(path)
  return 0
}

async function countZipImageEntries(path: string): Promise<number> {
  const handle = await open(path, "r")
  try {
    const info = await handle.stat()
    const tailLength = Math.min(info.size, 66000)
    const tail = Buffer.alloc(tailLength)
    await handle.read(tail, 0, tailLength, info.size - tailLength)
    let count = 0
    for (let index = 0; index <= tail.length - 4; index += 1) {
      if (tail[index] === 0x50 && tail[index + 1] === 0x4b && tail[index + 2] === 0x01 && tail[index + 3] === 0x02) count += 1
    }
    return count
  } finally {
    await handle.close()
  }
}

async function runCommand(plan: GifuCommandPlan): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    execFile(plan.command, plan.args, {
      cwd: plan.cwd,
      env: { ...process.env, ...plan.env },
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 0
      resolveResult({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? (error instanceof Error ? error.message : "")) })
    })
  })
}

async function appendRecord(path: string, record: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8")
}
