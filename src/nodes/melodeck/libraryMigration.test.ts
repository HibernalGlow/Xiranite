import { describe, expect, it, vi } from "vitest"

import { loadAndMigrateMelodeckLibrary, type MelodeckLibraryMigrationDependencies } from "./libraryMigration"

describe("Melodeck library migration", () => {
  it("uses the shared database directly after this browser origin has migrated", async () => {
    const dependencies = createDependencies()
    dependencies.loadDatabaseLibrary.mockResolvedValue({ initialized: true, tracks: [] })
    dependencies.isOriginMigrationComplete.mockReturnValue(true)

    await expect(loadAndMigrateMelodeckLibrary({
      saved_tracks: [{ name: "Legacy", path: "D:/Music/legacy.flac" }],
    }, dependencies)).resolves.toEqual([])

    expect(dependencies.loadOriginLibrary).not.toHaveBeenCalled()
    expect(dependencies.saveDatabaseLibrary).not.toHaveBeenCalled()
    expect(dependencies.removeLegacyTracks).not.toHaveBeenCalled()
  })

  it("merges each origin's old IndexedDB list into the shared database once", async () => {
    const order: string[] = []
    const dependencies = createDependencies()
    dependencies.loadDatabaseLibrary.mockResolvedValue({
      initialized: true,
      tracks: [{ path: "D:/Music/shared.flac", title: "Database title" }],
    })
    dependencies.loadOriginLibrary.mockResolvedValue([
      { id: "shared", path: "d:\\music\\shared.flac", title: "Stale origin title" },
      { id: "origin", path: "D:/Music/origin.flac", title: "Origin" },
    ])
    dependencies.saveDatabaseLibrary.mockImplementation(async () => { order.push("database") })
    dependencies.removeLegacyTracks.mockImplementation(async () => { order.push("toml") })
    dependencies.markOriginMigrationComplete.mockImplementation(() => { order.push("origin-marker") })

    await expect(loadAndMigrateMelodeckLibrary({
      saved_tracks: [{ name: "TOML", path: "D:/Music/toml.flac" }],
    }, dependencies)).resolves.toEqual([
      expect.objectContaining({ name: "Database title", path: "D:/Music/shared.flac" }),
      expect.objectContaining({ name: "Origin", path: "D:/Music/origin.flac" }),
      expect.objectContaining({ name: "TOML", path: "D:/Music/toml.flac" }),
    ])

    expect(dependencies.saveDatabaseLibrary).toHaveBeenCalledWith([
      expect.objectContaining({ title: "Database title", path: "D:/Music/shared.flac" }),
      expect.objectContaining({ title: "Origin", path: "D:/Music/origin.flac" }),
      expect.objectContaining({ title: "TOML", path: "D:/Music/toml.flac" }),
    ])
    expect(order).toEqual(["database", "toml", "origin-marker"])
  })

  it("does not mark an origin migrated or remove TOML when the database write fails", async () => {
    const dependencies = createDependencies()
    dependencies.loadDatabaseLibrary.mockResolvedValue({ initialized: false, tracks: [] })
    dependencies.loadOriginLibrary.mockResolvedValue(null)
    dependencies.saveDatabaseLibrary.mockRejectedValue(new Error("database unavailable"))

    await expect(loadAndMigrateMelodeckLibrary({
      saved_tracks: [{ name: "Legacy", path: "D:/Music/legacy.flac" }],
    }, dependencies)).rejects.toThrow("database unavailable")

    expect(dependencies.removeLegacyTracks).not.toHaveBeenCalled()
    expect(dependencies.markOriginMigrationComplete).not.toHaveBeenCalled()
  })
})

function createDependencies() {
  return {
    loadDatabaseLibrary: vi.fn<MelodeckLibraryMigrationDependencies["loadDatabaseLibrary"]>(),
    saveDatabaseLibrary: vi.fn<MelodeckLibraryMigrationDependencies["saveDatabaseLibrary"]>(),
    loadOriginLibrary: vi.fn<MelodeckLibraryMigrationDependencies["loadOriginLibrary"]>(),
    isOriginMigrationComplete: vi.fn<MelodeckLibraryMigrationDependencies["isOriginMigrationComplete"]>().mockReturnValue(false),
    markOriginMigrationComplete: vi.fn<MelodeckLibraryMigrationDependencies["markOriginMigrationComplete"]>(),
    removeLegacyTracks: vi.fn<MelodeckLibraryMigrationDependencies["removeLegacyTracks"]>(),
  }
}
