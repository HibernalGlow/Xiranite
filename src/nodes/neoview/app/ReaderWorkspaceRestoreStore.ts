import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

import type { ReaderShellConfigDto } from "../adapters/reader-http-client"
import { normalizeReaderShellSnapshot } from "./ReaderShellSnapshot"

export interface ReaderWorkspaceRestoreSnapshot {
  lastSoloLaneId: string | null
  readerViewFullscreen: boolean
  shellSnapshot: ReaderShellConfigDto | undefined
}

interface ReaderWorkspaceRestoreStore extends ReaderWorkspaceRestoreSnapshot {
  patchRestore(patch: Partial<ReaderWorkspaceRestoreSnapshot>): void
  cacheShellSnapshot(shell: ReaderShellConfigDto): void
  resetRestore(): void
}

const DEFAULT_RESTORE: ReaderWorkspaceRestoreSnapshot = {
  lastSoloLaneId: null,
  readerViewFullscreen: false,
  shellSnapshot: undefined,
}

export const useReaderWorkspaceRestoreStore = create<ReaderWorkspaceRestoreStore>()(
  persist(
    (set) => ({
      ...DEFAULT_RESTORE,
      patchRestore: (patch) => set((state) => ({
        lastSoloLaneId: patch.lastSoloLaneId === undefined
          ? state.lastSoloLaneId
          : normalizeSoloLaneId(patch.lastSoloLaneId),
        readerViewFullscreen: patch.readerViewFullscreen ?? state.readerViewFullscreen,
      })),
      cacheShellSnapshot: (shell) => set({ shellSnapshot: structuredClone(shell) }),
      resetRestore: () => set(DEFAULT_RESTORE),
    }),
    {
      name: "xiranite-neoview-reader-workspace-restore",
      version: 2,
      storage: createJSONStorage(safeLocalStorage),
      partialize: ({ lastSoloLaneId, readerViewFullscreen, shellSnapshot }) => ({ lastSoloLaneId, readerViewFullscreen, shellSnapshot }),
      migrate: (persisted) => persisted as ReaderWorkspaceRestoreSnapshot,
      merge: (persisted, current) => {
        const value = persisted as Partial<ReaderWorkspaceRestoreSnapshot> | undefined
        return {
          ...current,
          lastSoloLaneId: normalizeSoloLaneId(value?.lastSoloLaneId),
          readerViewFullscreen: value?.readerViewFullscreen === true,
          shellSnapshot: normalizeReaderShellSnapshot(value?.shellSnapshot),
        }
      },
    },
  ),
)

function normalizeSoloLaneId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

/** A disabled or full cache must never prevent the Reader from opening. */
function safeLocalStorage() {
  return {
    getItem(name: string): string | null {
      try { return localStorage.getItem(name) } catch { return null }
    },
    setItem(name: string, value: string): void {
      try { localStorage.setItem(name, value) } catch { /* cache is best-effort */ }
    },
    removeItem(name: string): void {
      try { localStorage.removeItem(name) } catch { /* cache is best-effort */ }
    },
  }
}
