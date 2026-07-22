/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useState } from "react"
import type { WorkspaceSnapshotDTO } from "@xiranite/shared"
import {
  ActionTabs,
  ClickTarget,
  TerminalTaskQueueScreen,
  TerminalThemeProvider,
  WorkbenchButton,
  WorkbenchPanel,
  resolveTerminalTheme,
  useTerminalTheme,
} from "@xiranite/cli-runtime/terminal/opentui"
import type { TerminalTaskQueueController } from "@xiranite/cli-runtime/terminal"

import type { NodeCliRegistration } from "./index.js"
import {
  activateTerminalSwimlane,
  addWorkspaceLane,
  createTerminalSwimlaneState,
  deployNode,
  focusAdjacentTerminalSwimlane,
  moveWorkspaceLane,
  patchNodeLayout,
  patchWorkspaceLane,
  projectTerminalLayout,
  projectTerminalSwimlanes,
  removeNode,
  resetTerminalSwimlaneNavigator,
  toggleTerminalSwimlaneSolo,
  type TerminalSwimlaneProjection,
  type TerminalSwimlaneState,
} from "./workspace-tui-model.js"

type TerminalWorkspaceView = "bento" | "lane"

export interface XiraniteWorkspaceController {
  available: boolean
  reason?: string
  load: () => Promise<WorkspaceSnapshotDTO>
  save: (snapshot: WorkspaceSnapshotDTO) => Promise<void>
}

export function XiraniteTui(props: {
  nodes: readonly NodeCliRegistration[]
  workspace: XiraniteWorkspaceController
  taskQueue: TerminalTaskQueueController
  onOpenNode: (nodeId: string) => void
  onExit: () => void
}) {
  return <TerminalThemeProvider theme={resolveTerminalTheme("nord")}><WorkspaceWorkbench {...props} /></TerminalThemeProvider>
}

