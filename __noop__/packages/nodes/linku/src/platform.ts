import { execFile } from "node:child_process"
import { access, cp, lstat, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import {
  getNodeConfig,
  loadXiraniteConfig,
  resolveXiraniteConfigPath,
  saveXiraniteConfig,
  stringifyToml,
  parseToml,
  stripBom,
  type XiraniteConfig,
} from "@xiranite/config"
import type { LinkPathInfo, LinkuRuntime } from "./core.js"

interface LinkuNodeConfig {
  enabled?: boolean
  links?: Array<{ name?: string; link?: string; source?: string; target?: string; type?: string; created_at?: string }>
}

export function createNodeLinkuRuntime(configPath?: string): LinkuRuntime {
  const resolvedConfigPath = configPath ?? resolveXiraniteConfigPath()
  return {
    pathInfo,
    createSymlink,
    movePath,
    readConfig: async (path) => readLinkuConfig(path || resolvedConfigPath),
    writeConfig: async (content, path) => writeLinkuConfig(content, path || resolvedConfigPath),
  }
}

/**
 * Read linku records from xiranite.config.toml [nodes.linku] section.
 * Falls back to legacy standalone linku.toml format if the resolved path is a legacy file.
 */
async function readLinkuConfig(path: string): Promise<string | null> {
  const content = await readFile(path, "utf8").catch(() => null)
  if (content === null) return null

  // Detect legacy standalone linku.toml by checking for top-level [[links]] without [nodes.linku] parent
  if (looksLikeLegacyLinkuToml(content)) return content

  // xiranite.config.toml: extract [nodes.linku].links and re-serialize as legacy TOML for core parser
  try {
    const xconfig = (await loadXiraniteConfig({ configPath: path })).config
    const linkuNode = getNodeConfig<LinkuNodeConfig>(xconfig, "linku")
    if (!linkuNode?.links?.length) return null
    const standalone = { config_version: 1, links: linkuNode.links }
    return stringifyToml(standalone)
  } catch {
    return null
  }
}

/**
 * Write linku records into xiranite.config.toml [nodes.linku] section.
 * Preserves other sections in the config file.
 */
async function writeLinkuConfig(content: string, path: string): Promise<void> {
  // If existing file is a legacy linku.toml, write legacy format directly
  const existing = await readFile(path, "utf8").catch(() => null)
  if (existing !== null && looksLikeLegacyLinkuToml(existing)) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, "utf8")
    return
  }

  // Parse the core-provided standalone TOML (config_version + [[links]]) and merge into [nodes.linku]
  const parsed = parseToml(stripBom(content)) as { links?: LinkuNodeConfig["links"] }
  const links = parsed.links ?? []
  const xconfig: XiraniteConfig = existing !== null
    ? (await loadXiraniteConfig({ configPath: path })).config
    : {}
  const existingLinku = getNodeConfig<LinkuNodeConfig>(xconfig, "linku") ?? {}
  const merged: LinkuNodeConfig = { ...existingLinku, links }
  const updated = mergeNodeConfig(xconfig, "linku", merged)
  await saveXiraniteConfig(updated, { configPath: path })
}

function mergeNodeConfig(config: XiraniteConfig, nodeId: string, patch: unknown): XiraniteConfig {
  const nodes = { ...(config.nodes ?? {}) }
  nodes[nodeId] = patch
  return { ...config, nodes }
}

function looksLikeLegacyLinkuToml(content: string): boolean {
  // Legacy linku.toml has top-level [[links]] but no [nodes.*] parent
  if (!content.includes("[[links]]")) return false
  return !content.includes("[nodes.")
}

/**
 * Resolve linku config path with priority: cli override > env > xiranite config.toml.
 */
export function resolveLinkuConfigPath(options: { cliConfigPath?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {}): string {
  if (options.cliConfigPath) return resolve(options.cliConfigPath)
  return resolveXiraniteConfigPath({
    env: options.env,
    cwd: options.cwd,
  })
}

/**
 * One-time import from a legacy linku.toml file.
 * Returns parsed LinkRecord[] from the legacy file, or null if the file does not exist.
 */
export async function importLegacyLinkuToml(legacyPath: string): Promise<string | null> {
  try {
    return await readFile(legacyPath, "utf8")
  } catch {
    return null
  }
}

interface CommandResult {
  code: number
  stdout: string
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

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return await new Promise((resolveResult) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      const code = typeof (error as NodeJS.ErrnoException | null)?.code === "number" ? Number((error as NodeJS.ErrnoException).code) : error ? 1 : 0
      resolveResult({ code, stdout: stdout ?? "" })
    })
  })
}

async function pathInfo(path: string): Promise<LinkPathInfo> {
  const resolved = resolve(path)
  let stat
  try {
    stat = await lstat(resolved)
  } catch {
    return { path: resolved, exists: false, kind: "missing", isSymlink: false }
  }

  const isSymlink = stat.isSymbolicLink()
  let linkTarget: string | undefined
  let targetExists: boolean | undefined
  if (isSymlink) {
    try {
      const { readlink } = await import("node:fs/promises")
      linkTarget = await readlink(resolved)
      targetExists = await exists(resolve(dirname(resolved), linkTarget))
    } catch {
      targetExists = false
    }
  }

  const kind = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "other"
  const extra = kind === "dir" ? await directoryStats(resolved) : kind === "file" ? { sizeMb: stat.size / 1024 / 1024 } : {}
  return { path: resolved, exists: true, kind, isSymlink, linkTarget, targetExists, ...extra }
}

async function createSymlink(source: string, link: string): Promise<void> {
  const sourceInfo = await pathInfo(source)
  if (!sourceInfo.exists) throw new Error(`Source path does not exist: ${source}`)
  const linkPath = resolve(link)
  await mkdir(dirname(linkPath), { recursive: true })
  try {
    const existing = await lstat(linkPath)
    if (!existing.isSymbolicLink()) {
      throw new Error(`Link path already exists and is not a symlink: ${linkPath}`)
    }
    await rm(linkPath, { force: true })
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : undefined
    if (code !== "ENOENT") throw error
  }
  const type = process.platform === "win32" && sourceInfo.kind === "dir" ? "junction" : sourceInfo.kind === "dir" ? "dir" : "file"
  await symlink(resolve(source), linkPath, type)
}

async function movePath(source: string, target: string): Promise<void> {
  const sourcePath = resolve(source)
  const targetPath = resolve(target)
  await mkdir(dirname(targetPath), { recursive: true })
  try {
    await rename(sourcePath, targetPath)
  } catch {
    await cp(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true })
    await rm(sourcePath, { recursive: true, force: true })
  }
}

async function readConfig(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

async function writeConfig(content: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function directoryStats(path: string): Promise<{ sizeMb: number; fileCount: number }> {
  const { readdir } = await import("node:fs/promises")
  let size = 0
  let fileCount = 0
  async function walk(current: string) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(current, entry.name)
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) {
        try {
          const stat = await lstat(child)
          size += stat.size
          fileCount += 1
        } catch {
          // ignore unreadable files
        }
      }
    }
  }
  await walk(path)
  return { sizeMb: size / 1024 / 1024, fileCount }
}
