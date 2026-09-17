/**
 * Test-only helper that redirects the per-OS Xiranite data directory into a
 * temporary root. Each platform resolves its data directory from a different
 * environment variable, so all of them are pointed at the same root to keep
 * tests hermetic and OS-independent (previously only `LOCALAPPDATA` was set,
 * which silently leaked into the real macOS/Linux app data directory).
 */
const DATA_DIR_ENV_KEYS = ["LOCALAPPDATA", "APPDATA", "XDG_DATA_HOME", "HOME"] as const

type DataDirEnvKey = (typeof DATA_DIR_ENV_KEYS)[number]

export type PlatformDataDirEnvironment = Record<DataDirEnvKey, string | undefined>

export function capturePlatformDataDirEnvironment(): PlatformDataDirEnvironment {
  const snapshot = {} as PlatformDataDirEnvironment
  for (const key of DATA_DIR_ENV_KEYS) snapshot[key] = process.env[key]
  return snapshot
}

export function redirectPlatformDataDir(root: string): void {
  process.env.LOCALAPPDATA = root
  process.env.APPDATA = root
  process.env.XDG_DATA_HOME = root
  process.env.HOME = root
}

export function restorePlatformDataDirEnvironment(snapshot: PlatformDataDirEnvironment): void {
  for (const key of DATA_DIR_ENV_KEYS) {
    const value = snapshot[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
