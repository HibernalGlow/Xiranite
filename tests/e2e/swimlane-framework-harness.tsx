import { useState } from "react"
import { createRoot } from "react-dom/client"
import { Columns3, Maximize2, Minimize2 } from "lucide-react"

import "../../src/styles/tailwind.css"
import "../../src/index.css"
import "../../src/styles/themes/index.css"
import { SwimlaneBarAppearanceMenu } from "../../src/components/workspace/swimlane/SwimlaneBarAppearanceMenu"
import { SwimlaneBarMenuItem, SwimlaneNavigatorBar } from "../../src/components/workspace/swimlane/SwimlaneNavigatorBar"
import { ContextMenuProvider, useContextMenuBuilder } from "../../src/components/context-menu"
import { effectiveSwimlaneWidth } from "../../src/components/workspace/swimlane/model"

const ITEMS = Array.from({ length: 18 }, (_, index) => ({ id: `lane-${index}`, label: `工作面板 ${index + 1}`, icon: Columns3 }))

function Harness() {
  useContextMenuBuilder("workspace-canvas", () => [{ label: "viewMode", onSelect: () => undefined }])
  const [activeLaneId, setActiveLaneId] = useState("lane-0")
  const [soloLaneId, setSoloLaneId] = useState<string | undefined>("lane-0")
  const [position, setPosition] = useState({ x: 94, y: 92 })
  const [dock, setDock] = useState<"floating" | "title">("floating")
  const [handleStyle, setHandleStyle] = useState<"grip" | "groove" | "move" | "grab" | "edge">("groove")
  const [handlePosition, setHandlePosition] = useState<"left" | "right">("right")
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [titleHost, setTitleHost] = useState<HTMLElement | null>(null)
  const interaction = { laneOrder: ITEMS.map((item) => item.id), activeLaneId, soloLaneId }
  return <main data-context-menu="workspace-canvas" className="grid min-h-screen place-items-center bg-background p-8 text-foreground">
    <section ref={setHost} data-swimlane-harness="true" className="relative overflow-hidden border bg-card" style={{ width: 420, height: 320 }}>
      <header className="flex h-8 items-center border-b px-2"><span ref={setTitleHost} className="flex min-w-0 flex-1">{dock === "title" ? null : "活动泳道"}</span></header>
      <div className="flex overflow-x-auto" style={{ height: 288 }} data-swimlane-strip="true">
        {ITEMS.slice(0, 2).map((item) => <button
          key={item.id}
          type="button"
          data-harness-lane={item.id}
          data-active={activeLaneId === item.id}
          className="h-full shrink-0 border-r bg-muted/20"
          style={{ width: effectiveSwimlaneWidth(260, false, item.id, interaction, 420) }}
          onClick={() => setActiveLaneId(item.id)}
        >{item.label}</button>)}
      </div>
      <SwimlaneNavigatorBar
        items={ITEMS}
        activeId={activeLaneId}
        handleStyle={handleStyle}
        handlePosition={handlePosition}
        position={position}
        dock={dock}
        titleHost={titleHost}
        boundsHost={host}
        onSelect={setActiveLaneId}
        onPositionChange={setPosition}
        onDockChange={setDock}
        menu={<>
          <SwimlaneBarMenuItem onSelect={() => setSoloLaneId(soloLaneId === activeLaneId ? undefined : activeLaneId)}>{soloLaneId === activeLaneId ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}切换独占</SwimlaneBarMenuItem>
          <SwimlaneBarAppearanceMenu style={handleStyle} position={handlePosition} onStyleChange={setHandleStyle} onPositionChange={setHandlePosition} />
        </>}
      />
      <output data-navigator-position={`${position.x},${position.y}`} />
      <output data-navigator-dock={dock} />
    </section>
  </main>
}

createRoot(document.getElementById("root")!).render(<ContextMenuProvider><Harness /></ContextMenuProvider>)