function WorkspaceWorkbench({ nodes, workspace, taskQueue, onOpenNode, onExit }: Parameters<typeof XiraniteTui>[0]) {
  const theme = useTerminalTheme()
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshotDTO>({ workspaces: [], lanes: [], components: [] })
  const [workspaceId, setWorkspaceId] = useState("")
  const [selectedId, setSelectedId] = useState<string>()
  const [search, setSearch] = useState("")
  const [queueOpen, setQueueOpen] = useState(false)
  const [viewMode, setViewMode] = useState<TerminalWorkspaceView>("bento")
  const [laneStates, setLaneStates] = useState<Record<string, TerminalSwimlaneState>>({})
  const [status, setStatus] = useState("正在连接工作区…")
  const laneState = useMemo(() => createTerminalSwimlaneState(snapshot, workspaceId, laneStates[workspaceId]), [laneStates, snapshot, workspaceId])

  useEffect(() => {
    workspace.load().then((next) => {
      setSnapshot(next)
      setWorkspaceId(next.workspaces[0]?.id ?? "")
      if (next.lanes.some((lane) => lane.workspaceId === next.workspaces[0]?.id)) setViewMode("lane")
      setStatus(workspace.available ? "已连接 · 布局更改自动保存" : workspace.reason ?? "离线")
    }).catch((error) => setStatus(error instanceof Error ? error.message : String(error)))
  }, [workspace])

  useKeyboard((key) => {
    if (key.name === "escape") { if (queueOpen) setQueueOpen(false); else onExit() }
    if (key.name === "f9") setQueueOpen((value) => !value)
    if (key.name === "f6") setViewMode((value) => value === "lane" ? "bento" : "lane")
    if (viewMode === "lane" && key.name === "f2") setCurrentLaneState((state) => focusAdjacentTerminalSwimlane(state, "left"))
    if (viewMode === "lane" && key.name === "f3") setCurrentLaneState((state) => focusAdjacentTerminalSwimlane(state, "right"))
    if (viewMode === "lane" && key.name === "f4") setCurrentLaneState(toggleTerminalSwimlaneSolo)
    if (key.name === "delete" && selectedId) void mutate(removeNode(snapshot, selectedId), undefined)
    if (key.name === "enter" && selectedId) {
      const component = snapshot.components.find((item) => item.id === selectedId)
      if (component) onOpenNode(component.moduleId)
    }
  })

  const mutate = async (next: WorkspaceSnapshotDTO, nextSelected = selectedId) => {
    setSnapshot(next)
    setSelectedId(nextSelected)
    if (workspace.available) {
      try { await workspace.save(next); setStatus("布局已保存") }
      catch (error) { setStatus(error instanceof Error ? error.message : String(error)) }
    }
  }
  const setCurrentLaneState = (update: TerminalSwimlaneState | ((state: TerminalSwimlaneState) => TerminalSwimlaneState)) => {
    setLaneStates((current) => {
      const state = createTerminalSwimlaneState(snapshot, workspaceId, current[workspaceId])
      return { ...current, [workspaceId]: typeof update === "function" ? update(state) : update }
    })
  }
  const deploy = async (moduleId: string) => {
    if (!workspaceId) return
    const result = deployNode(snapshot, workspaceId, moduleId, Date.now(), viewMode === "lane" ? laneState.activeLaneId : undefined)
    await mutate(result.snapshot, result.componentId)
  }
  const addLane = async () => {
    if (!workspaceId) return
    const result = addWorkspaceLane(snapshot, workspaceId)
    setCurrentLaneState({ ...laneState, laneOrder: [...laneState.laneOrder, result.laneId], activeLaneId: result.laneId })
    await mutate(result.snapshot)
  }
  const patchActiveLane = async (patch: { collapsed?: boolean; widthRatio?: number }) => {
    if (!laneState.activeLaneId) return
    await mutate(patchWorkspaceLane(snapshot, laneState.activeLaneId, patch))
  }
  const moveActiveLane = async (edge: "left" | "right") => {
    if (!laneState.activeLaneId) return
    const next = moveWorkspaceLane(snapshot, workspaceId, laneState.activeLaneId, edge)
    const laneOrder = next.lanes.filter((lane) => lane.workspaceId === workspaceId && !lane.hidden).map((lane) => lane.id)
    setCurrentLaneState({ ...laneState, laneOrder })
    await mutate(next)
  }
  const selected = snapshot.components.find((item) => item.id === selectedId)
  const visibleNodes = nodes.filter((node) => `${node.id} ${node.description}`.toLowerCase().includes(search.toLowerCase())).slice(0, 80)
  const components = snapshot.components.filter((item) => item.workspaceId === workspaceId)
  const projected = useMemo(() => projectTerminalLayout(components, 70), [components])
  const projectedLanes = useMemo(() => projectTerminalSwimlanes(snapshot, workspaceId, 70, laneState), [laneState, snapshot, workspaceId])
  const activeLane = snapshot.lanes.find((lane) => lane.id === laneState.activeLaneId)

  if (queueOpen) return <TerminalTaskQueueScreen controller={taskQueue} onBack={() => setQueueOpen(false)} />

  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box height={4} flexShrink={0} borderStyle="single" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
        <box flexDirection="column"><text fg={theme.colors.primary}><b>◆ XIRANITE // TERMINAL WORKSPACE</b></text><text fg={theme.colors.mutedForeground}>{status}</text></box>
        <box flexDirection="row">
          <ActionTabs id="workspace-layout" options={[{ value: "bento", label: "便当" }, { value: "lane", label: "泳道" }]} value={viewMode} focused={false} onFocus={() => undefined} onChange={(value) => setViewMode(value === "lane" ? "lane" : "bento")} />
          {snapshot.workspaces.map((item) => <ClickTarget key={item.id} id={`workspace-${item.id}`} selected={workspaceId === item.id} onClick={() => { setWorkspaceId(item.id); setSelectedId(undefined) }}>{item.label}</ClickTarget>)}<ClickTarget id="global-queue" bordered onClick={() => setQueueOpen(true)}>▤ 队列 F9</ClickTarget>
        </box>
      </box>

      <box flexDirection="row" flexGrow={1} minHeight={0} gap={1} marginTop={1}>
        <WorkbenchPanel title="节点库" description={`${nodes.length} 个可部署节点`} width="26%">
          <box height={3} flexShrink={0} borderStyle="rounded" borderColor={theme.colors.border} paddingLeft={1} paddingRight={1}><input value={search} placeholder="搜索节点…" onInput={(value) => setSearch(String(value))} /></box>
          <scrollbox flexGrow={1}>{visibleNodes.map((node) => <box key={node.id} id={`library-${node.id}`} minHeight={3} flexDirection="column" paddingLeft={1} paddingRight={1} onMouseDown={() => void deploy(node.id)}><text fg={theme.colors.foreground}><b>{`＋ ${node.id}`}</b></text><text fg={theme.colors.mutedForeground}>{node.description}</text></box>)}</scrollbox>
        </WorkbenchPanel>

        <WorkbenchPanel title="动态工作区" description={viewMode === "lane" ? "共享泳道状态机 · F2/F3 聚焦 · F4 独占 · F6 切换布局" : "共享 12 列 Bento 布局 · 点击选中 · Enter 打开节点"} flexGrow={1}>
          {viewMode === "lane" ? <TerminalLaneWorkspace lanes={projectedLanes} state={laneState} selectedId={selectedId} onSelectLane={(laneId) => setCurrentLaneState((state) => activateTerminalSwimlane(state, laneId))} onSelectComponent={setSelectedId} /> : <scrollbox flexGrow={1}>
              <box flexDirection="row" flexWrap="wrap" gap={1} alignItems="flex-start">
                {projected.length ? projected.map((component) => <box key={component.id} id={`deployed-${component.id}`} width={component.terminalWidth} height={component.terminalHeight} flexDirection="column" borderStyle={selectedId === component.id ? "double" : "rounded"} borderColor={selectedId === component.id ? theme.colors.focusRing : theme.colors.border} paddingLeft={1} paddingRight={1} onMouseDown={() => setSelectedId(component.id)}><text fg={theme.colors.primary}><b>{`◇ ${component.moduleId}`}</b></text><text fg={theme.colors.mutedForeground}>{`x${component.bentoLayout?.x ?? 0} y${component.bentoLayout?.y ?? 0} · ${component.bentoLayout?.w ?? 4}×${component.bentoLayout?.h ?? 4}`}</text><box flexGrow={1} /><text fg={theme.colors.mutedForeground}>Enter 进入节点 UI</text></box>) : <box width="100%" height={10} alignItems="center" justifyContent="center"><text fg={theme.colors.mutedForeground}>从左侧点击节点，将它部署到当前工作区。</text></box>}
              </box>
            </scrollbox>}
        </WorkbenchPanel>

        <WorkbenchPanel title="布局检查器" description={viewMode === "lane" ? "聚焦、独占、折叠、移动和宽度" : "移动、缩放或打开选中节点"} width="24%">
          {viewMode === "lane" ? <TerminalLaneInspector
            lane={activeLane}
            state={laneState}
            onAddLane={() => void addLane()}
            onMove={(edge) => void moveActiveLane(edge)}
            onResize={(delta) => void patchActiveLane({ widthRatio: (activeLane?.widthRatio ?? 1) + delta })}
            onToggleCollapse={() => void patchActiveLane({ collapsed: !activeLane?.collapsed })}
            onToggleSolo={() => setCurrentLaneState(toggleTerminalSwimlaneSolo)}
            onAutoFitChange={(autoFitToViewport) => setCurrentLaneState((state) => ({ ...state, autoFitToViewport }))}
            onDockChange={(navigatorDock) => setCurrentLaneState((state) => ({ ...state, navigatorDock }))}
            onToggleNavigator={() => setCurrentLaneState((state) => ({ ...state, navigatorVisible: !state.navigatorVisible }))}
            onResetNavigator={() => setCurrentLaneState(resetTerminalSwimlaneNavigator)}
          /> : selected ? <Inspector component={selected} onPatch={(patch) => void mutate(patchNodeLayout(snapshot, selected.id, patch))} onOpen={() => onOpenNode(selected.moduleId)} onRemove={() => void mutate(removeNode(snapshot, selected.id), undefined)} /> : <text fg={theme.colors.mutedForeground}>选择中间的节点卡片后，可在这里编辑布局。</text>}
        </WorkbenchPanel>
      </box>
      <box height={2} flexShrink={0} flexDirection="row" justifyContent="space-between"><text fg={theme.colors.mutedForeground}>Enter 打开 · Delete 删除 · F6 布局 · F9 任务队列</text><ClickTarget id="exit" onClick={onExit}>× 退出</ClickTarget></box>
    </box>
  )
}

