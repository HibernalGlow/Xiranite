import type { ReaderShellControlPatch } from "../../adapters/reader-http-client"
import type {
  ReaderShellControlEdge,
  ReaderShellControlStore,
  ReaderShellFloatingControlState,
  ReaderShellLockMode,
} from "./ReaderShellControlStore"

export interface ReaderShellControlPort {
  store: ReaderShellControlStore
  requestOpen(edge: ReaderShellControlEdge, open: boolean): void
  setPinned(edge: ReaderShellControlEdge, pinned: boolean): void
  cycleLock(edge: ReaderShellControlEdge): void
  setLock(edge: ReaderShellControlEdge, lockMode: ReaderShellLockMode): void
  setFloating(patch: Partial<ReaderShellFloatingControlState>): void
  setTriggerSize(edge: ReaderShellControlEdge, triggerSize: number): void
  reset(): void
  persist(patch: ReaderShellControlPatch["shellControl"]): void
}
