import { useEffect, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { create } from "zustand"
import { createJSONStorage, devtools, persist } from "zustand/middleware"
import { useShallow } from "zustand/react/shallow"
import type { CardLayout, ComponentInstance, Lane, ViewMode, WorkspaceItem } from "@/types/workspace"
import { loadWorkspaceSnapshot as loadWorkspaceSnapshotRpc, persistWorkspaceSnapshot as persistWorkspaceSnapshotRpc } from "@/backend/workspaceRpcClient"
import type { LocalBackendConfig } from "@/backend/localBackendConfig"
import { useLocalBackendStatus } from "@/hooks/useLocalBackendStatus"
import { createWorkspaceActions } from "@/store/workspace/actions"
import { INITIAL_STATE } from "@/store/workspace/constants"
import type { WorkspaceActions, WorkspaceUiPreferences, WSState, WSStore } from "@/store/workspace/types"
import type { ComponentDTO, LaneDTO, WorkspaceDTO, WorkspaceSnapshotDTO } from "@xiranite/shared"

type WorkspaceSnapshot = WorkspaceSnapshotDTO

const WORKSPACE_SNAPSHOT_QUERY_KEY = ["workspace", "snapshot"] as const
const EMPTY_COMPONENT_DATA = {} as Record<string, unknown>
const QA_VIEW_MODES = new Set<ViewMode>(["cards", "dockview", "flow", "lane", "bento"])
const QA_CARD_LAYOUTS = new Set<CardLayout>(["grid", "stack", "split", "focus"])

function workspaceSnapshotQueryKey(config: LocalBackendConfig | undefined) {
  if (!config) return [...WORKSPACE_SNAPSHOT_QUERY_KEY, "unconfigured"] as const
  return [
    ...WORKSPACE_SNAPSHOT_QUERY_KEY,
    config.baseUrl,
    config.token ? "token:set" : "token:none",
  ] as const
}

function selectWorkspaceUiPreferences(state: WSStore): WorkspaceUiPreferences {
  return {
    theme: state.theme,
    cardLayout: state.cardLayout,
    grainEnabled: state.grainEnabled,
    vignetteDepth: state.vignetteDepth,
    grainIntensity: state.grainIntensity,
    actionGlow: state.actionGlow,
    cardElevation: state.cardElevation,
    bgMode: state.bgMode,
    bgImageUrl: state.bgImageUrl,
    bgOpacity: state.bgOpacity,
    bgBlur: state.bgBlur,
    bgCoverTopBar: state.bgCoverTopBar,
  }
}

const useWorkspaceStore = create<WSStore>()(
  devtools(
    persist(
      (set) => ({
        ...INITIAL_STATE,
        ...createWorkspaceActions(set),
      }),
      {
        name: "xiranite-workspace-ui",
        version: 1,
        storage: createJSONStorage(() => localStorage),
        partialize: selectWorkspaceUiPreferences,
      },
    ),
    { name: "xiranite-workspace" },
  ),
)

function toWorkspaceDTO(workspace: WorkspaceItem, now: number): WorkspaceDTO {
  return {
    id: workspace.id,
    label: workspace.label,
    icon: workspace.icon,
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
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const lanes = useWorkspaceStore((state) => state.lanes)
  const components = useWorkspaceStore((state) => state.components)

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

  return <>{children}</>
}

interface XiraniteQaController {
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
  deploy: (moduleId: string, mode?: ViewMode) => ReturnType<typeof summarizeWorkspaceState>
}

declare global {
  interface Window {
    __xiraniteQA?: XiraniteQaController
  }
}

function installWorkspaceQaController(): () => void {
  const controller: XiraniteQaController = {
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
    deploy: (moduleId, mode = useWorkspaceStore.getState().viewMode) => {
      assertQaViewMode(mode)
      const store = useWorkspaceStore.getState()
      store.deployComponent(moduleId, { viewMode: mode })
      store.setViewMode(mode)
      return summarizeWorkspaceState(useWorkspaceStore.getState())
    },
  }

  window.__xiraniteQA = controller
  console.info("[xiranite qa] window.__xiraniteQA ready", controller.state())

  return () => {
    if (window.__xiraniteQA === controller) delete window.__xiraniteQA
  }
}

function summarizeWorkspaceState(store: WSStore) {
  return {
    viewMode: store.viewMode,
    cardLayout: store.cardLayout,
    activeWorkspaceId: store.activeWorkspaceId,
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
      hiddenIn: component.hiddenIn,
      flowSize: component.flowSize,
      bentoLayout: component.bentoLayout,
    }))
}

function requireQaComponent(query: string): ComponentInstance {
  const component = findQaComponent(useWorkspaceStore.getState(), query)
  if (!component) throw new Error(`Xiranite QA component not found: ${query}`)
  return component
}

