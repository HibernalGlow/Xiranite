import { useEffect, useMemo, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useShallow } from "zustand/react/shallow"
import type { CardLayout, ComponentInstance, Lane, ViewMode, WorkspaceItem } from "@/types/workspace"
import { loadWorkspaceSnapshot as loadWorkspaceSnapshotRpc, persistWorkspaceSnapshot as persistWorkspaceSnapshotRpc } from "@/backend/workspaceRpcClient"
import type { LocalBackendConfig } from "@/backend/localBackendConfig"
import { useLocalBackendStatus } from "@/hooks/useLocalBackendStatus"
import { useWorkspaceStore } from "@/store/workspaceStore"
import type { WSState, WSStore } from "@/store/workspace/types"
import type { ComponentDTO, LaneDTO, WorkspaceDTO, WorkspaceSnapshotDTO } from "@xiranite/shared"

type WorkspaceSnapshot = WorkspaceSnapshotDTO

const WORKSPACE_SNAPSHOT_QUERY_KEY = ["workspace", "snapshot"] as const
const QA_VIEW_MODES = new Set<ViewMode>(["dashboard", "cards", "dockview", "flow", "lane", "bento"])
const QA_CARD_LAYOUTS = new Set<CardLayout>(["grid", "stack", "split", "focus"])

function workspaceSnapshotQueryKey(config: LocalBackendConfig | undefined) {
  if (!config) return [...WORKSPACE_SNAPSHOT_QUERY_KEY, "unconfigured"] as const
  return [
    ...WORKSPACE_SNAPSHOT_QUERY_KEY,
    config.baseUrl,
    config.token ? "token:set" : "token:none",
  ] as const
}

function toWorkspaceDTO(workspace: WorkspaceItem, now: number): WorkspaceDTO {
  return {
    id: workspace.id,
    label: workspace.label,
    icon: workspace.icon,
    flowCanvas: workspace.flowCanvas,
    createdAt: workspace.createdAt ?? now,
    updatedAt: workspace.updatedAt ?? now,
  }
}

function toLaneDTO(lane: Lane, now: number): LaneDTO {
  return {
    id: lane.id,
    label: lane.label,
    workspaceId: lane.workspaceId,
    widthRatio: lane.widthRatio,
    collapsed: lane.collapsed,
    hidden: lane.hidden,
    cardOrder: lane.cardOrder,
    createdAt: lane.createdAt ?? now,
    updatedAt: lane.updatedAt ?? now,
  }
}

function toComponentDTO(component: ComponentInstance, now: number): ComponentDTO {
  return {
    id: component.id,
    moduleId: component.moduleId,
    workspaceId: component.workspaceId,
    data: component.data,
    flowPosition: component.flowPosition,
    flowSize: component.flowSize,
    bentoLayout: component.bentoLayout,
    laneSize: component.laneSize,
    dockPanel: component.dockPanel,
    laneId: component.laneId,
    hiddenIn: component.hiddenIn,
    tags: component.tags,
    z: component.z,
    collapsed: component.collapsed,
    createdAt: component.createdAt ?? now,
    updatedAt: component.updatedAt ?? now,
  }
}

async function loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  return loadWorkspaceSnapshotRpc()
}

