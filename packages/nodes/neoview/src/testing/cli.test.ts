import { describe, expect, it, vi } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"

import { runProgram } from "../cli.js"
import type { ReaderLibraryHeadlessController } from "../application/headless/ReaderLibraryHeadlessController.js"

describe("NeoView library CLI", () => {
  it("shows the intentionally small metadata-only command surface", async () => {
    const output: string[] = []
    await runProgram(["help"], host(output))

    expect(output.join("\n")).toContain("xneoview history")
    expect(output.join("\n")).toContain("xneoview bookmarks")
    expect(output.join("\n")).toContain("Open images and books in the NeoView GUI")
    expect(output.join("\n")).not.toContain("extract-page")
  })

  it("lists history with pagination and filtering", async () => {
    const output: string[] = []
    const library = fakeLibrary({
      listRecent: vi.fn(async () => [
        {
          bookId: "book-1",
          displayName: "Demo",
          source: { kind: "path", path: "D:/books/demo.cbz" },
        },
      ]),
    })

    await runProgram(["history", "--limit", "20", "--offset", "5", "--filter", "archive", "--json"], host(output), {
      createLibraryController: async () => library,
    })

    expect(library.listRecent).toHaveBeenCalledWith(20, 5, "archive")
    expect(JSON.parse(output.join("\n"))).toHaveLength(1)
    expect(library.close).toHaveBeenCalledOnce()
  })

  it("lists bookmarks and keeps the previous read-only alias", async () => {
    const output: string[] = []
    const library = fakeLibrary({
      listBookmarks: vi.fn(async () => [
        {
          id: "bookmark-1",
          name: "Reading",
          source: { kind: "path", path: "D:/reading" },
        },
      ]),
    })

    await runProgram(["library-bookmarks", "--list", "reading", "--limit", "10"], host(output), { createLibraryController: async () => library })

    expect(library.listBookmarks).toHaveBeenCalledWith("reading", 10, 0, undefined)
    expect(output.some((line) => line.includes("Bookmarks: 1"))).toBe(true)
    expect(output.some((line) => line.includes("D:/reading"))).toBe(true)
  })

  it("lists bookmark groups and library statistics", async () => {
    const listOutput: string[] = []
    const statsOutput: string[] = []
    const library = fakeLibrary({
      listBookmarkLists: vi.fn(async () => [{ id: "reading", name: "Reading" }]),
      statistics: vi.fn(async () => ({
        recents: 12,
        bookmarks: 4,
        bookmarkLists: 1,
        playlists: 0,
      })),
    })
    const dependencies = { createLibraryController: async () => library }

    await runProgram(["bookmark-lists", "--json"], host(listOutput), dependencies)
    await runProgram(["stats", "--json"], host(statsOutput), dependencies)

    expect(JSON.parse(listOutput.join("\n"))).toEqual([{ id: "reading", name: "Reading" }])
    expect(JSON.parse(statsOutput.join("\n"))).toMatchObject({
      recents: 12,
      bookmarks: 4,
    })
  })

  it("rejects removed commands and invalid options without opening the database", async () => {
    const createLibraryController = vi.fn()
    await expect(
      runProgram(["extract-page", "book.cbz"], host([]), {
        createLibraryController,
      }),
    ).rejects.toThrow("Unknown NeoView command")
    await expect(
      runProgram(["history", "--limit", "0"], host([]), {
        createLibraryController: async () => fakeLibrary(),
      }),
    ).rejects.toThrow("--limit must be an integer")
    expect(createLibraryController).not.toHaveBeenCalled()
  })
})

function fakeLibrary(overrides: Partial<ReaderLibraryHeadlessController> = {}): ReaderLibraryHeadlessController {
  return {
    listRecent: vi.fn(async () => []),
    listBookmarks: vi.fn(async () => []),
    listBookmarkLists: vi.fn(async () => []),
    statistics: vi.fn(async () => ({
      recents: 0,
      bookmarks: 0,
      bookmarkLists: 0,
      playlists: 0,
    })),
    close: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ReaderLibraryHeadlessController
}

function host(output: string[]): CliHost {
  return {
    stdin: {
      isTTY: false,
      read: async () => "",
      readBytes: async () => new Uint8Array(),
    },
    stdout: { isTTY: false, write: (value) => output.push(value) },
    stderr: { isTTY: false, write: (value) => output.push(value) },
    env: {},
    cwd: process.cwd(),
  }
}
