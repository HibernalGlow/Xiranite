import { useEffect } from "react"
import { useFoliaPlayer } from "@hibernalglow/folia-player"
import type { MusicPlaybackControls, MusicPlaybackState } from "@/components/modules/musicPlayer/MusicPlayerSurface"
import { subscribeMissingMelodeckTrack } from "./missingTrackEvents"

interface MelodeckFoliaBridgeProps {
  enabled: boolean
  setPlaybackControls(controls: MusicPlaybackControls | null): void
  setPlaybackState(state: MusicPlaybackState): void
}

export function MelodeckFoliaBridge({
  enabled,
  setPlaybackControls,
  setPlaybackState,
}: MelodeckFoliaBridgeProps) {
  const { actions, snapshot, tracks } = useFoliaPlayer()

  useEffect(() => {
    if (!enabled) return
    setPlaybackState({
      hasTrack: Boolean(snapshot.activeTrack),
      isPlaying: snapshot.isPlaying,
      trackCount: tracks.length,
      currentTime: snapshot.currentTime,
      duration: snapshot.duration,
      artworkUrl: snapshot.activeTrack?.coverUrl,
      trackName: snapshot.activeTrack?.title,
      supportLine: snapshot.currentLyric || snapshot.activeTrack?.artist,
    })
    setPlaybackControls({
      playPrevious: actions.previous,
      playNext: actions.next,
      togglePlay: () => void actions.toggle(),
      seekTo: actions.seek,
    })
    return () => setPlaybackControls(null)
  }, [actions, enabled, setPlaybackControls, setPlaybackState, snapshot, tracks.length])

  useEffect(() => {
    if (!enabled) return
    return subscribeMissingMelodeckTrack((trackId) => {
      const index = tracks.findIndex((track) => track.id === trackId)
      if (index >= 0) actions.removeTrack(index)
    })
  }, [actions, enabled, tracks])

  return null
}
