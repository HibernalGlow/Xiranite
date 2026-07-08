import { useState } from "react"
import { motion } from "motion/react"
import { GripHorizontal, Maximize2, Minimize2, Music2, PanelBottom, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MusicPlayerSurface, type PersistedTrack } from "@/components/modules/musicPlayer/MusicPlayerSurface"
import { cn } from "@/lib/utils"

type DockMode = "bottom" | "floating"

export function WorkspaceMusicDock() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<DockMode>("bottom")
  const [savedTracks, setSavedTracks] = useState<PersistedTrack[]>([])

  if (!open) {
    return (
      <Button
        type="button"
        size="icon"
        className="absolute bottom-4 right-4 z-50 size-10 rounded-full shadow-lg shadow-black/20"
        onClick={() => setOpen(true)}
        title="打开音乐底栏"
        aria-label="打开音乐底栏"
      >
        <Music2 />
      </Button>
    )
  }

  const chrome = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-background/95 shadow-2xl shadow-black/30 backdrop-blur">
      <div className="xiranite-music-dock-handle flex h-8 shrink-0 items-center gap-2 border-b border-border/60 px-2 text-muted-foreground">
        <GripHorizontal className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide">Music Dock</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setMode(mode === "bottom" ? "floating" : "bottom")}
          title={mode === "bottom" ? "切换为浮动 dock" : "固定到底栏"}
          aria-label={mode === "bottom" ? "切换为浮动 dock" : "固定到底栏"}
        >
          {mode === "bottom" ? <Maximize2 /> : <PanelBottom />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setOpen(false)}
          title="收起音乐 dock"
          aria-label="收起音乐 dock"
        >
          <Minimize2 />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 hover:text-destructive"
          onClick={() => setOpen(false)}
          title="关闭音乐 dock"
          aria-label="关闭音乐 dock"
        >
          <X />
        </Button>
      </div>
      <MusicPlayerSurface
        savedTracks={savedTracks}
        onSavedTracksChange={setSavedTracks}
        variant="dock"
        className="flex-1"
      />
    </div>
  )

  if (mode === "bottom") {
    return (
      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-50 h-[176px]">
        <div className="pointer-events-auto mx-auto h-full max-w-5xl">
          {chrome}
        </div>
      </div>
    )
  }

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragListener
      className={cn("absolute bottom-4 right-4 z-50 h-[220px] w-[520px] max-w-[calc(100vw-2rem)]")}
    >
      {chrome}
    </motion.div>
  )
}
