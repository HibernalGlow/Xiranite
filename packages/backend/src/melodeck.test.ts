import { createMemoryMelodeckRepository } from "@xiranite/repository"
import { afterEach, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { handleMelodeckRequest } from "./melodeck.js"

const RUN_ROOT = join(process.cwd(), "artifacts", "test-runs", "backend-melodeck")
const cleanup: string[] = []

afterEach(async () => {
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe("handleMelodeckRequest", () => {
  test("shares a library and fingerprinted metadata through the backend boundary", async () => {
    await mkdir(RUN_ROOT, { recursive: true })
    const directory = await mkdtemp(join(RUN_ROOT, "route-"))
    cleanup.push(directory)
    const audioPath = join(directory, "song.flac")
    await writeFile(audioPath, new Uint8Array([1, 2, 3, 4]))
    const repository = createMemoryMelodeckRepository()

    const saveLibrary = await request(repository, "/melodeck/library", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tracks: [{ path: audioPath, title: "Song" }] }),
    })
    expect(saveLibrary.status).toBe(204)
    const library = await request(repository, "/melodeck/library")
    await expect(library.json()).resolves.toMatchObject({
      initialized: true,
      tracks: [{ path: audioPath, title: "Song" }],
    })

    const saveMetadata = await request(repository, "/melodeck/metadata", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: audioPath,
        title: "Resolved song",
        artist: "Artist",
        lyrics: { lines: [{ fullText: "Line" }] },
        lyricsHydrated: true,
        cover: { mimeType: "image/png", base64: "AQID" },
      }),
    })
    expect(saveMetadata.status).toBe(200)
    await expect(saveMetadata.json()).resolves.toMatchObject({
      metadata: { title: "Resolved song", artist: "Artist", hasCover: true, lyricsHydrated: true },
    })

    const metadata = await request(repository, `/melodeck/metadata?path=${encodeURIComponent(audioPath)}`)
    await expect(metadata.json()).resolves.toMatchObject({
      metadata: { title: "Resolved song", lyrics: { lines: [{ fullText: "Line" }] } },
    })
    const cover = await request(repository, `/melodeck/cover?path=${encodeURIComponent(audioPath)}`)
    expect(cover.headers.get("content-type")).toBe("image/png")
    expect(new Uint8Array(await cover.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

    await writeFile(audioPath, new Uint8Array([1, 2, 3, 4, 5]))
    const stale = await request(repository, `/melodeck/metadata?path=${encodeURIComponent(audioPath)}`)
    await expect(stale.json()).resolves.toEqual({ metadata: null })
  })
})

async function request(
  repository: ReturnType<typeof createMemoryMelodeckRepository>,
  pathname: string,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(pathname, "http://localhost")
  const response = await handleMelodeckRequest(new Request(url, init), url, repository)
  if (!response) throw new Error(`Unhandled test request: ${pathname}`)
  return response
}
