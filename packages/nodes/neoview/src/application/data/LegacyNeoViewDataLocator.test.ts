import { describe, expect, it, vi } from "vitest"
import { LegacyNeoViewDataLocator } from "./LegacyNeoViewDataLocator.js"

describe("LegacyNeoViewDataLocator", () => {
  const locator = new LegacyNeoViewDataLocator()

  const existence = (...existingPaths: string[]) => {
    const paths = new Set(existingPaths)
    return (path: string) => paths.has(path)
  }

  it("[neoview.thumbnail.legacy-path] keeps the original Windows roaming app-data database", () => {
    const location = locator.locate({
      platform: "win32",
      env: { APPDATA: "D:\\Users\\reader\\AppData\\Roaming" },
      homeDir: "D:\\Users\\reader",
    })
    expect(location.modelsDirectory).toBe("D:\\Users\\reader\\AppData\\Roaming\\NeoView\\models")
    expect(location.thumbnailDatabasePath).toBe("D:\\Users\\reader\\AppData\\Roaming\\NeoView\\thumbnails.db")
    expect(location.walPath).toBe(`${location.thumbnailDatabasePath}-wal`)
    expect(location.shmPath).toBe(`${location.thumbnailDatabasePath}-shm`)
  })

  it("falls back to the Windows roaming convention without APPDATA", () => {
    expect(locator.locate({ platform: "win32", env: {}, homeDir: "C:\\Users\\reader" }).thumbnailDatabasePath)
      .toBe("C:\\Users\\reader\\AppData\\Roaming\\NeoView\\thumbnails.db")
  })

  it("uses the Tauri-style application data roots on macOS and Linux", () => {
    expect(locator.locate({ platform: "darwin", env: {}, homeDir: "/Users/reader" }).thumbnailDatabasePath)
      .toBe("/Users/reader/Library/Application Support/NeoView/thumbnails.db")
    expect(locator.locate({ platform: "linux", env: { XDG_DATA_HOME: "/data" }, homeDir: "/home/reader" }).thumbnailDatabasePath)
      .toBe("/data/NeoView/thumbnails.db")
  })

  it("[neoview.thumbnail.legacy-discovery] keeps the canonical database active when a configured custom database also exists", () => {
    const result = locator.inspect({
      platform: "win32",
      env: { APPDATA: "D:\\Users\\reader\\AppData\\Roaming" },
      homeDir: "D:\\Users\\reader",
      configuredThumbnailDirectory: " D:/legacy/NeoView/ ",
      fileExists: existence(
        "D:\\Users\\reader\\AppData\\Roaming\\NeoView\\thumbnails.db",
        "D:\\legacy\\NeoView\\thumbnails.db",
      ),
    })

    expect(result).toEqual({
      canonical: {
        path: "D:\\Users\\reader\\AppData\\Roaming\\NeoView\\thumbnails.db",
        exists: true,
      },
      custom: { path: "D:\\legacy\\NeoView\\thumbnails.db", exists: true },
      activeSource: "canonical",
      conflict: true,
      secondaryReason: "canonical-remains-active",
      explanation: expect.stringContaining("canonical database remains active"),
    })
  })

  it("reports a custom database without mounting it when canonical storage is missing", () => {
    const result = locator.discover({
      platform: "linux",
      env: { XDG_DATA_HOME: "/data" },
      homeDir: "/home/reader",
      configuredThumbnailDirectory: "/legacy/NeoView/",
      fileExists: existence("/legacy/NeoView/thumbnails.db"),
    })

    expect(result).toMatchObject({
      canonical: { path: "/data/NeoView/thumbnails.db", exists: false },
      custom: { path: "/legacy/NeoView/thumbnails.db", exists: true },
      activeSource: "missing",
      conflict: false,
      secondaryReason: "canonical-missing-custom-not-mounted",
    })
    expect(result.explanation).toContain("not mounted automatically")
  })

  it("reports the canonical candidate when the custom candidate is absent", () => {
    const seen: string[] = []
    const result = locator.inspect({
      platform: "darwin",
      env: {},
      homeDir: "/Users/reader",
      configuredThumbnailDirectory: "   /legacy/NeoView///   ",
      fileExists: path => {
        seen.push(path)
        return path === "/Users/reader/Library/Application Support/NeoView/thumbnails.db"
      },
    })

    expect(result.canonical).toEqual({
      path: "/Users/reader/Library/Application Support/NeoView/thumbnails.db",
      exists: true,
    })
    expect(result.custom).toEqual({ path: "/legacy/NeoView/thumbnails.db", exists: false })
    expect(result.activeSource).toBe("canonical")
    expect(result.conflict).toBe(false)
    expect(seen).toEqual([
      "/Users/reader/Library/Application Support/NeoView/thumbnails.db",
      "/legacy/NeoView/thumbnails.db",
    ])
  })

  it("does not report a Windows path spelling alias as a second database", () => {
    const result = locator.inspect({
      platform: "win32",
      env: { APPDATA: "D:\\Users\\reader\\AppData\\Roaming" },
      homeDir: "D:\\Users\\reader",
      configuredThumbnailDirectory: "d:/users/reader/appdata/roaming/neoview",
      fileExists: existence(
        "D:\\Users\\reader\\AppData\\Roaming\\NeoView\\thumbnails.db",
        "d:\\users\\reader\\appdata\\roaming\\neoview\\thumbnails.db",
      ),
    })

    expect(result.custom).toEqual({
      path: "d:\\users\\reader\\appdata\\roaming\\neoview\\thumbnails.db",
      exists: true,
    })
    expect(result.conflict).toBe(false)
  })

  it("ignores an empty configured directory and reports missing canonical storage", () => {
    const fileExists = vi.fn(() => false)
    const result = locator.inspect({
      platform: "win32",
      env: {},
      homeDir: "C:\\Users\\reader",
      configuredThumbnailDirectory: "  ",
      fileExists,
    })

    expect(result.custom).toBeUndefined()
    expect(result.activeSource).toBe("missing")
    expect(result.conflict).toBe(false)
    expect(fileExists).toHaveBeenCalledTimes(1)
    expect(result.explanation).toContain("no custom candidate")
  })

  it("keeps locate as a canonical path-only compatibility API", () => {
    const location = locator.locate({
      platform: "win32",
      env: { APPDATA: "D:\\Users\\reader\\AppData\\Roaming" },
      homeDir: "D:\\Users\\reader",
      configuredThumbnailDirectory: "D:\\custom",
      fileExists: () => true,
    })

    expect(location.thumbnailDatabasePath).toBe("D:\\Users\\reader\\AppData\\Roaming\\NeoView\\thumbnails.db")
    expect(location.walPath).toBe(`${location.thumbnailDatabasePath}-wal`)
    expect(location.shmPath).toBe(`${location.thumbnailDatabasePath}-shm`)
  })
})