function TerminalLaneWorkspace({ lanes, state, selectedId, onSelectLane, onSelectComponent }: { lanes: TerminalSwimlaneProjection[]; state: TerminalSwimlaneState; selectedId?: string; onSelectLane: (laneId: string) => void; onSelectComponent: (componentId: string) => void }) {
  const navigator = state.navigatorVisible && state.laneOrder.length ? <ActionTabs
    id="lane-navigator"
    options={state.laneOrder.map((id) => ({ value: id, label: lanes.find((lane) => lane.id === id)?.label ?? id }))}
    value={state.activeLaneId}
    focused={false}
    onFocus={() => undefined}
    onChange={(value) => onSelectLane(String(value))}
  /> : null
  const board = <scrollbox flexGrow={1} horizontalScrollbarOptions={{ visible: true }}>
    <box flexDirection="row" gap={1} alignItems="stretch" minHeight={0}>
      {lanes.length ? lanes.map((lane) => <WorkbenchPanel
        key={lane.id}
        title={lane.collapsed ? "" : lane.label}
        description={lane.collapsed ? undefined : lane.solo ? "独占" : lane.active ? "已聚焦" : `${lane.components.length} 个节点`}
        width={lane.terminalWidth}
        headerActions={<ClickTarget id={`lane-focus-${lane.id}`} selected={lane.active} onClick={() => onSelectLane(lane.id)}>{lane.collapsed ? "▥" : "聚焦"}</ClickTarget>}
      >
        {lane.collapsed ? <text>▥</text> : <scrollbox flexGrow={1}>{lane.components.length ? lane.components.map((component) => <ClickTarget key={component.id} id={`lane-component-${component.id}`} selected={selectedId === component.id} onClick={() => onSelectComponent(component.id)}>{component.moduleId}</ClickTarget>) : <text>当前泳道为空</text>}</scrollbox>}
      </WorkbenchPanel>) : <box width="100%" height={8} alignItems="center" justifyContent="center"><text>还没有泳道，请从右侧检查器添加。</text></box>}
    </box>
  </scrollbox>
  if (state.navigatorDock === "left") return <box flexDirection="row" flexGrow={1} minHeight={0}>{navigator ? <box width={18} flexShrink={0}>{navigator}</box> : null}{board}</box>
  if (state.navigatorDock === "right") return <box flexDirection="row" flexGrow={1} minHeight={0}>{board}{navigator ? <box width={18} flexShrink={0}>{navigator}</box> : null}</box>
  return <box flexDirection="column" flexGrow={1} minHeight={0}>{state.navigatorDock === "top" ? navigator : null}{board}{state.navigatorDock === "bottom" || state.navigatorDock === "floating" ? navigator : null}</box>
}

