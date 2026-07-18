import { execFile } from "node:child_process"
import { lstat, readdir, rm } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import type { CleanfItem, CleanfRuntime, CleanfTarget } from "./core.js"
import { sortTargetsForRemoval } from "./core.js"

export function createNodeCleanfRuntime(): CleanfRuntime {
  return {
    scanPath,
    removeTargets,
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

async function scanPath(path: string): Promise<CleanfItem[]> {
  const root = resolve(path)
  const stat = await lstat(root)
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${root}`)
  }

  const items: CleanfItem[] = []
  await walkDirectory(root, 1, items)
  return items
}

async function walkDirectory(path: string, depth: number, items: CleanfItem[]): Promise<void> {
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const childPath = join(path, entry.name)
    if (!entry.isDirectory() && !entry.isFile()) continue

    items.push({
      path: childPath,
      name: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
      parentPath: path,
      depth,
    })

    if (entry.isDirectory()) {
      await walkDirectory(childPath, depth + 1, items)
    }
  }
}

async function removeTargets(targets: CleanfTarget[]): Promise<{ removed: number; skipped: number }> {
  let removed = 0
  let skipped = 0

  for (const target of sortTargetsForRemoval(targets)) {
    try {
      await lstat(target.path)
      await rm(target.path, { recursive: target.type === "dir", force: false })
      removed += 1
    } catch {
      skipped += 1
    }
  }

  return { removed, skipped }
}

export function makeCleanfItem(path: string, type: "file" | "dir", depth = 1): CleanfItem {
  const resolved = resolve(path)
  return {
    path: resolved,
    name: basename(resolved),
    type,
    parentPath: dirname(resolved),
    depth,
  }
}
