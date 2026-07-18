import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  RuntimeHistoryClearQueryDTO,
  RuntimeHistoryItemDTO,
  RuntimeHistoryQueryDTO,
} from "@xiranite/shared"
import {
  clearRuntimeHistory,
  deleteRuntimeHistory,
  getRuntimeHistory,
  listRuntimeHistory,
} from "@/backend/runtimeHistoryClient"

export const runtimeHistoryQueryKey = ["runtime-history"] as const

function listQueryKey(query: RuntimeHistoryQueryDTO): readonly unknown[] {
  return [
    ...runtimeHistoryQueryKey,
    "list",
    query.kind ?? "all",
    query.operation ?? "all",
    query.nodeId ?? "all",
    query.componentId ?? "all",
    query.workspaceId ?? "all",
    query.status ?? "all",
    query.limit ?? 50,
    query.cursor ?? "",
  ]
}

function itemQueryKey(id: string | undefined): readonly unknown[] {
  return [...runtimeHistoryQueryKey, "item", id ?? ""]
}

export function useRuntimeHistory(query: RuntimeHistoryQueryDTO, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: listQueryKey(query),
    queryFn: () => listRuntimeHistory(query),
    enabled: options?.enabled ?? true,
    placeholderData: (previous) => previous,
    staleTime: 5_000,
  })
}

export function useRuntimeHistoryItem(id: string | undefined) {
  return useQuery({
    queryKey: itemQueryKey(id),
    queryFn: () => getRuntimeHistory(id!),
    enabled: Boolean(id),
    staleTime: 15_000,
  })
}

export function useDeleteRuntimeHistory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteRuntimeHistory(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: runtimeHistoryQueryKey })
    },
  })
}

export function useClearRuntimeHistory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (query: RuntimeHistoryClearQueryDTO) => clearRuntimeHistory(query),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: runtimeHistoryQueryKey })
    },
  })
}

export function prefetchRuntimeHistoryItem(
  queryClient: ReturnType<typeof useQueryClient>,
  item: RuntimeHistoryItemDTO,
) {
  queryClient.setQueryData(itemQueryKey(item.id), item)
}
