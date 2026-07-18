export type ReaderShellControlEdge = "top" | "right" | "bottom" | "left"
export type ReaderShellLockMode = "auto" | "locked-open" | "locked-hidden"

export interface ReaderShellControlEdgeState {
  open: boolean
  pinned: boolean
  lockMode: ReaderShellLockMode
}

export interface ReaderShellFloatingControlState {
  enabled: boolean
  position: { x: number; y: number }
}

export interface ReaderShellControlSnapshot {
  edges: Record<ReaderShellControlEdge, ReaderShellControlEdgeState>
  floating: ReaderShellFloatingControlState
}

export interface ReaderShellControlHydration {
  edges?: Partial<Record<ReaderShellControlEdge, Partial<ReaderShellControlEdgeState>>>
  floating?: Partial<ReaderShellFloatingControlState>
}

export interface ReaderShellControlTouchedSnapshot {
  edges: Record<ReaderShellControlEdge, boolean>
  floating: boolean
}

export interface ReaderShellControlStore {
  getSnapshot(): ReaderShellControlSnapshot
  getTouchedSnapshot(): ReaderShellControlTouchedSnapshot
  subscribe(listener: () => void): () => void
  hydrate(value: ReaderShellControlHydration): void
  replace(snapshot: ReaderShellControlSnapshot): void
  requestOpen(edge: ReaderShellControlEdge, open: boolean): void
  setPinned(edge: ReaderShellControlEdge, pinned: boolean): void
  cycleLock(edge: ReaderShellControlEdge): void
  setLock(edge: ReaderShellControlEdge, lockMode: ReaderShellLockMode): void
  setFloating(patch: Partial<ReaderShellFloatingControlState>): void
  setPosition(position: ReaderShellFloatingControlState["position"]): void
}

const EDGE_ORDER: readonly ReaderShellControlEdge[] = ["top", "right", "bottom", "left"]

const DEFAULT_SNAPSHOT: ReaderShellControlSnapshot = {
  edges: {
    top: { open: false, pinned: false, lockMode: "auto" },
    right: { open: false, pinned: false, lockMode: "auto" },
    bottom: { open: false, pinned: false, lockMode: "auto" },
    left: { open: false, pinned: false, lockMode: "auto" },
  },
  floating: { enabled: true, position: { x: 100, y: 100 } },
}

export function createReaderShellControlStore(
  initial: ReaderShellControlHydration = {},
): ReaderShellControlStore {
  let snapshot = mergeHydration(DEFAULT_SNAPSHOT, initial)
  const touched: ReaderShellControlTouchedSnapshot = {
    edges: { top: false, right: false, bottom: false, left: false },
    floating: false,
  }
  const listeners = new Set<() => void>()

  function publish(next: ReaderShellControlSnapshot): void {
    if (next === snapshot) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  function updateEdge(
    edge: ReaderShellControlEdge,
    update: (current: ReaderShellControlEdgeState) => ReaderShellControlEdgeState,
  ): void {
    touched.edges[edge] = true
    const current = snapshot.edges[edge]
    const next = update(current)
    if (sameEdgeState(current, next)) return
    publish({ ...snapshot, edges: { ...snapshot.edges, [edge]: next } })
  }

  const store: ReaderShellControlStore = {
    getSnapshot: () => snapshot,
    getTouchedSnapshot: () => ({ edges: { ...touched.edges }, floating: touched.floating }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    hydrate(value) {
      let next = snapshot
      for (const edge of EDGE_ORDER) {
        const incoming = value.edges?.[edge]
        if (!incoming || touched.edges[edge]) continue
        const current = next.edges[edge]
        const hydrated = normalizeEdgeState({ ...current, ...incoming })
        if (!sameEdgeState(current, hydrated)) {
          next = { ...next, edges: { ...next.edges, [edge]: hydrated } }
        }
      }
      if (value.floating && !touched.floating) {
        const floating = mergeFloating(next.floating, value.floating)
        if (!sameFloatingState(next.floating, floating)) next = { ...next, floating }
      }
      publish(next)
    },
    replace(value) {
      const next = mergeHydration(DEFAULT_SNAPSHOT, value)
      if (!sameSnapshot(snapshot, next)) publish(next)
    },
    requestOpen(edge, open) {
      updateEdge(edge, (current) => {
        if (current.lockMode === "locked-open" || current.pinned) return current
        return {
          ...current,
          open,
          ...(current.lockMode === "locked-hidden" ? { lockMode: "auto" } : {}),
        }
      })
    },
    setPinned(edge, pinned) {
      updateEdge(edge, (current) => ({ ...current, pinned, open: pinned, lockMode: "auto" }))
    },
    cycleLock(edge) {
      const current = snapshot.edges[edge].lockMode
      store.setLock(edge, current === "auto" ? "locked-open" : current === "locked-open" ? "locked-hidden" : "auto")
    },
    setLock(edge, lockMode) {
      updateEdge(edge, (current) => normalizeEdgeState({ ...current, lockMode }))
    },
    setFloating(patch) {
      touched.floating = true
      const next = mergeFloating(snapshot.floating, patch)
      if (!sameFloatingState(snapshot.floating, next)) publish({ ...snapshot, floating: next })
    },
    setPosition(position) {
      store.setFloating({ position })
    },
  }

  return store
}

function mergeHydration(
  current: ReaderShellControlSnapshot,
  value: ReaderShellControlHydration,
): ReaderShellControlSnapshot {
  const edges = { ...current.edges }
  for (const edge of EDGE_ORDER) {
    const incoming = value.edges?.[edge]
    if (incoming) edges[edge] = normalizeEdgeState({ ...edges[edge], ...incoming })
  }
  return {
    edges,
    floating: value.floating ? mergeFloating(current.floating, value.floating) : current.floating,
  }
}

function normalizeEdgeState(state: ReaderShellControlEdgeState): ReaderShellControlEdgeState {
  if (state.lockMode === "locked-open") return { open: true, pinned: true, lockMode: "locked-open" }
  if (state.lockMode === "locked-hidden") return { open: false, pinned: false, lockMode: "locked-hidden" }
  if (state.pinned && !state.open) return { ...state, open: true }
  return state
}

function mergeFloating(
  current: ReaderShellFloatingControlState,
  patch: Partial<ReaderShellFloatingControlState>,
): ReaderShellFloatingControlState {
  return {
    enabled: patch.enabled ?? current.enabled,
    position: patch.position ? { ...patch.position } : current.position,
  }
}

function sameEdgeState(left: ReaderShellControlEdgeState, right: ReaderShellControlEdgeState): boolean {
  return left.open === right.open && left.pinned === right.pinned && left.lockMode === right.lockMode
}

function sameFloatingState(
  left: ReaderShellFloatingControlState,
  right: ReaderShellFloatingControlState,
): boolean {
  return left.enabled === right.enabled
    && left.position.x === right.position.x
    && left.position.y === right.position.y
}

function sameSnapshot(left: ReaderShellControlSnapshot, right: ReaderShellControlSnapshot): boolean {
  return EDGE_ORDER.every((edge) => sameEdgeState(left.edges[edge], right.edges[edge]))
    && sameFloatingState(left.floating, right.floating)
}