function findQaComponent(store: WSStore, query: string): ComponentInstance | undefined {
  const normalized = query.trim().toLowerCase()
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

function assertQaViewMode(mode: ViewMode): void {
  if (!QA_VIEW_MODES.has(mode)) throw new Error(`Invalid Xiranite view mode: ${mode}`)
}

function assertQaCardLayout(layout: CardLayout): void {
  if (!QA_CARD_LAYOUTS.has(layout)) throw new Error(`Invalid Xiranite card layout: ${layout}`)
}

export function useWorkspaceSelector<T>(selector: (state: WSState) => T): T {
  return useWorkspaceStore((store) => selector(store))
}

export function useWorkspaceShallowSelector<T>(selector: (state: WSState) => T): T {
  return useWorkspaceStore(useShallow((store) => selector(store)))
}

export function useWorkspaceVisibleComponents(): ComponentInstance[] {
  return useWorkspaceStore(useShallow((state) =>
    state.components.filter((component) => component.workspaceId === state.activeWorkspaceId),
  ))
}

export function useWorkspaceComponent(compId: string): ComponentInstance | undefined {
  return useWorkspaceStore((state) => state.components.find((component) => component.id === compId))
}

export function useWorkspaceComponentData<T extends object>(compId: string): T {
  return useWorkspaceStore((state) =>
    (state.components.find((component) => component.id === compId)?.data ?? EMPTY_COMPONENT_DATA) as T,
  )
}

export function getWorkspaceState(): WSState {
  return selectWorkspaceState(useWorkspaceStore.getState())
}

export function useWorkspaceActions(): WorkspaceActions {
  return useWorkspaceStore(useShallow(selectWorkspaceActions))
}

function selectWorkspaceState(store: WSStore): WSState {
  return {
    theme: store.theme,
    viewMode: store.viewMode,
    cardLayout: store.cardLayout,
    workspaces: store.workspaces,
    activeWorkspaceId: store.activeWorkspaceId,
    components: store.components,
    lanes: store.lanes,
    focusedComponentId: store.focusedComponentId,
    fullscreenComponentId: store.fullscreenComponentId,
    zCounter: store.zCounter,
    overlay: store.overlay,
    grainEnabled: store.grainEnabled,
    vignetteDepth: store.vignetteDepth,
    grainIntensity: store.grainIntensity,
    actionGlow: store.actionGlow,
    cardElevation: store.cardElevation,
    backendReady: store.backendReady,
    bgMode: store.bgMode,
    bgImageUrl: store.bgImageUrl,
    bgOpacity: store.bgOpacity,
    bgBlur: store.bgBlur,
    bgCoverTopBar: store.bgCoverTopBar,
  }
}

function selectWorkspaceActions(store: WSStore): WorkspaceActions {
  return {
    setTheme: store.setTheme,
    setViewMode: store.setViewMode,
    setCardLayout: store.setCardLayout,
    setActiveWorkspace: store.setActiveWorkspace,
    addWorkspace: store.addWorkspace,
    removeWorkspace: store.removeWorkspace,
    renameWorkspace: store.renameWorkspace,
    setWorkspaceIcon: store.setWorkspaceIcon,
    deployComponent: store.deployComponent,
    ensureComponent: store.ensureComponent,
    removeComponent: store.removeComponent,
    setComponentState: store.setComponentState,
    setComponentPosition: store.setComponentPosition,
    moveComponent: store.moveComponent,
    setComponentFlowPos: store.setComponentFlowPos,
    setComponentFlowSize: store.setComponentFlowSize,
    setComponentBentoLayout: store.setComponentBentoLayout,
    setComponentData: store.setComponentData,
    patchComponentData: store.patchComponentData,
    updateComponent: store.updateComponent,
    setComponentDockPanel: store.setComponentDockPanel,
    setComponentVisibility: store.setComponentVisibility,
    toggleComponentVisibility: store.toggleComponentVisibility,
    setComponentTags: store.setComponentTags,
    focusComponent: store.focusComponent,
    setFullscreen: store.setFullscreen,
    raiseComponent: store.raiseComponent,
    toggleCollapse: store.toggleCollapse,
    setOverlay: store.setOverlay,
    setGrain: store.setGrain,
    setVignette: store.setVignette,
    setGrainIntensity: store.setGrainIntensity,
    setActionGlow: store.setActionGlow,
    setCardElevation: store.setCardElevation,
    setBgMode: store.setBgMode,
    setBgImageUrl: store.setBgImageUrl,
    setBgOpacity: store.setBgOpacity,
    setBgBlur: store.setBgBlur,
    setBgCoverTopBar: store.setBgCoverTopBar,
    addLane: store.addLane,
    removeLane: store.removeLane,
    renameLane: store.renameLane,
    setLaneWidthRatio: store.setLaneWidthRatio,
    toggleLaneCollapse: store.toggleLaneCollapse,
    toggleLaneVisibility: store.toggleLaneVisibility,
    reorderLane: store.reorderLane,
    setLaneCardOrder: store.setLaneCardOrder,
    moveComponentToLane: store.moveComponentToLane,
    setBackendReady: store.setBackendReady,
    hydrate: store.hydrate,
  }
}
