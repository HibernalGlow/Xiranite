import { beforeEach, describe, expect, it, vi } from "vitest"

const localFiles = vi.hoisted(() => ({
  listLocalFiles: vi.fn(),
  pickLocalPaths: vi.fn(),
  resolveLocalAudioTracks: vi.fn(),
}))
const wailsRuntime = vi.hoisted(() => ({ openFile: vi.fn() }))
const metadata = vi.hoisted(() => ({ parseWebStream: vi.fn() }))

vi.mock("@/backend/localFilesClient", () => localFiles)
vi.mock("@/backend/localBackendConfig", () => ({ localBackendFileUrl: (path: string) => `local://${path}` }))
vi.mock("@wailsio/runtime", () => ({ Dialogs: { OpenFile: wailsRuntime.openFile } }))
vi.mock("music-metadata", () => ({ parseWebStream: metadata.parseWebStream }))

import { foliaMelodeckHost } from "./foliaHost"

describe("Folia Melodeck host adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete window._wails
    metadata.parseWebStream.mockResolvedValue({ common: {}, format: {} })
  })

  it("scans multiple roots and removes duplicate paths", async () => {
    localFiles.resolveLocalAudioTracks
      .mockResolvedValueOnce([{ name: "One", path: "D:/Music/one.flac", src: "local://one", writer: "Artist" }])
      .mockResolvedValueOnce([
        { name: "One", path: "D:/Music/one.flac", src: "local://one" },
        { name: "Two", path: "E:/Music/two.mp3", src: "local://two", type: "audio/mpeg" },
      ])

    const tracks = await foliaMelodeckHost.scanLibraryRoots?.(["D:/Music", "E:/Music"], new AbortController().signal)

    expect(tracks).toEqual([
      expect.objectContaining({ id: "D:/Music/one.flac", title: "One", artist: "Artist" }),
      expect.objectContaining({ id: "E:/Music/two.mp3", title: "Two", mimeType: "audio/mpeg" }),
    ])
  })

  it("keeps tracks from valid roots when a stale root fails", async () => {
    localFiles.resolveLocalAudioTracks
      .mockRejectedValueOnce(new Error("not a directory"))
      .mockResolvedValueOnce([{ name: "Two", path: "E:/Music/two.mp3", src: "local://two" }])

    const tracks = await foliaMelodeckHost.scanLibraryRoots?.(
      ["E:/Music/stale.flac", "E:/Music"],
      new AbortController().signal,
    )

    expect(tracks).toEqual([expect.objectContaining({ id: "E:/Music/two.mp3", title: "Two" })])
  })

  it("indexes optional files once when selected tracks are hydrated", async () => {
    localFiles.listLocalFiles.mockResolvedValue([{
      name: "cover.jpg",
      path: "E:/Music/Album/cover.jpg",
      isDirectory: false,
      sizeBytes: 4,
      lastModified: 1,
      type: "image/jpeg",
    }])
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      new Response(new Blob(["data"]), { status: 200 })
    ))
    const signal = new AbortController().signal

    try {
      const first = await foliaMelodeckHost.hydrateTrack?.({
        id: "one",
        path: "E:/Music/Album/one.flac",
        src: "local://one.flac",
        title: "One",
      }, signal)
      const second = await foliaMelodeckHost.hydrateTrack?.({
        id: "two",
        path: "E:/Music/Album/two.flac",
        src: "local://two.flac",
        title: "Two",
      }, signal)
      first?.release?.()
      second?.release?.()
    } finally {
      fetchSpy.mockRestore()
    }

    expect(localFiles.listLocalFiles).toHaveBeenCalledTimes(1)
    expect(localFiles.listLocalFiles).toHaveBeenCalledWith("E:/Music/Album", expect.objectContaining({
      extensions: expect.arrayContaining([".lrc", ".yrc", ".jpg", ".png"]),
    }))
  })

  it("uses the local backend directory picker outside Wails", async () => {
    localFiles.pickLocalPaths.mockResolvedValue(["D:/Music"])
    await expect(foliaMelodeckHost.pickLibraryRoot?.()).resolves.toBe("D:/Music")
  })

  it("uses the same Wails directory dialog as card hosts in packaged builds", async () => {
    window._wails = {}
    wailsRuntime.openFile.mockResolvedValue("D:/Music")

    await expect(foliaMelodeckHost.pickLibraryRoot?.()).resolves.toBe("D:/Music")
    expect(wailsRuntime.openFile).toHaveBeenCalledWith({
      CanChooseFiles: false,
      CanChooseDirectories: true,
      AllowsMultipleSelection: false,
      Title: "选择音乐文件夹",
    })
    expect(localFiles.pickLocalPaths).not.toHaveBeenCalled()
  })

  it("treats cancelling the Wails directory dialog as no selection", async () => {
    window._wails = {}
    wailsRuntime.openFile.mockResolvedValue("")

    await expect(foliaMelodeckHost.pickLibraryRoot?.()).resolves.toBeNull()
  })
})
