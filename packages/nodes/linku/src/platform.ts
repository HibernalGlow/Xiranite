import { hostCapabilities } from "@xiranite/host-capabilities"
import { dirname, resolve } from "node:path"
import {
  getNodeConfig,
  resolveXiraniteConfigPath,
  stringifyToml,
  parseToml,
  stripBom,
} from "@xiranite/config"
import { loadXiraniteConfig, updateNodeConfigFile } from "@xiranite/config/node"
import type { LinkPathInfo, LinkRecord, LinkuRuntime } from "./core.js"

interface LinkuNodeConfig {
  enabled?: boolean
  links?: Array<{ name?: string; link?: string; source?: string; target?: string; type?: string; created_at?: string }>
}

/**
 * linku's machine half, through the host capability surface (ADR-0078).
 *
 * This is the node that lives on links, so it is where the surface's link arms get used: `fs.stat` answers
 * the `lstat` reading the validity check needs (a link is its own kind, never its target), `fs.readlink` the
 * stored target text, and `fs.symlink` the creation. See `createSymlink` for the one kind the surface does
 * not offer.
 *
 * The four link operations keep resolving their input with `node:path` first, as they did on Node, so the
 * path the host authorizes is the one the record names; the config paths stay exactly as the caller passed
 * them.
 */