async function persistWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  await persistWorkspaceSnapshotRpc(snapshot)
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const localBackendStatus = useLocalBackendStatus()
  const localBackendReady = localBackendStatus.data?.status === "ready"
  const workspaceQueryKey = workspaceSnapshotQueryKey(localBackendStatus.data?.config)
  const hydrate = useWorkspaceStore((state) => state.hydrate)
  const setBackendReady = useWorkspaceStore((state) => state.setBackendReady)
  const backendReady = useWorkspaceStore((state) => state.backendReady)
  const { workspaces, lanes, components } = useWorkspaceStore(
    useShallow((state) => ({
      workspaces: state.workspaces,
      lanes: state.lanes,
      components: state.components,
    })),
  )

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    return installWorkspaceQaController()
  }, [])

  const workspaceQuery = useQuery({
    queryKey: workspaceQueryKey,
    queryFn: loadWorkspaceSnapshot,
    enabled: localBackendReady,
    staleTime: 5_000,
    retry: 1,
  })

  const { mutate: persistWorkspace } = useMutation({
    mutationFn: persistWorkspaceSnapshot,
    scope: { id: "workspace-persist" },
    onSuccess: (_result, snapshot) => {
      queryClient.setQueryData(workspaceQueryKey, snapshot)
    },
    onError: (error) => {
      console.error("[backend] persist failed:", error)
    },
  })

  useEffect(() => {
    if (!workspaceQuery.data) return

    hydrate(workspaceQuery.data.workspaces, workspaceQuery.data.lanes, workspaceQuery.data.components)
    setBackendReady(true)
  }, [hydrate, setBackendReady, workspaceQuery.data])

  useEffect(() => {
    if (backendReady && (!localBackendReady || workspaceQuery.isError || (workspaceQuery.isPending && !workspaceQuery.data))) {
      setBackendReady(false)
    }
  }, [backendReady, localBackendReady, setBackendReady, workspaceQuery.data, workspaceQuery.isError, workspaceQuery.isPending])

  useEffect(() => {
    if (!workspaceQuery.error) return

    console.error("[backend] hydrate failed:", workspaceQuery.error)
    if (backendReady) setBackendReady(false)
  }, [backendReady, setBackendReady, workspaceQuery.error])

  useEffect(() => {
    if (!backendReady || !localBackendReady) return undefined

    const timer = setTimeout(() => {
      const now = Date.now()
      persistWorkspace({
        workspaces: workspaces.map((workspace) => toWorkspaceDTO(workspace, now)),
        lanes: lanes.map((lane) => toLaneDTO(lane, now)),
        components: components.map((component) => toComponentDTO(component, now)),
      })
    }, 500)

    return () => {
      clearTimeout(timer)
    }
  }, [workspaces, lanes, components, backendReady, localBackendReady, persistWorkspace])

  return useMemo(() => <>{children}</>, [children])
}

interface XiraniteQaController {
  help: () => string[]
  state: () => ReturnType<typeof summarizeWorkspaceState>
  components: () => ReturnType<typeof summarizeWorkspaceComponents>
  find: (query: string) => ComponentInstance | undefined
  view: (mode: ViewMode) => ReturnType<typeof summarizeWorkspaceState>
  cardLayout: (layout: CardLayout) => ReturnType<typeof summarizeWorkspaceState>
  focus: (query: string) => ReturnType<typeof summarizeWorkspaceState>
  fullscreen: (query: string) => ReturnType<typeof summarizeWorkspaceState>
  dock: (query?: string) => ReturnType<typeof summarizeWorkspaceState>
  bento: (query: string, layout: Partial<{ x: number; y: number; w: number; h: number }>) => ReturnType<typeof summarizeWorkspaceState>
  flowSize: (query: string, size: Partial<{ width: number; height: number }>) => ReturnType<typeof summarizeWorkspaceState>
  show: (query: string, mode?: ViewMode) => ReturnType<typeof summarizeWorkspaceState>
  hideView: (mode: ViewMode, keepIds?: string[]) => ReturnType<typeof summarizeWorkspaceState>
  deploy: (moduleId: string, mode?: ViewMode) => ReturnType<typeof summarizeWorkspaceState>
  resize: (
    query: string,
    surfaceOrOptions?: QaSurfacePreset | QaResizeOptions,
    mode?: ViewMode,
  ) => QaCommandResult
  stage: (moduleIdOrQuery: string, options?: QaStageOptions) => QaCommandResult
}

declare global {
  interface Window {
    __xiraniteQA?: XiraniteQaController
    xqa?: XiraniteQaController
  }
}

type QaSurfacePreset = "collapsed" | "compact" | "portrait" | "regular" | "expanded" | "workspace"

