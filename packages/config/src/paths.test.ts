import { describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  resolveXiraniteConfigPath,
  resolveLegacyXiraniteDataDirs,
  XIRANITE_CONFIG_FILENAME,
} from "./index.js"

const norm = (p: string): string => p.replace(/\\/g, "/")

describe("resolveXiraniteConfigPath", () => {
  test("uses --configPath when provided", () => {
    const root = join(tmpdir(), "xiranite-config-test", randomUUID())
    const path = resolveXiraniteConfigPath({ configPath: "custom.toml", cwd: root })
    expect(norm(path)).toBe(`${norm(root)}/custom.toml`)
  })

  test("uses XIRANITE_CONFIG_PATH env when no --configPath", () => {
    const root = join(tmpdir(), "xiranite-env-test", randomUUID())
    const path = resolveXiraniteConfigPath({ env: { XIRANITE_CONFIG_PATH: root } })
    expect(norm(path)).toBe(norm(root))
  })

  test("uses XIRANITE_DATABASE_PATH directory when set", () => {
    const root = join(tmpdir(), "xiranite-db-test", randomUUID())
    const path = resolveXiraniteConfigPath({ env: { XIRANITE_DATABASE_PATH: join(root, "xiranite.db") } })
    expect(norm(path)).toBe(`${norm(root)}/${XIRANITE_CONFIG_FILENAME}`)
  })

  test("uses XIRANITE_DATA_DIR when set", () => {
    const root = join(tmpdir(), "xiranite-data-test", randomUUID())
    const path = resolveXiraniteConfigPath({ env: { XIRANITE_DATA_DIR: root } })
    expect(norm(path)).toBe(`${norm(root)}/${XIRANITE_CONFIG_FILENAME}`)
  })

  test("falls back to databasePath option when no env", () => {
    const root = join(tmpdir(), "xiranite-fb-test", randomUUID())
    const path = resolveXiraniteConfigPath({ databasePath: join(root, "xiranite.db") })
    expect(norm(path)).toBe(`${norm(root)}/${XIRANITE_CONFIG_FILENAME}`)
  })

  test("falls back to dataDir option when no env or database path", () => {
    const root = join(tmpdir(), "xiranite-data-option-test", randomUUID())
    const path = resolveXiraniteConfigPath({ dataDir: root })
    expect(norm(path)).toBe(`${norm(root)}/${XIRANITE_CONFIG_FILENAME}`)
  })

  test("falls back to the local data directory on Windows", () => {
    const root = join(tmpdir(), "xiranite-win-data-test", randomUUID())
    const localAppData = join(root, "Local")
    const path = resolveXiraniteConfigPath({
      env: {
        APPDATA: join(root, "Roaming"),
        LOCALAPPDATA: localAppData,
      },
      platform: "win32",
      homeDir: root,
    })
    expect(norm(path)).toBe(`${norm(localAppData)}/Xiranite/${XIRANITE_CONFIG_FILENAME}`)
  })

  test("reports the previous Roaming config directory as a legacy data directory", () => {
    const root = join(tmpdir(), "xiranite-win-legacy-test", randomUUID())
    const dirs = resolveLegacyXiraniteDataDirs({
      env: {
        APPDATA: join(root, "Roaming"),
        LOCALAPPDATA: join(root, "Local"),
      },
      platform: "win32",
      homeDir: root,
    })
    expect(dirs.map(norm)).toEqual([`${norm(root)}/Roaming/Xiranite`])
  })

  test("does not report legacy directories for explicit config paths", () => {
    const root = join(tmpdir(), "xiranite-explicit-legacy-test", randomUUID())
    const dirs = resolveLegacyXiraniteDataDirs({
      configPath: join(root, "custom.toml"),
      env: {
        APPDATA: join(root, "Roaming"),
        LOCALAPPDATA: join(root, "Local"),
      },
      platform: "win32",
      homeDir: root,
    })
    expect(dirs).toEqual([])
  })
})
