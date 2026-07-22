import { useCallback, useEffect, useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"
import { MusicPlayerSurface, type PersistedTrack } from "@/components/modules/musicPlayer/MusicPlayerSurface"
import { loadMelodeckConfig, MELODECK_CONFIG_CHANGED_EVENT, saveMelodeckConfig } from "./config"

interface MelodeckCardState {
  savedTracks?: PersistedTrack[]
  sourcePath?: string
}

export function Component({ compId, host }: NodeComponentProps<MelodeckCardState>) {
  const componentData = host.state?.getData?.() ?? host.getData<MelodeckCardState>(compId) ?? {}
  const [savedTracks, setSavedTracks] = useState(componentData.savedTracks ?? [])
  const [sourcePath, setSourcePath] = useState(componentData.sourcePath ?? "")

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      loadMelodeckConfig().then((config) => {
        if (cancelled) return
        setSavedTracks(config.saved_tracks ?? [])
        setSourcePath(config.source_path ?? "")
      }).catch(() => undefined)
    }
    refresh()
    window.addEventListener(MELODECK_CONFIG_CHANGED_EVENT, refresh)
    return () => {
      cancelled = true
      window.removeEventListener(MELODECK_CONFIG_CHANGED_EVENT, refresh)
    }
  }, [])

  const persist = useCallback(async (patch: MelodeckCardState) => {
    if (host.state?.patchData) host.state.patchData(patch)
    else host.patchData(compId, patch)
    await saveMelodeckConfig({
      ...(patch.savedTracks !== undefined ? { saved_tracks: patch.savedTracks } : {}),
      ...(patch.sourcePath !== undefined ? { source_path: patch.sourcePath } : {}),
    })
  }, [compId, host])

  const changeTracks = useCallback((tracks: PersistedTrack[]) => {
    setSavedTracks(tracks)
    void persist({ savedTracks: tracks })
  }, [persist])

  const changeSource = useCallback((path: string) => {
    setSourcePath(path)
    void persist({ sourcePath: path })
  }, [persist])

  return <MusicPlayerSurface savedTracks={savedTracks} savedSourcePath={sourcePath} onSavedTracksChange={changeTracks} onSourcePathChange={changeSource} variant="module" className="rounded-[inherit]" />
}