interface QaResizeOptions {
  view?: ViewMode
  surface?: QaSurfacePreset
  cardLayout?: CardLayout
  collapsed?: boolean
  focus?: boolean
  fullscreen?: boolean
  flow?: Partial<{ x: number; y: number; width: number; height: number }>
  bento?: Partial<{ x: number; y: number; w: number; h: number }>
}

interface QaStageOptions extends QaResizeOptions {
  fresh?: boolean
  dockPanel?: string
  tags?: string[]
}

type QaComponentSummary = ReturnType<typeof summarizeWorkspaceComponents>[number]
type QaCommandResult = ReturnType<typeof summarizeWorkspaceState> & {
  selected?: QaComponentSummary
}

const QA_SURFACE_PRESETS: Record<QaSurfacePreset, {
  flow: { width: number; height: number }
  bento: { w: number; h: number }
  cardLayout: CardLayout
  collapsed: boolean
  focus: boolean
  fullscreen: boolean
}> = {
  collapsed: {
    flow: { width: 260, height: 120 },
    bento: { w: 3, h: 2 },
    cardLayout: "grid",
    collapsed: true,
    focus: false,
    fullscreen: false,
  },
  compact: {
    flow: { width: 360, height: 260 },
    bento: { w: 4, h: 3 },
    cardLayout: "grid",
    collapsed: false,
    focus: false,
    fullscreen: false,
  },
  portrait: {
    flow: { width: 390, height: 720 },
    bento: { w: 3, h: 10 },
    cardLayout: "grid",
    collapsed: false,
    focus: false,
    fullscreen: false,
  },
  regular: {
    flow: { width: 560, height: 420 },
    bento: { w: 6, h: 4 },
    cardLayout: "grid",
    collapsed: false,
    focus: false,
    fullscreen: false,
  },
  expanded: {
    flow: { width: 860, height: 560 },
    bento: { w: 8, h: 6 },
    cardLayout: "focus",
    collapsed: false,
    focus: true,
    fullscreen: false,
  },
  workspace: {
    flow: { width: 1120, height: 720 },
    bento: { w: 12, h: 8 },
    cardLayout: "focus",
    collapsed: false,
    focus: false,
    fullscreen: true,
  },
}

