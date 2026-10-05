import { hostCapabilities } from "@xiranite/host-capabilities"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { RawfilterDirEntry, RawfilterPathInfo, RawfilterRuntime } from "./core.js"

/**
 * rawfilter's machine half, through the host capability surface (ADR-0078).
 *
 * `moveFile` is one `fs.move`: the host's move arm already owns the rename-then-copy-and-delete fallback
 * the old `catch` hand-wrote (`filesystem.rs:361-365`), and it refuses a move into the source's own subtree
 * by shape (`filesystem.rs:351`) instead of nesting copies until the path length limit answers.
 *
 * `node:url` stays: a `file:` URL is not a host operation, there is no capability for it, and the
 * InternetShortcut fallback below is the only consumer.
 */
export function createNodeRawfilterRuntime(): RawfilterRuntime {
  const { fs } = hostCapabilities
  return {
    pathInfo,
    listDir: async (path) =>
      (await fs.list(path)).map((entry): RawfilterDirEntry => ({
        name: entry.name,
        path: entry.path,
        isFile: entry.kind === "file",
        isDirectory: entry.kind === "dir",
      })),
    ensureDir: (path) => fs.ensureDir(path),
    moveFile,
    createShortcut,
    join,
    dirname,
    basename,
  }
}

/**
 * Read the platform facts and probe the clipboard tools through `proc.exec`.
 *
 * A non-zero exit is a value there, which is what `runCommand` already modelled, so the Linux candidate
 * loop keeps walking on a machine that has none of the three tools.
 */
export async function readClipboardText(): Promise<string> {
  const platform = (await hostCapabilities.os.platform()).platform

  if (platform === "win32") {
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

  if (platform === "darwin") {
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
  try {
    const result = await hostCapabilities.proc.exec(command, args)
    // `exitCode: null` means the host killed the child; the old callback reported that as `1` too.
    return { code: result.exitCode ?? 1, stdout: result.stdout }
  } catch {
    // Both transports reject a launch of a program that is not installed, and this probe expects that
    // answer on a machine without the tool rather than failing the run.
    return { code: 1, stdout: "" }
  }
}

async function pathInfo(path: string): Promise<RawfilterPathInfo> {
  const resolved = resolve(path)
  const info = await hostCapabilities.fs.stat(resolved)
  return { path: resolved, exists: info !== null, isFile: info?.kind === "file", isDirectory: info?.kind === "dir" }
}

async function moveFile(source: string, target: string): Promise<void> {
  const { fs } = hostCapabilities
  // Kept explicit because the old code did it: `fs.move` owns the cross-volume fallback, not the
  // destination's parent folder that the plan has just invented.
  await fs.ensureDir(dirname(target))
  await fs.move(source, target)
}

async function createShortcut(source: string, target: string): Promise<void> {
  const { fs } = hostCapabilities
  const linkTarget = resolve(source)
  await fs.ensureDir(dirname(target))
  try {
    await fs.symbolicLink(linkTarget, target)
    return
  } catch {
    // Where links are refused (an unprivileged Windows account is the common case) the old code wrote a
    // `.url` InternetShortcut instead, and the caller has already chosen a free target name.
    await fs.writeText(target, `[InternetShortcut]\nURL=${pathToFileURL(linkTarget).href}\n`)
  }
}