function TerminalLaneInspector({ lane, state, onAddLane, onMove, onResize, onToggleCollapse, onToggleSolo, onAutoFitChange, onDockChange, onToggleNavigator, onResetNavigator }: {
  lane?: WorkspaceSnapshotDTO["lanes"][number]
  state: TerminalSwimlaneState
  onAddLane: () => void
  onMove: (edge: "left" | "right") => void
  onResize: (delta: number) => void
  onToggleCollapse: () => void
  onToggleSolo: () => void
  onAutoFitChange: (enabled: boolean) => void
  onDockChange: (dock: TerminalSwimlaneState["navigatorDock"]) => void
  onToggleNavigator: () => void
  onResetNavigator: () => void
}) {
  return <scrollbox flexGrow={1}>
    <box flexDirection="column" gap={1}>
      <WorkbenchButton id="lane-add" onClick={onAddLane}>＋ 添加泳道</WorkbenchButton>
      {lane ? <>
        <text><b>{lane.label}</b></text>
        <box flexDirection="row"><WorkbenchButton id="lane-previous" onClick={() => onMove("left")}>← 左移</WorkbenchButton><WorkbenchButton id="lane-next" onClick={() => onMove("right")}>右移 →</WorkbenchButton></box>
        <box flexDirection="row"><WorkbenchButton id="lane-width-minus" onClick={() => onResize(-0.25)}>宽 −</WorkbenchButton><WorkbenchButton id="lane-width-plus" onClick={() => onResize(0.25)}>宽 ＋</WorkbenchButton></box>
        <WorkbenchButton id="lane-collapse" selected={lane.collapsed} onClick={onToggleCollapse}>{lane.collapsed ? "展开泳道" : "折叠泳道"}</WorkbenchButton>
        <WorkbenchButton id="lane-solo" selected={state.soloLaneId === lane.id} onClick={onToggleSolo}>{state.soloLaneId === lane.id ? "退出独占" : "独占视口"}</WorkbenchButton>
      </> : null}
      <text><b>操作栏</b></text>
      <ActionTabs id="lane-navigator-dock" options={[
        { value: "floating", label: "悬浮" },
        { value: "top", label: "上" },
        { value: "right", label: "右" },
        { value: "bottom", label: "下" },
        { value: "left", label: "左" },
      ]} value={state.navigatorDock} focused={false} onFocus={() => undefined} onChange={(value) => onDockChange(value as TerminalSwimlaneState["navigatorDock"])} />
      <WorkbenchButton id="lane-navigator-visible" selected={state.navigatorVisible} onClick={onToggleNavigator}>{state.navigatorVisible ? "隐藏操作栏" : "显示操作栏"}</WorkbenchButton>
      <WorkbenchButton id="lane-auto-fit" selected={state.autoFitToViewport} onClick={() => onAutoFitChange(!state.autoFitToViewport)}>{state.autoFitToViewport ? "常驻比例填满：开" : "常驻比例填满：关"}</WorkbenchButton>
      <WorkbenchButton id="lane-navigator-reset" onClick={onResetNavigator}>↺ 重置操作栏位置</WorkbenchButton>
    </box>
  </scrollbox>
}

