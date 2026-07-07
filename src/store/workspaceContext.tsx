import { useEffect, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { create } from "zustand"
import { createJSONStorage, devtools, persist } from "zustand/middleware"
import { useShallow } from "zustand/react/shallow"
import type { ComponentInstance, Lane, WorkspaceItem } from "@/types/workspace"
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
