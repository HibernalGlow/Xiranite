import { homedir, platform as runtimePlatform } from "node:os"
import { posix, win32 } from "node:path"
import { existsSync } from "node:fs"

export interface LegacyNeoViewDataLocation {
  appDataDirectory: string
  modelsDirectory: string
  thumbnailDatabasePath: string
  walPath: string
  shmPath: string
}

export interface LegacyNeoViewDataLocatorOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  homeDir?: string
  configuredThumbnailDirectory?: string
  fileExists?: (path: string) => boolean
}

export interface LegacyNeoViewDataCandidate {
  path: string
  exists: boolean
}

export type LegacyNeoViewActiveSource = "canonical" | "missing"

export interface LegacyNeoViewDataDiscovery {
  canonical: LegacyNeoViewDataCandidate
  custom?: LegacyNeoViewDataCandidate
  activeSource: LegacyNeoViewActiveSource
  conflict: boolean
  secondaryReason?: "canonical-remains-active" | "canonical-missing-custom-not-mounted"
  explanation: string
}

export class LegacyNeoViewDataLocator {
  locate(options: LegacyNeoViewDataLocatorOptions = {}): LegacyNeoViewDataLocation {
    const platform = options.platform ?? runtimePlatform()
    const env = options.env ?? process.env
    const home = options.homeDir ?? homedir()
    const join = platform === "win32" ? win32.join : posix.join
    const appDataDirectory = platform === "win32"
      ? join(env.APPDATA ?? join(home, "AppData", "Roaming"), "NeoView")
      : platform === "darwin"
        ? join(home, "Library", "Application Support", "NeoView")
        : join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "NeoView")
    const thumbnailDatabasePath = join(appDataDirectory, "thumbnails.db")
    return {
      appDataDirectory,
      modelsDirectory: join(appDataDirectory, "models"),
      thumbnailDatabasePath,
      walPath: `${thumbnailDatabasePath}-wal`,
      shmPath: `${thumbnailDatabasePath}-shm`,
    }
  }

  inspect(options: LegacyNeoViewDataLocatorOptions = {}): LegacyNeoViewDataDiscovery {
    const canonicalLocation = this.locate(options)
    const platform = options.platform ?? runtimePlatform()
    const join = platform === "win32" ? win32.join : posix.join
    const normalize = platform === "win32" ? win32.normalize : posix.normalize
    const configuredDirectory = options.configuredThumbnailDirectory?.trim()
    const customPath = configuredDirectory
      ? join(normalize(configuredDirectory), "thumbnails.db")
      : undefined
    const fileExists = options.fileExists ?? existsSync
    const canonicalExists = fileExists(canonicalLocation.thumbnailDatabasePath)
    const customExists = customPath === undefined
      ? undefined
      : customPath === canonicalLocation.thumbnailDatabasePath
        ? canonicalExists
        : fileExists(customPath)
    const custom = customPath === undefined
      ? undefined
      : { path: customPath, exists: customExists ?? false }
    const conflict = canonicalExists && custom?.exists === true
      && !samePath(custom.path, canonicalLocation.thumbnailDatabasePath, platform)

    let secondaryReason: LegacyNeoViewDataDiscovery["secondaryReason"]
    let explanation: string
    if (conflict) {
      secondaryReason = "canonical-remains-active"
      explanation = `Both canonical and custom thumbnails.db files exist; the canonical database remains active and the custom database is secondary.`
    } else if (!canonicalExists && custom?.exists === true) {
      secondaryReason = "canonical-missing-custom-not-mounted"
      explanation = `The canonical thumbnails.db is missing; the custom database is reported as a secondary compatibility source and is not mounted automatically.`
    } else if (canonicalExists) {
      explanation = custom === undefined
        ? "The canonical thumbnails.db exists and remains active."
        : "The canonical thumbnails.db exists and remains active; the custom candidate is not mounted automatically."
    } else {
      explanation = custom === undefined
        ? "The canonical thumbnails.db is missing and no custom candidate was configured."
        : "Neither the canonical nor custom thumbnails.db candidate exists."
    }

    return {
      canonical: { path: canonicalLocation.thumbnailDatabasePath, exists: canonicalExists },
      ...(custom === undefined ? {} : { custom }),
      activeSource: canonicalExists ? "canonical" : "missing",
      conflict,
      ...(secondaryReason === undefined ? {} : { secondaryReason }),
      explanation,
    }
  }

  discover(options: LegacyNeoViewDataLocatorOptions = {}): LegacyNeoViewDataDiscovery {
    return this.inspect(options)
  }
}

function samePath(left: string, right: string, platform: NodeJS.Platform | undefined): boolean {
  return platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}
