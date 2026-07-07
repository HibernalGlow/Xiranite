import { execFile } from "node:child_process"
import { copyFile, lstat, mkdir, readdir, rename } from "node:fs/promises"
import { basename, dirname, extname, join, resolve } from "node:path"
import * as iconv from "iconv-lite"
import type { EncodebEntry, EncodebInput, EncodebMapping, EncodebRuntime, NameTranscoder } from "./core.js"
import { createEncodebMappings, sortReplaceMappings } from "./core.js"

export function createNodeEncodebRuntime(): EncodebRuntime {
  return {
    scanPath,
    recoverPath,
    transcodeName: iconvTranscodeName,
  }
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

interface CommandResult {
  code: number
  stdout: string
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      const code = typeof (error as NodeJS.ErrnoException | null)?.code === "number" ? Number((error as NodeJS.ErrnoException).code) : error ? 1 : 0
      resolve({ code, stdout: stdout ?? "" })
    })
  })
}

export const iconvTranscodeName: NameTranscoder = (name, srcEncoding, dstEncoding) => {
  try {
    return iconv.decode(iconv.encode(name, srcEncoding), dstEncoding)
  } catch {
    return name
  }
}

async function scanPath(path: string): Promise<EncodebEntry[]> {
  const resolved = resolve(path)
  const stat = await lstat(resolved)
  if (stat.isFile()) {
    return [{
      path: resolved,
      name: basename(resolved),
      type: "file",
      rootPath: dirname(resolved),
      relativeParts: [basename(resolved)],
      depth: 1,
    }]
  }

  if (!stat.isDirectory()) {
    throw new Error(`Unsupported path type: ${resolved}`)
  }

  const entries: EncodebEntry[] = []
  await walkEncodebDirectory(resolved, resolved, [], 1, entries)
  return entries
}

async function recoverPath(
  path: string,
  input: Required<EncodebInput>,
): Promise<string> {
  const resolved = resolve(path)
  const stat = await lstat(resolved)
  const entries = await scanPath(resolved)

  if (stat.isDirectory() && input.strategy === "copy") {
    const destRoot = await uniquePath(`${resolved}_recovered`)
    const mappings = createEncodebMappings(entries, input, iconvTranscodeName, { changedOnly: false, destRoot })
    await applyCopyMappings(mappings)
    return destRoot
  }

  const mappings = createEncodebMappings(entries, input, iconvTranscodeName, { changedOnly: true })
  if (input.strategy === "copy") {
    await applyCopyMappings(mappings)
    return mappings[0]?.dst ?? resolved
  }

  await applyReplaceMappings(sortReplaceMappings(mappings))
  return resolved
}

async function walkEncodebDirectory(
  rootPath: string,
  currentPath: string,
  relativeParts: string[],
  depth: number,
  entries: EncodebEntry[],
): Promise<void> {
  let children
  try {
    children = await readdir(currentPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const child of children) {
    if (!child.isDirectory() && !child.isFile()) continue
    const childPath = join(currentPath, child.name)
    const childParts = [...relativeParts, child.name]
    entries.push({
      path: childPath,
      name: child.name,
      type: child.isDirectory() ? "dir" : "file",
      rootPath,
      relativeParts: childParts,
      depth,
    })

    if (child.isDirectory()) {
      await walkEncodebDirectory(rootPath, childPath, childParts, depth + 1, entries)
    }
  }
}

async function applyCopyMappings(mappings: EncodebMapping[]): Promise<void> {
  const sorted = [...mappings].sort((a, b) => a.depth - b.depth)
  for (const mapping of sorted) {
    if (mapping.type === "dir") {
      await mkdir(mapping.dst, { recursive: true })
      continue
    }

    await mkdir(dirname(mapping.dst), { recursive: true })
    await copyFile(mapping.src, await uniquePath(mapping.dst))
  }
}

async function applyReplaceMappings(mappings: EncodebMapping[]): Promise<void> {
  for (const mapping of mappings) {
    if (mapping.src === mapping.dst) continue
    try {
      await lstat(mapping.src)
    } catch {
      continue
    }
    await mkdir(dirname(mapping.dst), { recursive: true })
    await rename(mapping.src, await uniquePath(mapping.dst, mapping.src))
  }
}

async function uniquePath(path: string, samePath?: string): Promise<string> {
  let candidate = path
  let index = 1
  const ext = extname(path)
  const stem = ext ? path.slice(0, -ext.length) : path

  while (true) {
    if (samePath && resolve(candidate) === resolve(samePath)) return candidate
    try {
      await lstat(candidate)
      candidate = `${stem}_${index}${ext}`
      index += 1
    } catch {
      return candidate
    }
  }
}
