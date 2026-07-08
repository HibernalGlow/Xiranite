import { useCallback } from "react"
import { useComponentData } from "@/hooks/useComponentData"
import type { ModuleProps } from "./ModuleRenderer"
import { MusicPlayerSurface, type PersistedTrack } from "./musicPlayer/MusicPlayerSurface"

interface MusicPlayerData {
  savedTracks?: PersistedTrack[]
}

export default function MusicPlayerModule({ compId }: ModuleProps) {
  const [data, setData] = useComponentData<MusicPlayerData>(compId)

  const handleSavedTracksChange = useCallback((savedTracks: PersistedTrack[]) => {
    setData({ savedTracks })
  }, [setData])

  return (
    <MusicPlayerSurface
      savedTracks={data.savedTracks}
      onSavedTracksChange={handleSavedTracksChange}
      variant="module"
      className="rounded-[inherit]"
    />
  )
}