function installWorkspaceQaController(): () => void {
  const controller: XiraniteQaController = {
    help: () => [
      "window.xqa.view('dashboard' | 'cards' | 'dockview' | 'flow' | 'lane' | 'bento')",
      "window.xqa.stage('repacku', { view: 'bento', surface: 'expanded', fresh: true })",
      "window.xqa.resize('repacku', 'compact', 'flow')",
      "window.xqa.bento('repacku', { x: 0, y: 0, w: 8, h: 6 })",
      "window.xqa.flowSize('repacku', { width: 720, height: 520 })",
      "window.xqa.hideView('bento', ['comp-id-to-keep'])",
      "window.xqa.fullscreen('repacku') / window.xqa.focus('repacku')",
    ],
    state: () => summarizeWorkspaceState(useWorkspaceStore.getState()),
    components: () => summarizeWorkspaceComponents(useWorkspaceStore.getState()),
    find: (query) => findQaComponent(useWorkspaceStore.getState(), query),
    view: (mode) => {
      assertQaViewMode(mode)
      useWorkspaceStore.getState().setViewMode(mode)
      return summarizeWorkspaceState(useWorkspaceStore.getState())
    },
    cardLayout: (layout) => {
      assertQaCardLayout(layout)
      const store = useWorkspaceStore.getState()
      store.setViewMode("cards")
      store.setCardLayout(layout)
      return summarizeWorkspaceState(useWorkspaceStore.getState())
    },
    focus: (query) => {
      const component = requireQaComponent(query)
      const store = useWorkspaceStore.getState()
      store.setViewMode("cards")
      store.setCardLayout("focus")
      store.setFullscreen(null)
      store.focusComponent(component.id)
      store.setComponentVisibility(component.id, "cards", true)
      return summarizeWorkspaceState(useWorkspaceStore.getState())
    },
    fullscreen: (query) => {
      const component = requireQaComponent(query)
      const store = useWorkspaceStore.getState()
      store.setViewMode("cards")
      store.setComponentVisibility(component.id, "cards", true)
      store.setFullscreen(component.id)
      return summarizeWorkspaceState(useWorkspaceStore.getState())
    },
    dock: (query) => {
      const store = useWorkspaceStore.getState()
      if (query) {
        const component = requireQaComponent(query)
        store.setComponentState(component.id, "docked")
      }
      store.setFullscreen(null)
      store.focusComponent(null)
      return summarizeWorkspaceState(useWorkspaceStore.getState())
    },
    bento: (query, layout) => {
      const component = requireQaComponent(query)
      const current = component.bentoLayout ?? { x: 0, y: 0, w: 4, h: 4 }
      const store = useWorkspaceStore.getState()
      store.setViewMode("bento")
      store.setComponentVisibility(component.id, "bento", true)
      store.setComponentBentoLayout(component.id, { ...current, ...layout })
      return summarizeWorkspaceState(useWorkspaceStore.getState())
    },
    flowSize: (query, size) => {
      const component = requireQaComponent(query)
      const current = component.flowSize ?? { width: 384, height: 320 }
      const store = useWorkspaceStore.getState()
      store.setViewMode("flow")
      store.setComponentVisibility(component.id, "flow", true)
      store.setComponentFlowSize(component.id, size.width ?? current.width, size.height ?? current.height)
      return summarizeWorkspaceState(useWorkspaceStore.getState())
    },
    show: (query, mode) => {
      const component = requireQaComponent(query)
      const targetMode = mode ?? useWorkspaceStore.getState().viewMode
      assertQaViewMode(targetMode)
      const store = useWorkspaceStore.getState()
      store.setComponentVisibility(component.id, targetMode, true)
      store.setViewMode(targetMode)
      return summarizeWorkspaceState(useWorkspaceStore.getState())
    },
    hideView: (mode, keepIds = []) => {
      assertQaViewMode(mode)
      const store = useWorkspaceStore.getState()
      const keep = new Set(keepIds)
      for (const component of store.components) {
        if (component.workspaceId === store.activeWorkspaceId && !keep.has(component.id)) {
          store.setComponentVisibility(component.id, mode, false)
        }
      }
      store.setViewMode(mode)
      return summarizeWorkspaceState(useWorkspaceStore.getState())
    },
    deploy: (moduleId, mode = useWorkspaceStore.getState().viewMode) => {
      assertQaViewMode(mode)
      const store = useWorkspaceStore.getState()
      store.deployComponent(moduleId, { viewMode: mode })
      store.setViewMode(mode)
      return summarizeWorkspaceState(useWorkspaceStore.getState())
    },
    resize: (query, surfaceOrOptions, mode) => {
      const options = normalizeQaResizeOptions(surfaceOrOptions, mode)
      return stageQaComponent(query, { ...options, fresh: false })
    },
    stage: (moduleIdOrQuery, options = {}) => stageQaComponent(moduleIdOrQuery, options),
  }

  window.__xiraniteQA = controller
  window.xqa = controller
  console.info("[xiranite qa] window.__xiraniteQA ready", controller.state())

  return () => {
    if (window.__xiraniteQA === controller) delete window.__xiraniteQA
    if (window.xqa === controller) delete window.xqa
  }
}

function summarizeWorkspaceState(store: WSStore) {
  return {
    viewMode: store.viewMode,
    cardLayout: store.cardLayout,
    activeWorkspaceId: store.activeWorkspaceId,
    backendReady: store.backendReady,
    overlay: store.overlay,
    focusedComponentId: store.focusedComponentId,
    fullscreenComponentId: store.fullscreenComponentId,
    components: summarizeWorkspaceComponents(store),
  }
}

