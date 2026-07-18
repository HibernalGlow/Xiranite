import { lazy, Suspense, useCallback } from "react"
import { useComponentData } from "@/hooks/useComponentData"
import type { ModuleProps } from "./ModuleRenderer"
import type { PersistedTrack } from "./musicPlayer/MusicPlayerSurface"

interface MusicPlayerData {
  savedTracks?: PersistedTrack[]
  sourcePath?: string
}

const MusicPlayerSurface = lazy(() =>
  import("./musicPlayer/MusicPlayerSurface").then((module) => ({
    default: module.MusicPlayerSurface,
  })),
)

export default function MusicPlayerModule({ compId }: ModuleProps) {
  const [data, setData] = useComponentData<MusicPlayerData>(compId)

  const handleSavedTracksChange = useCallback((savedTracks: PersistedTrack[]) => {
    setData({ savedTracks })
  }, [setData])

  const handleSourcePathChange = useCallback((sourcePath: string) => {
    setData({ sourcePath })
  }, [setData])

  return (
    <Suspense fallback={<MusicPlayerModuleFallback />}>
      <MusicPlayerSurface
        savedTracks={data.savedTracks}
        savedSourcePath={data.sourcePath}
        onSavedTracksChange={handleSavedTracksChange}
        onSourcePathChange={handleSourcePathChange}
        variant="module"
        className="rounded-[inherit]"
      />
    </Suspense>
  )
}

function MusicPlayerModuleFallback() {
  return (
    <div className="grid h-full min-h-0 place-items-center rounded-[inherit] text-xs text-muted-foreground">
      Loading music player...
    </div>
  )
}
