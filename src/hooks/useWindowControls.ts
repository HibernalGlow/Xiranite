import { useMutation } from "@tanstack/react-query"
import { getBackend } from "@/backend/client"
import type { MainWindowAction, OpenComponentWindowInput, WindowCommandResult } from "@/backend/runtime/runtime"

export function useWindowControls() {
  const controlMainMutation = useMutation({
    mutationFn: async (action: MainWindowAction): Promise<WindowCommandResult> => {
      const backend = await getBackend()
      return backend.windows.controlMain(action)
    },
  })

  const openComponentMutation = useMutation({
    mutationFn: async (input: OpenComponentWindowInput): Promise<WindowCommandResult> => {
      const backend = await getBackend()
      return backend.windows.openComponent(input)
    },
  })

  const closeComponentMutation = useMutation({
    mutationFn: async (id: string): Promise<WindowCommandResult> => {
      const backend = await getBackend()
      return backend.windows.close(id)
    },
  })

  return {
    controlMain: controlMainMutation.mutateAsync,
    controlMainPending: controlMainMutation.isPending,
    openComponent: openComponentMutation.mutateAsync,
    openComponentPending: openComponentMutation.isPending,
    closeComponent: closeComponentMutation.mutateAsync,
    closeComponentPending: closeComponentMutation.isPending,
  }
}
