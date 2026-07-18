import { useSyncExternalStore, type ReactNode } from "react"

import {
  ReaderEdgeShell,
  type ReaderEdge,
  type ReaderEdgeInteraction,
  type ReaderEdgeSlot,
} from "./ReaderEdgeShell"
import {
  type ReaderShellControlEdgeState,
  type ReaderShellControlStore,
} from "./ReaderShellControlStore"

export type ReaderControlledEdgeSlot = Omit<ReaderEdgeSlot, "open" | "interaction" | "pinned">

export interface ReaderControlledEdgeShellProps {
  children: ReactNode
  store: ReaderShellControlStore
  edges?: Partial<Record<ReaderEdge, ReaderControlledEdgeSlot>>
  className?: string
}

export function ReaderControlledEdgeShell({
  children,
  store,
  edges = {},
  className,
}: ReaderControlledEdgeShellProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const controlledEdges: Partial<Record<ReaderEdge, ReaderEdgeSlot>> = {}
  for (const edge of Object.keys(edges) as ReaderEdge[]) {
    const slot = edges[edge]
    if (!slot) continue
    const state = snapshot.edges[edge]
    controlledEdges[edge] = {
      ...slot,
      open: state.open,
      pinned: state.pinned,
      interaction: readerEdgeInteraction(state),
    }
  }

  return (
    <ReaderEdgeShell
      edges={controlledEdges}
      className={className}
      onEdgeOpenRequest={(edge, open) => store.requestOpen(edge, open)}
    >
      {children}
    </ReaderEdgeShell>
  )
}

export function readerEdgeInteraction(state: ReaderShellControlEdgeState): ReaderEdgeInteraction {
  if (state.lockMode === "locked-hidden") return "fixed-closed"
  if (state.lockMode === "locked-open" || state.pinned) return "fixed-open"
  return "auto"
}
