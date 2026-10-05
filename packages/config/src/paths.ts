import { resolveAppConfigDir, resolveAppDataDir } from "@xiranite/platform"
import { dirname, join, resolve } from "node:path"
import { platform as osPlatform } from "node:os"

export const XIRANITE_CONFIG_FILENAME = "xiranite.config.toml"

export interface ResolveConfigPathOptions {
  /** Explicit override path (e.g. from --config). */
  configPath?: string
  /** Environment variables to read from (defaults to process.env). */
  env?: NodeJS.ProcessEnv
  /** Current working directory for relative paths (defaults to process.cwd()). */
  cwd?: string
  /** Optional fallback data directory; if set, look for config inside it. */
  dataDir?: string
  /** Optional fallback database path; if set, look for config in its directory. */
  databasePath?: string
  /** Test seam for platform-specific default path behavior. */
  platform?: NodeJS.Platform
  /** Test seam for platform-specific default path behavior. */
  homeDir?: string
}

export function resolveXiraniteConfigPath(options: ResolveConfigPathOptions = {}): string {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()

  if (options.configPath) return resolve(cwd, options.configPath)
  if (env.XIRANITE_CONFIG_PATH) return resolve(cwd, env.XIRANITE_CONFIG_PATH)
  if (env.XIRANITE_DATABASE_PATH) return join(dirname(resolve(cwd, env.XIRANITE_DATABASE_PATH)), XIRANITE_CONFIG_FILENAME)
  if (env.XIRANITE_DATA_DIR) return join(resolve(cwd, env.XIRANITE_DATA_DIR), XIRANITE_CONFIG_FILENAME)

  if (options.databasePath) return join(dirname(resolve(cwd, options.databasePath)), XIRANITE_CONFIG_FILENAME)
  if (options.dataDir) return join(resolve(cwd, options.dataDir), XIRANITE_CONFIG_FILENAME)

  return join(defaultSystemDataDir(options), XIRANITE_CONFIG_FILENAME)
}

export function resolveXiraniteDataDir(options: ResolveConfigPathOptions = {}): string {
  return dirname(resolveXiraniteConfigPath(options))
}

export function resolveLegacyXiraniteDataDirs(options: ResolveConfigPathOptions = {}): string[] {
  const env = options.env ?? process.env
  if (options.configPath || env.XIRANITE_CONFIG_PATH) return []

  const targetDir = resolveXiraniteDataDir(options)
  const legacyDir = join(legacySystemConfigDir(options), "Xiranite")
  return samePath(targetDir, legacyDir, options) ? [] : [legacyDir]
}

function defaultSystemDataDir(options: ResolveConfigPathOptions): string {
  return resolveAppDataDir(options)
}

function legacySystemConfigDir(options: ResolveConfigPathOptions): string {
  return resolveAppConfigDir(options)
}

function samePath(left: string, right: string, options: ResolveConfigPathOptions): boolean {
  const runtimePlatform = options.platform ?? osPlatform()
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return runtimePlatform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}