export function createNodeLinkuRuntime(configPath?: string): LinkuRuntime {
  const resolvedConfigPath = configPath ?? resolveXiraniteConfigPath()
  return {
    pathInfo,
    isLiveLinkRecord,
    removeSymlink,
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
  const { fs } = hostCapabilities
  // `.catch` keeps the old "unreadable config reads as no records" answer for a refusal too, which is what
  // `parseLinkRecords(null)` already models; `fs.readText` alone only answers `null` for an absent file.
  const content = await fs.readText(path).catch(() => null)
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
  const { fs } = hostCapabilities
  // If existing file is a legacy linku.toml, write legacy format directly
  const existing = await fs.readText(path).catch(() => null)
  if (existing !== null && looksLikeLegacyLinkuToml(existing)) {
    await fs.ensureDir(dirname(path))
    await fs.writeText(path, content)
    return
  }

  // Parse the core-provided standalone TOML (config_version + [[links]]) and merge into [nodes.linku]
  const parsed = parseToml(stripBom(content)) as { links?: LinkuNodeConfig["links"] }
  const links = parsed.links ?? []
  await updateNodeConfigFile("linku", { links }, { configPath: path })
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
  const { fs } = hostCapabilities
  return await fs.readText(legacyPath).catch(() => null)
}

interface CommandResult {
  code: number
  stdout: string
}

/**
 * The clipboard probe, through `proc.exec`.
 *
 * Which programs this node may run is the manifest's decision (`docs/xiranite-target-node-manifest.json`),
 * not this file's; a program the host refuses answers the same "nothing from this backend" the old callback
 * gave for a binary that was never installed.
 */
export async function readClipboardText(): Promise<string> {
  const { os } = hostCapabilities
  const platform = (await os.platform()).platform

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

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  const { proc } = hostCapabilities
  try {
    const result = await proc.exec(command, args)
    // `exitCode: null` means the host killed the child; the old `execFile` callback reported that as `1` too.
    return { code: result.exitCode ?? 1, stdout: result.stdout }
  } catch {
    // A missing binary is what this probe expects on a machine without that clipboard helper: both
    // transports reject the launch, and the caller must keep walking its candidates instead of failing.
    return { code: 1, stdout: "" }
  }
}

async function pathInfo(path: string): Promise<LinkPathInfo> {
  const { fs } = hostCapabilities
  const resolved = resolve(path)
  const info = await fs.stat(resolved)
  if (info === null) return { path: resolved, exists: false, kind: "missing", isSymlink: false }

  const isSymlink = info.kind === "symlink"
  let linkTarget: string | undefined
  let targetExists: boolean | undefined
  if (isSymlink) {
    try {
      linkTarget = await fs.readLink(resolved)
      targetExists = await exists(resolve(dirname(resolved), linkTarget))
    } catch {
      targetExists = false
    }
  }

  const kind = info.kind === "dir" ? "dir" : info.kind === "file" ? "file" : "other"
  const extra = kind === "dir" ? await directoryStats(resolved) : kind === "file" ? { sizeMb: (info.sizeBytes ?? 0) / 1024 / 1024 } : {}
  return { path: resolved, exists: true, kind, isSymlink, linkTarget, targetExists, ...extra }
}

async function isLiveLinkRecord(record: LinkRecord): Promise<boolean> {
  const { fs } = hostCapabilities
  const linkPath = resolve(record.link)
  const linkStat = await fs.stat(linkPath)
  if (linkStat === null || linkStat.kind !== "symlink") return false

  let actualTarget: string
  try {
    actualTarget = resolve(dirname(linkPath), await fs.readLink(linkPath))
  } catch {
    return false
  }

  const expectedTarget = resolve(record.target)
  if (!pathsMatch(actualTarget, expectedTarget)) return false
  return (await exists(actualTarget)) && (await exists(expectedTarget))
}

function pathsMatch(left: string, right: string): boolean {
  return left
    .replace(/^\\\\\?\\/, "")
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase() === right
      .replace(/^\\\\\?\\/, "")
      .replace(/\//g, "\\")
      .replace(/\\+$/, "")
      .toLowerCase()
}

async function removeSymlink(path: string): Promise<void> {
  const { fs } = hostCapabilities
  const linkPath = resolve(path)
  const info = await fs.stat(linkPath)
  if (info === null) throw new Error(`Link path does not exist: ${path}`)
  if (info.kind !== "symlink") throw new Error(`Link path is not a symbolic link: ${path}`)
  // A link is removed as itself: `fs.delete` never follows it, so the target stays where it is.
  await fs.remove(linkPath)
}

/**
 * Create (or replace) the link at `link`.
 *
 * Two things the old body did not have to say out loud:
 *
 * - The stored target is `resolve(source)`, an absolute path. The host authorizes a symlink by checking the
 *   target's own text against the granted roots (`filesystem.rs:630-668`), so a relative target text — legal
 *   to Node, which only stores it — is refused here. This call site passes an absolute path and does not
 *   route around that check.
 * - Node's `type: "junction"` for a directory link on Windows cannot be expressed: `fs.symlink` carries a
 *   `directory` flag and `std::fs` creates no junction on any platform, so a Windows directory link is now a
 *   real directory symlink. Everything else, including replacing an existing link, is unchanged.
 */
async function createSymlink(source: string, link: string): Promise<void> {
  const { fs } = hostCapabilities
  const sourceInfo = await pathInfo(source)
  if (!sourceInfo.exists) throw new Error(`Source path does not exist: ${source}`)
  const linkPath = resolve(link)
  await fs.ensureDir(dirname(linkPath))
  const existing = await fs.stat(linkPath)
  if (existing !== null) {
    if (existing.kind !== "symlink") {
      throw new Error(`Link path already exists and is not a symlink: ${linkPath}`)
    }
    await fs.remove(linkPath)
  }
  await fs.symbolicLink(resolve(source), linkPath, sourceInfo.kind === "dir" ? "dir" : "file")
}

async function movePath(source: string, target: string): Promise<void> {
  const { fs } = hostCapabilities
  const sourcePath = resolve(source)
  const targetPath = resolve(target)
  await fs.ensureDir(dirname(targetPath))
  await fs.move(sourcePath, targetPath)
}

async function readConfig(path: string): Promise<string | null> {
  const { fs } = hostCapabilities
  return await fs.readText(path).catch(() => null)
}

async function writeConfig(content: string, path: string): Promise<void> {
  const { fs } = hostCapabilities
  await fs.ensureDir(dirname(path))
  await fs.writeText(path, content)
}

/**
 * "Is there something at this path", answered by `fs.stat`.
 *
 * The old `access` followed a final symlink while `fs.stat` reports the link itself, so a link whose target
 * is itself a broken link now reads as present. Every call site below names a resolved target rather than a
 * link, where the two readings agree.
 */
async function exists(path: string): Promise<boolean> {
  const { fs } = hostCapabilities
  return (await fs.stat(path)) !== null
}

/**
 * The tree tally, one level at a time.
 *
 * `fs.list` is a single directory in both transports, so the walk stays here instead of asking the listing
 * for a recursion it does not do; a directory that cannot be read is skipped and an unreadable file is not
 * counted, exactly as the old `try`/`catch` pair decided.
 */
async function directoryStats(path: string): Promise<{ sizeMb: number; fileCount: number }> {
  const { fs } = hostCapabilities
  let size = 0
  let fileCount = 0
  async function walk(current: string): Promise<void> {
    let entries
    try {
      entries = await fs.list(current)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.kind === "dir") await walk(entry.path)
      else if (entry.kind === "file") {
        try {
          const info = await fs.stat(entry.path)
          size += info?.sizeBytes ?? 0
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
