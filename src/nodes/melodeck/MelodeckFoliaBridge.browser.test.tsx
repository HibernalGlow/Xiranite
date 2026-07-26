import { afterEach, expect, test, vi } from "vitest"
import { cleanup, render } from "vitest-browser-react"
import { useState } from "react"
import {
  DEFAULT_FOLIA_PLAYER_PREFERENCES,
  FoliaPlayerProvider,
  type FoliaPlayerHostAdapter,
  type FoliaTrack,
} from "@hibernalglow/folia-player"
import { MelodeckFoliaBridge } from "./MelodeckFoliaBridge"
import { reportMissingMelodeckTrack } from "./missingTrackEvents"

const setPlaybackControls = vi.fn()
const setPlaybackState = vi.fn()

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test("removes a deleted local track through Folia's controlled queue", async () => {
  await render(<MissingTrackHarness host={MISSING_TRACK_HOST} />)

  await expect.poll(() => document.querySelector("[data-track-ids]")?.getAttribute("data-track-ids")).toBe("")
})

test("does not alter the queue while the Folia engine is disabled", async () => {
  await render(<MissingTrackHarness enabled={false} host={{}} />)

  reportMissingMelodeckTrack(DELETED_TRACK.id)

  expect(document.querySelector("[data-track-ids]")?.getAttribute("data-track-ids")).toBe(DELETED_TRACK.id)
})

function MissingTrackHarness({
  enabled = true,
  host,
}: {
  enabled?: boolean
  host: FoliaPlayerHostAdapter
}) {
  const [tracks, setTracks] = useState<FoliaTrack[]>([DELETED_TRACK])
  return (
    <div data-track-ids={tracks.map((track) => track.id).join(",")}>
      <FoliaPlayerProvider
        tracks={tracks}
        onTracksChange={setTracks}
        host={host}
        enabled={enabled}
        preferences={{ ...DEFAULT_FOLIA_PLAYER_PREFERENCES, backgroundMetadataEnabled: false }}
      >
        <MelodeckFoliaBridge
          enabled={enabled}
          setPlaybackControls={setPlaybackControls}
          setPlaybackState={setPlaybackState}
        />
      </FoliaPlayerProvider>
    </div>
  )
}

const DELETED_TRACK: FoliaTrack = {
  id: "E:/Music/deleted.flac",
  path: "E:/Music/deleted.flac",
  src: "local://deleted.flac",
  title: "Deleted",
}

const MISSING_TRACK_HOST: FoliaPlayerHostAdapter = {
  async hydrateTrack(track) {
    reportMissingMelodeckTrack(track.id)
    return {}
  },
}
