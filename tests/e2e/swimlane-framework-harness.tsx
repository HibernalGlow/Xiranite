import { useState } from "react"
import { createRoot } from "react-dom/client"
import { Columns3, Maximize2, Minimize2 } from "lucide-react"

import "../../src/styles/tailwind.css"
import "../../src/index.css"
import "../../src/styles/themes/index.css"
import { SwimlaneBarMenuItem, SwimlaneNavigatorBar } from "../../src/components/workspace/swimlane/SwimlaneNavigatorBar"
import { effectiveSwimlaneWidth } from "../../src/components/workspace/swimlane/model"

const ITEMS = Array.from({ length: 18 }, (_, index) => ({ id: `lane-${index}`, label: `工作面板 ${index + 1}`, icon: Columns3 }))

function Harness() {
  const [activeLaneId, setActiveLaneId] = useState("lane-0")
  const [soloLaneId, setSoloLaneId] = useState<string | undefined>("lane-0")
  const [position, setPosition] = useState({ x: 94, y: 92 })
  const interaction = { laneOrder: ITEMS.map((item) => item.id), activeLaneId, soloLaneId }
  return <main className="grid min-h-screen place-items-center bg-background p-8 text-foreground">
    <section data-swimlane-harness="true" className="relative overflow-hidden border bg-card" style={{ width: 420, height: 320 }}>
      <div className="flex h-full overflow-x-auto" data-swimlane-strip="true">
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
        handleStyle="groove"
        handlePosition="right"
        position={position}
        onSelect={setActiveLaneId}
        onPositionChange={setPosition}
        menu={<SwimlaneBarMenuItem onSelect={() => setSoloLaneId(soloLaneId === activeLaneId ? undefined : activeLaneId)}>{soloLaneId === activeLaneId ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}切换独占</SwimlaneBarMenuItem>}
      />
      <output data-navigator-position={`${position.x},${position.y}`} />
    </section>
  </main>
}

createRoot(document.getElementById("root")!).render(<Harness />)
