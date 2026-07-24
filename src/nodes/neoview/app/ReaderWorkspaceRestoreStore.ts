import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

export interface ReaderWorkspaceRestoreSnapshot {
  lastSoloLaneId: string | null
  readerViewFullscreen: boolean
}

interface ReaderWorkspaceRestoreStore extends ReaderWorkspaceRestoreSnapshot {
  patchRestore(patch: Partial<ReaderWorkspaceRestoreSnapshot>): void
  resetRestore(): void
}

const DEFAULT_RESTORE: ReaderWorkspaceRestoreSnapshot = {
  lastSoloLaneId: null,
  readerViewFullscreen: false,
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
      resetRestore: () => set(DEFAULT_RESTORE),
    }),
    {
      name: "xiranite-neoview-reader-workspace-restore",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ lastSoloLaneId, readerViewFullscreen }) => ({ lastSoloLaneId, readerViewFullscreen }),
      merge: (persisted, current) => {
        const value = persisted as Partial<ReaderWorkspaceRestoreSnapshot> | undefined
        return {
          ...current,
          lastSoloLaneId: normalizeSoloLaneId(value?.lastSoloLaneId),
          readerViewFullscreen: value?.readerViewFullscreen === true,
        }
      },
    },
  ),
)

function normalizeSoloLaneId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}
