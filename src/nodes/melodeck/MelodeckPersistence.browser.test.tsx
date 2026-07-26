import { expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { FoliaPlayerProvider, useFoliaPlayer, type FoliaTrack } from "@hibernalglow/folia-player"

const database = vi.hoisted(() => ({
  loadMetadata: vi.fn(),
  saveMetadata: vi.fn(),
}))

vi.mock("@/backend/melodeckLibraryClient", () => ({
  loadMelodeckDatabaseMetadata: database.loadMetadata,
  saveMelodeckDatabaseMetadata: database.saveMetadata,
  melodeckDatabaseCoverUrl: (path: string) => `database-cover://${path}`,
}))

import { foliaMelodeckHost } from "./foliaHost"

test("hydrates a rendered Folia player from the shared metadata database", async () => {
  database.loadMetadata.mockResolvedValue({
    path: "D:/Music/shared.flac",
    fileSize: 42,
    lastModified: 100,
    title: "Shared title",
    artist: "Shared artist",
    album: "Shared album",
    duration: 180,
    lyrics: { lines: [{ startTime: 0, endTime: 10_000, fullText: "Shared lyric" }] },
    lyricsHydrated: true,
    hasCover: true,
    updatedAt: 200,
  })
  database.saveMetadata.mockClear()

  await render(
    <FoliaPlayerProvider tracks={tracks} onTracksChange={() => undefined} host={foliaMelodeckHost}>
      <MetadataProbe />
    </FoliaPlayerProvider>,
  )

  const probe = document.querySelector<HTMLElement>("[data-melodeck-metadata-probe]")!
  await expect.poll(() => probe.getAttribute("data-title")).toBe("Shared title")
  expect(probe.getAttribute("data-artist")).toBe("Shared artist")
  expect(probe.getAttribute("data-cover")).toBe("database-cover://D:/Music/shared.flac")
  expect(probe.textContent).toContain("Shared lyric")
  expect(database.loadMetadata).toHaveBeenCalledWith("D:/Music/shared.flac", expect.any(AbortSignal))
  expect(database.saveMetadata).not.toHaveBeenCalled()
})

function MetadataProbe() {
  const { snapshot } = useFoliaPlayer()
  return (
    <output
      data-melodeck-metadata-probe
      data-title={snapshot.activeTrack?.title}
      data-artist={snapshot.activeTrack?.artist}
      data-cover={snapshot.activeTrack?.coverUrl}
    >
      {snapshot.activeTrack?.lyrics?.lines[0]?.fullText}
    </output>
  )
}

const tracks: FoliaTrack[] = [{
  id: "D:/Music/shared.flac",
  path: "D:/Music/shared.flac",
  src: "data:audio/wav;base64,UklGRgQAAABXQVZF",
  title: "Filename title",
}]
