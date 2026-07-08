import { useCallback } from "react"
import { useComponentData } from "@/hooks/useComponentData"
import type { ModuleProps } from "./ModuleRenderer"
import { MusicPlayerSurface, type PersistedTrack } from "./musicPlayer/MusicPlayerSurface"

interface MusicPlayerData {
  savedTracks?: PersistedTrack[]
  sourcePath?: string
}

export default function MusicPlayerModule({ compId }: ModuleProps) {
  const [data, setData] = useComponentData<MusicPlayerData>(compId)

  const handleSavedTracksChange = useCallback((savedTracks: PersistedTrack[]) => {
    setData({ savedTracks })
  }, [setData])

  const handleSourcePathChange = useCallback((sourcePath: string) => {
    setData({ sourcePath })
  }, [setData])

  return (
    <MusicPlayerSurface
      savedTracks={data.savedTracks}
      savedSourcePath={data.sourcePath}
      onSavedTracksChange={handleSavedTracksChange}
      onSourcePathChange={handleSourcePathChange}
      variant="module"
      className="rounded-[inherit]"
    />
  )
}
