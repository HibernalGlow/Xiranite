import { describe, expect, it } from "vitest"
import { LegacyNeoViewDataLocator } from "./LegacyNeoViewDataLocator.js"

describe("LegacyNeoViewDataLocator", () => {
  const locator = new LegacyNeoViewDataLocator()

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
})