function Inspector({ component, onPatch, onOpen, onRemove }: { component: WorkspaceSnapshotDTO["components"][number]; onPatch: (patch: { x?: number; y?: number; w?: number; h?: number }) => void; onOpen: () => void; onRemove: () => void }) {
  const layout = component.bentoLayout ?? { x: 0, y: 0, w: 4, h: 4 }
  return <box flexDirection="column" gap={1}><text><b>{component.moduleId}</b></text><text>{component.id}</text><text>位置</text><box flexDirection="row"><WorkbenchButton id="move-left" onClick={() => onPatch({ x: layout.x - 1 })}>← 左</WorkbenchButton><WorkbenchButton id="move-right" onClick={() => onPatch({ x: layout.x + 1 })}>右 →</WorkbenchButton></box><box flexDirection="row"><WorkbenchButton id="move-up" onClick={() => onPatch({ y: layout.y - 1 })}>↑ 上</WorkbenchButton><WorkbenchButton id="move-down" onClick={() => onPatch({ y: layout.y + 1 })}>下 ↓</WorkbenchButton></box><text>尺寸</text><box flexDirection="row"><WorkbenchButton id="width-minus" onClick={() => onPatch({ w: layout.w - 1 })}>宽 −</WorkbenchButton><WorkbenchButton id="width-plus" onClick={() => onPatch({ w: layout.w + 1 })}>宽 ＋</WorkbenchButton></box><box flexDirection="row"><WorkbenchButton id="height-minus" onClick={() => onPatch({ h: layout.h - 1 })}>高 −</WorkbenchButton><WorkbenchButton id="height-plus" onClick={() => onPatch({ h: layout.h + 1 })}>高 ＋</WorkbenchButton></box><box flexGrow={1} /><WorkbenchButton id="open-node" onClick={onOpen}>↗ 打开节点 TUI</WorkbenchButton><WorkbenchButton id="remove-node" danger onClick={onRemove}>× 删除部署</WorkbenchButton></box>
}
