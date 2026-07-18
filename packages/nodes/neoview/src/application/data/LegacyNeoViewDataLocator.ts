import { homedir, platform as runtimePlatform } from "node:os"
import { posix, win32 } from "node:path"

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
}
