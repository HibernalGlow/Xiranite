import { beforeEach, describe, expect, it, vi } from "vitest"

const localFiles = vi.hoisted(() => ({
  pickLocalPaths: vi.fn(),
  resolveLocalAudioTracks: vi.fn(),
}))
const wailsRuntime = vi.hoisted(() => ({ openFile: vi.fn() }))

vi.mock("@/backend/localFilesClient", () => localFiles)
vi.mock("@/backend/localBackendConfig", () => ({ localBackendFileUrl: (path: string) => `local://${path}` }))
vi.mock("@wailsio/runtime", () => ({ Dialogs: { OpenFile: wailsRuntime.openFile } }))

import { foliaMelodeckHost } from "./foliaHost"

describe("Folia Melodeck host adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete window._wails
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
