import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { access, copyFile, mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import type { LoratRow, LoratRuntime, LoratScannedModel, ScanProgress } from "./core.js"
import { LORAT_MODEL_EXTS, normalizePathKey } from "./core.js"

export function createNodeLoratRuntime(): LoratRuntime {
  return {
    scanModels,
    writeTrigger,
    writeNoTrigger,
    copyFile: async (sourcePath, destinationPath) => {
      await mkdir(dirname(destinationPath), { recursive: true })
      await copyFile(sourcePath, destinationPath)
    },
    fileExists: async (path) => await access(path, constants.F_OK).then(() => true).catch(() => false),
    joinPath: join,
    basename,
    extname,
  }
}

export async function scanModels(
  folderPath: string,
  onProgress?: (p: ScanProgress) => void,
): Promise<LoratScannedModel[]> {
  const root = resolve(folderPath)
  const rootInfo = await stat(root).catch(() => null)
  if (!rootInfo?.isDirectory()) throw new Error(`LoRA folder does not exist: ${root}`)

  // Phase 1: 快速统计模型文件总数（只读目录，不读文件内容）
  const modelFiles: string[] = []
  await walk(root, async (filePath) => {
    const ext = extname(filePath).toLowerCase()
    if (LORAT_MODEL_EXTS.includes(ext as typeof LORAT_MODEL_EXTS[number])) {
      modelFiles.push(filePath)
    }
  })
  const total = modelFiles.length

  // Phase 2: 逐个读取 sidecar + 计算 fileId，报告实时进度
  const models: LoratScannedModel[] = []
  for (let i = 0; i < modelFiles.length; i++) {
    const filePath = modelFiles[i]!
    const name = basename(filePath)
    const ext = extname(name).toLowerCase()
    const stem = name.slice(0, -ext.length)
    const dir = dirname(filePath)
    const relativeDir = normalizePathKey(relative(root, dir))
    const pathParts = relativeDir ? relativeDir.split("/") : []
    models.push({
      name,
      stem,
      filePath,
      relativeDir,
      relativePath: normalizePathKey(relative(root, filePath)),
      pathParts,
      triggerText: await readSidecar(dir, `${stem}.trigger.txt`),
      noTriggerText: await readSidecar(dir, `${stem}.notrigger.txt`),
      fileId: await computeFileId(filePath),
    })
    onProgress?.({ current: i + 1, total, name })
  }

  return models.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export async function writeTrigger(row: LoratRow, trigger: string): Promise<void> {
  const dir = dirname(row.filePath)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${row.stem}.trigger.txt`), `${trigger.trim()}\n`, "utf8")
  await rm(join(dir, `${row.stem}.notrigger.txt`), { force: true })
}

export async function writeNoTrigger(row: LoratRow): Promise<void> {
  const dir = dirname(row.filePath)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${row.stem}.notrigger.txt`), "no trigger\n", "utf8")
  await rm(join(dir, `${row.stem}.trigger.txt`), { force: true })
}

export async function readTextFile(path?: string): Promise<string> {
  if (!path) return ""
  return await readFile(path, "utf8")
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true })
  await writeFile(path, content, "utf8")
}

export async function readClipboardText(): Promise<string> {
  if (process.platform === "win32") {
    const result = await runCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference = 'SilentlyContinue'; Get-Clipboard -Raw",
    ])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  if (process.platform === "darwin") {
    const result = await runCommand("pbpaste", [])
    return result.code === 0 ? result.stdout.trim() : ""
  }

  for (const command of [["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "--clipboard", "--output"]]) {
    const result = await runCommand(command[0]!, command.slice(1))
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim()
  }

  return ""
}

async function walk(dir: string, onFile: (path: string) => Promise<void>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const child = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(child, onFile)
    } else if (entry.isFile()) {
      await onFile(child)
    }
  }
}

async function readSidecar(dir: string, name: string): Promise<string | null> {
  const path = join(dir, name)
  try {
    await access(path, constants.F_OK)
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function computeFileId(filePath: string): Promise<string> {
  const info = await stat(filePath)
  const chunkSize = 1024 * 1024
  const hash = createHash("sha1")
  hash.update(String(info.size))

  const handle = await open(filePath, "r")
  try {
    const firstLength = Math.min(chunkSize, info.size)
    const first = Buffer.alloc(firstLength)
    await handle.read(first, 0, firstLength, 0)
    hash.update(first)

    if (info.size > chunkSize) {
      const last = Buffer.alloc(chunkSize)
      await handle.read(last, 0, chunkSize, info.size - chunkSize)
      hash.update(last)
    }
  } finally {
    await handle.close()
  }

  return hash.digest("hex")
}

async function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return await new Promise((resolveResult) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      const code = typeof (error as NodeJS.ErrnoException | null)?.code === "number" ? Number((error as NodeJS.ErrnoException).code) : error ? 1 : 0
      resolveResult({ code, stdout: stdout ?? "" })
    })
  })
}
