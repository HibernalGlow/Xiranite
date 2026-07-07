import { useMutation, useQuery } from "@tanstack/react-query"
import { getBackend } from "@/backend/client"
import type { MainWindowAction, OpenComponentWindowInput, WindowCommandResult } from "@/backend/runtime/runtime"

export function useWindowControls() {
  const capabilitiesQuery = useQuery({
    queryKey: ["window-capabilities"],
    queryFn: async () => {
      const backend = await getBackend()
      return backend.windows.getCapabilities()
    },
  })

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
    capabilities: capabilitiesQuery.data,
    capabilitiesPending: capabilitiesQuery.isPending,
    controlMain: controlMainMutation.mutateAsync,
    controlMainPending: controlMainMutation.isPending,
    openComponent: openComponentMutation.mutateAsync,
    openComponentPending: openComponentMutation.isPending,
    closeComponent: closeComponentMutation.mutateAsync,
    closeComponentPending: closeComponentMutation.isPending,
  }
}
