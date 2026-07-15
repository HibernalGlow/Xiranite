import { describe, expect, it } from "vitest"

import { CoreReaderDirectorySortPreferences } from "./ReaderDirectorySortPreferences.js"

const nameAsc = { field: "name" as const, order: "asc" as const, directoriesFirst: true }
const dateDesc = { field: "date" as const, order: "desc" as const, directoriesFirst: true }
const sizeDesc = { field: "size" as const, order: "desc" as const, directoriesFirst: true }
const typeAsc = { field: "type" as const, order: "asc" as const, directoriesFirst: true }

describe("CoreReaderDirectorySortPreferences", () => {
  it("[neoview.folder.sort-precedence] resolves temporary > folder memory > tab default > global default", async () => {
    const preferences = new CoreReaderDirectorySortPreferences()
    expect(await preferences.resolve("tab-1", "D:\\Books")).toMatchObject({ sort: nameAsc, source: "global-default" })
    await preferences.setDefault("tab-1", "global", dateDesc)
    expect(await preferences.resolve("tab-1", "D:/Books")).toMatchObject({ sort: dateDesc, source: "global-default" })
    await preferences.setDefault("tab-1", "tab", sizeDesc)
    expect(await preferences.resolve("tab-1", "D:/Books")).toMatchObject({ sort: sizeDesc, source: "tab-default" })
    await preferences.rememberCurrent("tab-1", "D:/Books", typeAsc)
    expect(await preferences.resolve("tab-1", "d:/books")).toMatchObject({ sort: typeAsc, source: "memory" })
    const temporary = await preferences.setTemporary("tab-1", "D:/Books", true, nameAsc)
    expect(temporary.preference).toMatchObject({ sort: nameAsc, source: "temporary", temporary: true })
    expect(await preferences.resolve("tab-1", "D:/Books", temporary.temporary)).toMatchObject({ sort: nameAsc, source: "temporary" })
  })

  it("[neoview.folder.sort-memory-clear] clears one normalized path or every remembered folder", async () => {
    const preferences = new CoreReaderDirectorySortPreferences()
    await preferences.rememberCurrent("tab-1", "D:\\One", dateDesc)
    await preferences.rememberCurrent("tab-1", "D:/Two", sizeDesc)
    await expect(preferences.clearMemory("d:/one")).resolves.toBe(1)
    expect(await preferences.resolve("tab-1", "D:/One")).toMatchObject({ source: "global-default" })
    await expect(preferences.clearMemory()).resolves.toBe(1)
  })
})