function summarizeWorkspaceComponents(store: WSStore) {
  return store.components
    .filter((component) => component.workspaceId === store.activeWorkspaceId)
    .map((component) => ({
      id: component.id,
      moduleId: component.moduleId,
      state: component.state,
      collapsed: component.collapsed,
      hiddenIn: component.hiddenIn,
      flowPosition: component.flowPosition,
      flowSize: component.flowSize,
      bentoLayout: component.bentoLayout,
      laneSize: component.laneSize,
      dockPanel: component.dockPanel,
      laneId: component.laneId,
    }))
}

function stageQaComponent(moduleIdOrQuery: string, options: QaStageOptions = {}): QaCommandResult {
  const targetView = options.view ?? useWorkspaceStore.getState().viewMode
  assertQaViewMode(targetView)
  if (options.cardLayout) assertQaCardLayout(options.cardLayout)
  if (options.surface) assertQaSurfacePreset(options.surface)

  let component = options.fresh
    ? deployFreshQaComponent(moduleIdOrQuery, targetView, options)
    : findQaComponent(useWorkspaceStore.getState(), moduleIdOrQuery)

  if (!component) {
    component = deployQaComponent(moduleIdOrQuery, targetView, options)
  }

  applyQaStage(component.id, targetView, options)

  const store = useWorkspaceStore.getState()
  return {
    ...summarizeWorkspaceState(store),
    selected: summarizeWorkspaceComponents(store).find((item) => item.id === component.id),
  }
}

function deployFreshQaComponent(moduleId: string, view: ViewMode, options: QaStageOptions): ComponentInstance {
  const normalized = normalizeQaQuery(moduleId)
  const store = useWorkspaceStore.getState()
  const existingIds = store.components
    .filter((component) =>
      component.workspaceId === store.activeWorkspaceId
      && (component.moduleId.toLowerCase() === normalized || component.id.toLowerCase() === normalized)
    )
    .map((component) => component.id)

  for (const id of existingIds) {
    useWorkspaceStore.getState().removeComponent(id)
  }

  return deployQaComponent(moduleId, view, options)
}

function deployQaComponent(moduleId: string, view: ViewMode, options: QaStageOptions): ComponentInstance {
  const store = useWorkspaceStore.getState()
  const beforeIds = new Set(store.components.map((component) => component.id))
  store.deployComponent(moduleId, {
    viewMode: view,
    flowPosition: options.flow && (options.flow.x !== undefined || options.flow.y !== undefined)
      ? {
        x: options.flow.x ?? 100,
        y: options.flow.y ?? 100,
      }
      : undefined,
    bentoLayout: options.bento
      ? {
        x: options.bento.x ?? 0,
        y: options.bento.y ?? 0,
        w: options.bento.w ?? QA_SURFACE_PRESETS[options.surface ?? "regular"].bento.w,
        h: options.bento.h ?? QA_SURFACE_PRESETS[options.surface ?? "regular"].bento.h,
      }
      : undefined,
    dockPanel: options.dockPanel,
    tags: options.tags,
  })

  const nextStore = useWorkspaceStore.getState()
  const created = [...nextStore.components]
    .reverse()
    .find((component) =>
      component.workspaceId === nextStore.activeWorkspaceId
      && component.moduleId === moduleId
      && !beforeIds.has(component.id)
    )

  if (!created) throw new Error(`Xiranite QA failed to deploy component: ${moduleId}`)
  return created
}

