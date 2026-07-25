import { beforeEach, describe, expect, it, vi } from "vitest"

const localFiles = vi.hoisted(() => ({
  pickLocalPaths: vi.fn(),
  resolveLocalAudioTracks: vi.fn(),
}))

vi.mock("@/backend/localFilesClient", () => localFiles)
vi.mock("@/backend/localBackendConfig", () => ({ localBackendFileUrl: (path: string) => `local://${path}` }))

import { foliaMelodeckHost } from "./foliaHost"

describe("Folia Melodeck host adapter", () => {
  beforeEach(() => vi.clearAllMocks())

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

  it("uses the native directory picker for new roots", async () => {
    localFiles.pickLocalPaths.mockResolvedValue(["D:/Music"])
    await expect(foliaMelodeckHost.pickLibraryRoot?.()).resolves.toBe("D:/Music")
  })
})
