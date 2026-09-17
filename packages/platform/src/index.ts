import { arch as osArch, homedir, platform as osPlatform } from "node:os"
import { join } from "node:path"

/**
 * Platform primitives for Xiranite hosts.
 *
 * This module is the single source of truth for OS detection, per-OS
 * data/config/cache/state/log directory resolution, and the small
 * cross-platform command and path differences host adapters depend on.
 *
 * Every function accepts an optional context so callers (and tests) can inject
 * `platform`/`arch`/`env`/`homeDir` instead of mutating the real environment.
 * Keeping the injection seam here avoids the divergent hand-rolled APPDATA
 * logic that previously drifted between the backend, logging, and loaders.
 */

export type SupportedPlatform = "win32" | "darwin" | "linux"

export interface PlatformContext {
  platform: NodeJS.Platform
  arch: string
  env: NodeJS.ProcessEnv
  homeDir: string
}

export type PlatformContextInput = Partial<PlatformContext>

export function createPlatformContext(input: PlatformContextInput = {}): PlatformContext {
  return {
    platform: input.platform ?? osPlatform(),
    arch: input.arch ?? osArch(),
    env: input.env ?? process.env,
    homeDir: input.homeDir ?? homedir(),
  }
}

export function isSupportedPlatform(input: PlatformContextInput = {}): boolean {
  const { platform } = createPlatformContext(input)
  return platform === "win32" || platform === "darwin" || platform === "linux"
}

/**
 * Directory name Xiranite uses under the OS data/config/cache roots. Windows and
 * macOS keep the capitalized product name; Linux follows the lower-case XDG
 * convention used by the rest of the toolchain.
 */
export function appDirectoryName(input: PlatformContextInput = {}): string {
  return createPlatformContext(input).platform === "linux" ? "xiranite" : "Xiranite"
}

function windowsRoamingBase(ctx: PlatformContext): string {
  return ctx.env.LOCALAPPDATA ?? ctx.env.APPDATA ?? join(ctx.homeDir, "AppData", "Local")
}

/** Per-user data root (databases, node app data, shared contract markers). */
export function resolveAppDataDir(input: PlatformContextInput = {}): string {
  const ctx = createPlatformContext(input)
  if (ctx.platform === "win32") return join(windowsRoamingBase(ctx), "Xiranite")
  if (ctx.platform === "darwin") return join(ctx.homeDir, "Library", "Application Support", "Xiranite")
  return join(ctx.env.XDG_DATA_HOME ?? join(ctx.homeDir, ".local", "share"), "xiranite")
}

/** Root that may hold legacy configuration; the live config lives in the data dir. */
export function resolveAppConfigDir(input: PlatformContextInput = {}): string {
  const ctx = createPlatformContext(input)
  if (ctx.platform === "win32" && ctx.env.APPDATA) return ctx.env.APPDATA
  return ctx.env.XDG_CONFIG_HOME ?? join(ctx.homeDir, ".config")
}

/** Non-essential reusable caches (extracted native assets, build artefacts). */
export function resolveAppCacheDir(input: PlatformContextInput = {}): string {
  const ctx = createPlatformContext(input)
  if (ctx.platform === "win32") return join(windowsRoamingBase(ctx), "Xiranite")
  if (ctx.platform === "darwin") return join(ctx.homeDir, "Library", "Caches", "Xiranite")
  return join(ctx.env.XDG_CACHE_HOME ?? join(ctx.homeDir, ".cache"), "xiranite")
}

/** Persistent state that is not user data and should survive cache eviction. */
export function resolveAppStateDir(input: PlatformContextInput = {}): string {
  const ctx = createPlatformContext(input)
  if (ctx.platform === "win32") return join(windowsRoamingBase(ctx), "Xiranite")
  if (ctx.platform === "darwin") return join(ctx.homeDir, "Library", "Application Support", "Xiranite")
  return join(ctx.env.XDG_STATE_HOME ?? join(ctx.homeDir, ".local", "state"), "xiranite")
}

export function resolveAppLogDir(input: PlatformContextInput = {}): string {
  const ctx = createPlatformContext(input)
  if (ctx.platform === "win32") return join(windowsRoamingBase(ctx), "Xiranite", "logs")
  if (ctx.platform === "darwin") return join(ctx.homeDir, "Library", "Logs", "Xiranite")
  return join(ctx.env.XDG_STATE_HOME ?? join(ctx.homeDir, ".local", "state"), "xiranite", "logs")
}

/** `win32-x64` / `darwin-arm64` style key used by the native asset manifest. */
export function nativePlatformKey(input: PlatformContextInput = {}): string {
  const ctx = createPlatformContext(input)
  return `${ctx.platform}-${ctx.arch}`
}

export function pathListSeparator(input: PlatformContextInput = {}): string {
  return createPlatformContext(input).platform === "win32" ? ";" : ":"
}

export function sharedLibraryExtension(input: PlatformContextInput = {}): string {
  const { platform } = createPlatformContext(input)
  if (platform === "win32") return ".dll"
  return platform === "darwin" ? ".dylib" : ".so"
}

/**
 * Environment variable a native loader must extend so a freshly loaded binding
 * can resolve sibling shared libraries. Windows resolves DLLs through PATH;
 * macOS uses DYLD_LIBRARY_PATH and Linux uses LD_LIBRARY_PATH.
 */
export function nativeLibraryPathVariable(input: PlatformContextInput = {}): string {
  const { platform } = createPlatformContext(input)
  if (platform === "win32") return "PATH"
  return platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH"
}

/**
 * Windows path comparison is case-insensitive; POSIX comparison is exact.
 * Windows also treats trailing separators as insignificant.
 */
export function pathEntryEquals(left: string, right: string, input: PlatformContextInput = {}): boolean {
  const { platform } = createPlatformContext(input)
  if (platform !== "win32") return left === right
  return stripTrailingSeparators(left).toLowerCase() === stripTrailingSeparators(right).toLowerCase()
}

function stripTrailingSeparators(value: string): string {
  return value.length > 1 ? value.replace(/[\\/]+$/, "") : value
}

/** Prepends `entry` to a path list unless it is already present, matching OS semantics. */
export function prependPathEntry(
  list: string | undefined,
  entry: string,
  input: PlatformContextInput = {},
): string {
  const separator = pathListSeparator(input)
  const existing = list && list.length > 0 ? list.split(separator) : []
  if (existing.some((candidate) => pathEntryEquals(candidate, entry, input))) return list ?? ""
  return list && list.length > 0 ? `${entry}${separator}${list}` : entry
}

export { readHostAvailableMemoryBytes, type HostAvailableMemoryOptions } from "./hostMemory.js"

export interface OpenPathCommand {
  command: string
  args: string[]
}

/** OS command that reveals a path in the desktop file manager. */
export function openPathCommand(target: string, input: PlatformContextInput = {}): OpenPathCommand {
  const { platform } = createPlatformContext(input)
  if (platform === "win32") return { command: "explorer.exe", args: [target] }
  if (platform === "darwin") return { command: "open", args: [target] }
  return { command: "xdg-open", args: [target] }
}
