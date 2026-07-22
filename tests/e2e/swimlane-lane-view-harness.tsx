import { createRoot } from "react-dom/client"

import "../../src/styles/tailwind.css"
import "../../src/index.css"
import "../../src/styles/themes/index.css"
import { LaneView } from "../../src/components/workspace/lane/LaneView"
import { initI18n } from "../../src/i18n"
import { INITIAL_STATE } from "../../src/store/workspace/constants"
import { useWorkspaceStore } from "../../src/store/workspaceStore"

async function bootstrap() {
  await initI18n()
  useWorkspaceStore.setState({
    ...INITIAL_STATE,
    activeWorkspaceId: "lane-harness",
    viewMode: "lane",
    workspaces: [{ id: "lane-harness", label: "Lane harness" }],
    lanes: [
      { id: "lane-left", workspaceId: "lane-harness", label: "Left", widthRatio: 1, collapsed: false, cardOrder: [] },
      { id: "lane-right", workspaceId: "lane-harness", label: "Right", widthRatio: 1, collapsed: false, cardOrder: [] },
    ],
    components: [],
    laneWorkspacePreferences: {},
  })
  createRoot(document.getElementById("root")!).render(<div className="flex h-screen w-screen overflow-hidden bg-background text-foreground"><LaneView /><StateOutput /></div>)
}

function StateOutput() {
  const laneOrder = useWorkspaceStore((state) => state.lanes.filter((lane) => lane.workspaceId === "lane-harness").map((lane) => lane.id).join(","))
  const preferences = useWorkspaceStore((state) => state.laneWorkspacePreferences["lane-harness"])
  return <output className="sr-only" data-lane-order={laneOrder} data-active-lane={preferences?.activeLaneId} data-solo-lane={preferences?.soloLaneId ?? ""} data-navigator-dock={preferences?.navigatorDock ?? "floating"} data-navigator-lane={preferences?.navigatorLaneId ?? ""} />
}

void bootstrap()
