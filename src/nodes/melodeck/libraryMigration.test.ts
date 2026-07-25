import { describe, expect, it, vi } from "vitest"

import { loadAndMigrateMelodeckLibrary, type MelodeckLibraryMigrationDependencies } from "./libraryMigration"

describe("Melodeck library migration", () => {
  it("uses an initialized database even when it contains an empty library", async () => {
    const dependencies = createDependencies()
    dependencies.loadLibrary.mockResolvedValue([])

    await expect(loadAndMigrateMelodeckLibrary({
      saved_tracks: [{ name: "Legacy", path: "D:/Music/legacy.flac" }],
    }, dependencies)).resolves.toEqual([])

    expect(dependencies.saveLibrary).not.toHaveBeenCalled()
    expect(dependencies.removeLegacyTracks).not.toHaveBeenCalled()
  })

  it("writes legacy tracks to the database before removing them from TOML", async () => {
    const order: string[] = []
    const dependencies = createDependencies()
    dependencies.loadLibrary.mockResolvedValue(null)
    dependencies.saveLibrary.mockImplementation(async () => { order.push("database") })
    dependencies.removeLegacyTracks.mockImplementation(async () => { order.push("toml") })

    await expect(loadAndMigrateMelodeckLibrary({
      saved_tracks: [{ name: "Legacy", writer: "Artist", path: "D:/Music/legacy.flac" }],
    }, dependencies)).resolves.toEqual([
      { name: "Legacy", writer: "Artist", path: "D:/Music/legacy.flac", size: undefined, type: undefined },
    ])

    expect(order).toEqual(["database", "toml"])
  })

  it("keeps the legacy TOML field when the database write fails", async () => {
    const dependencies = createDependencies()
    dependencies.loadLibrary.mockResolvedValue(null)
    dependencies.saveLibrary.mockRejectedValue(new Error("IndexedDB unavailable"))

    await expect(loadAndMigrateMelodeckLibrary({
      saved_tracks: [{ name: "Legacy", path: "D:/Music/legacy.flac" }],
    }, dependencies)).rejects.toThrow("IndexedDB unavailable")

    expect(dependencies.removeLegacyTracks).not.toHaveBeenCalled()
  })
})

function createDependencies() {
  return {
    loadLibrary: vi.fn<MelodeckLibraryMigrationDependencies["loadLibrary"]>(),
    saveLibrary: vi.fn<MelodeckLibraryMigrationDependencies["saveLibrary"]>(),
    removeLegacyTracks: vi.fn<MelodeckLibraryMigrationDependencies["removeLegacyTracks"]>(),
  }
}
