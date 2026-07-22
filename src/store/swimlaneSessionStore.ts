import { create } from "zustand"
import { createJSONStorage, devtools, persist } from "zustand/middleware"

import type { SwimlaneWorkspaceSessionState } from "@xiranite/shared/swimlane"

interface SwimlaneSessionStore {
  sessions: Record<string, SwimlaneWorkspaceSessionState>
  ensureSession(scopeId: string, fallback: SwimlaneWorkspaceSessionState): void
  patchSession(scopeId: string, patch: SwimlaneWorkspaceSessionState): void
  clearSessions(): void
}

export const useSwimlaneSessionStore = create<SwimlaneSessionStore>()(
  devtools(
    persist(
      (set) => ({
        sessions: {},
        ensureSession: (scopeId, fallback) => set((state) => {
          if (state.sessions[scopeId]) return state
          return { sessions: { ...state.sessions, [scopeId]: normalizeSession(fallback) } }
        }, false, "ENSURE_SWIMLANE_SESSION"),
        patchSession: (scopeId, patch) => set((state) => ({
          sessions: {
            ...state.sessions,
            [scopeId]: normalizeSession({ ...state.sessions[scopeId], ...patch }),
          },
        }), false, "PATCH_SWIMLANE_SESSION"),
        clearSessions: () => set({ sessions: {} }, false, "CLEAR_SWIMLANE_SESSIONS"),
      }),
      {
        name: "xiranite-swimlane-session",
        version: 1,
        storage: createJSONStorage(() => sessionStorage),
        partialize: ({ sessions }) => ({ sessions }),
        merge: (persisted, current) => ({
          ...current,
          sessions: normalizeSessions((persisted as Partial<SwimlaneSessionStore> | undefined)?.sessions),
        }),
      },
    ),
    { name: "xiranite-swimlane-session" },
  ),
)

function normalizeSessions(value: unknown): Record<string, SwimlaneWorkspaceSessionState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([scopeId, session]) => {
    if (!scopeId || !session || typeof session !== "object" || Array.isArray(session)) return []
    return [[scopeId, normalizeSession(session as SwimlaneWorkspaceSessionState)]]
  }))
}

function normalizeSession(value: SwimlaneWorkspaceSessionState): SwimlaneWorkspaceSessionState {
  const activeLaneId = typeof value.activeLaneId === "string" && value.activeLaneId ? value.activeLaneId : undefined
  const soloLaneId = typeof value.soloLaneId === "string" && value.soloLaneId
    ? value.soloLaneId
    : value.soloLaneId === null
      ? null
      : undefined
  return {
    ...(activeLaneId ? { activeLaneId } : {}),
    ...(soloLaneId !== undefined ? { soloLaneId } : {}),
  }
}