function applyQaStage(componentId: string, view: ViewMode, options: QaStageOptions): void {
  const surface = options.surface ? QA_SURFACE_PRESETS[options.surface] : undefined
  const store = useWorkspaceStore.getState()
  store.setViewMode(view)
  store.setComponentVisibility(componentId, view, true)

  if (view === "cards") {
    const cardLayout = options.cardLayout ?? surface?.cardLayout
    if (cardLayout) store.setCardLayout(cardLayout)
  }

  if (view === "dockview") {
    store.setComponentState(componentId, "docked")
    if (options.dockPanel) store.setComponentDockPanel(componentId, options.dockPanel)
  }

  if (view === "flow") {
    const current = requireQaComponent(componentId)
    const currentSize = current.flowSize ?? { width: 384, height: 320 }
    const currentPosition = current.flowPosition ?? { x: 100, y: 100 }
    const width = options.flow?.width ?? surface?.flow.width ?? currentSize.width
    const height = options.flow?.height ?? surface?.flow.height ?? currentSize.height
    const x = options.flow?.x ?? currentPosition.x
    const y = options.flow?.y ?? currentPosition.y
    store.setComponentFlowPos(componentId, x, y)
    store.setComponentFlowSize(componentId, width, height)
  }

  if (view === "bento") {
    const current = requireQaComponent(componentId)
    const currentLayout = current.bentoLayout ?? { x: 0, y: 0, w: 4, h: 4 }
    store.setComponentBentoLayout(componentId, {
      x: options.bento?.x ?? currentLayout.x,
      y: options.bento?.y ?? currentLayout.y,
      w: options.bento?.w ?? surface?.bento.w ?? currentLayout.w,
      h: options.bento?.h ?? surface?.bento.h ?? currentLayout.h,
    })
  }

  const collapsed = options.collapsed ?? surface?.collapsed
  if (collapsed !== undefined) setQaComponentCollapsed(componentId, collapsed)

  const fullscreen = options.fullscreen ?? surface?.fullscreen
  const focus = options.focus ?? surface?.focus
  if (fullscreen) {
    store.setViewMode("cards")
    store.setComponentVisibility(componentId, "cards", true)
    store.setFullscreen(componentId)
  } else if (focus) {
    store.setViewMode("cards")
    store.setComponentVisibility(componentId, "cards", true)
    store.setCardLayout(options.cardLayout ?? "focus")
    store.setFullscreen(null)
    store.focusComponent(componentId)
  } else if (fullscreen === false && useWorkspaceStore.getState().fullscreenComponentId === componentId) {
    store.setFullscreen(null)
  }
}

function setQaComponentCollapsed(componentId: string, collapsed: boolean): void {
  const component = requireQaComponent(componentId)
  if (Boolean(component.collapsed) !== collapsed) {
    useWorkspaceStore.getState().toggleCollapse(componentId)
  }
}

function normalizeQaResizeOptions(
  surfaceOrOptions?: QaSurfacePreset | QaResizeOptions,
  mode?: ViewMode,
): QaResizeOptions {
  if (!surfaceOrOptions) return mode ? { view: mode } : {}
  if (typeof surfaceOrOptions === "string") {
    assertQaSurfacePreset(surfaceOrOptions)
    return { surface: surfaceOrOptions, view: mode }
  }
  if (surfaceOrOptions.surface) assertQaSurfacePreset(surfaceOrOptions.surface)
  return mode ? { ...surfaceOrOptions, view: mode } : surfaceOrOptions
}

function requireQaComponent(query: string): ComponentInstance {
  const component = findQaComponent(useWorkspaceStore.getState(), query)
  if (!component) throw new Error(`Xiranite QA component not found: ${query}`)
  return component
}

function findQaComponent(store: WSStore, query: string): ComponentInstance | undefined {
  const normalized = normalizeQaQuery(query)
  return store.components.find((component) =>
    component.workspaceId === store.activeWorkspaceId
    && (
      component.id.toLowerCase() === normalized
      || component.moduleId.toLowerCase() === normalized
      || component.id.toLowerCase().includes(normalized)
      || component.moduleId.toLowerCase().includes(normalized)
    ),
  )
}

function normalizeQaQuery(query: string): string {
  return query.trim().toLowerCase()
}

function assertQaViewMode(mode: ViewMode): void {
  if (!QA_VIEW_MODES.has(mode)) throw new Error(`Invalid Xiranite view mode: ${mode}`)
}

function assertQaCardLayout(layout: CardLayout): void {
  if (!QA_CARD_LAYOUTS.has(layout)) throw new Error(`Invalid Xiranite card layout: ${layout}`)
}

function assertQaSurfacePreset(surface: QaSurfacePreset): void {
  if (!(surface in QA_SURFACE_PRESETS)) throw new Error(`Invalid Xiranite QA surface preset: ${surface}`)
}
