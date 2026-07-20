import { existsSync } from "node:fs"
import { homedir, platform as runtimePlatform } from "node:os"
import { win32, posix } from "node:path"

export interface LegacyEmmDataLocation {
  databasePaths: readonly string[]
  settingPath?: string
  translationDatabasePath?: string
  translationDictionaryPath?: string
}

export interface LegacyEmmDataLocatorOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  homeDir?: string
  fileExists?: (path: string) => boolean
  databasePaths?: readonly string[]
  cwd?: string
}

/** Locates the legacy EMM files without making them part of Xiranite storage. */
export class LegacyEmmDataLocator {
  locate(options: LegacyEmmDataLocatorOptions = {}): LegacyEmmDataLocation {
    const platform = options.platform ?? runtimePlatform()
    const env = options.env ?? process.env
    const home = options.homeDir ?? homedir()
    const cwd = options.cwd ?? process.cwd()
    const pathJoin = platform === "win32" ? win32.join : posix.join
    const fileExists = options.fileExists ?? existsSync
    const appData = platform === "win32"
      ? env.APPDATA ?? pathJoin(home, "AppData", "Roaming")
      : platform === "darwin"
        ? pathJoin(home, "Library", "Application Support")
        : env.XDG_DATA_HOME ?? pathJoin(home, ".local", "share")
    const roots = [
      pathJoin(cwd, "portable"),
      pathJoin(appData, "exhentai-manga-manager"),
      ...(platform === "win32" && env.LOCALAPPDATA ? [pathJoin(env.LOCALAPPDATA, "exhentai-manga-manager")] : []),
    ]
    const candidates = options.databasePaths?.length
      ? [...options.databasePaths]
      : roots.flatMap((root) => [
          pathJoin(root, "database.sqlite"),
          pathJoin(root, "db.sqlite"),
          pathJoin(root, "metadata.sqlite"),
        ])
    const databasePaths = [...new Set(candidates.map((value) => value.trim()).filter((value) => value && fileExists(value)))]
    const optional = (name: string) => {
      return roots.map((root) => pathJoin(root, name)).find(fileExists)
    }
    return {
      databasePaths,
      settingPath: optional("setting.json"),
      translationDatabasePath: optional("translations.db"),
      translationDictionaryPath: optional("db.text.json"),
    }
  }
}
