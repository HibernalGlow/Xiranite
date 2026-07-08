import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query"
import type {
  NodeRunHistoryClearQueryDTO,
  NodeRunHistoryItemDTO,
  NodeRunHistoryQueryDTO,
} from "@xiranite/shared"
import {
  clearNodeRunHistory,
  deleteNodeRunHistory,
  getNodeRunHistory,
  listNodeRunHistory,
} from "@/backend/nodeRunHistoryClient"

const HISTORY_QUERY_KEY = ["node-run-history"] as const

function listQueryKey(query: NodeRunHistoryQueryDTO): readonly unknown[] {
  return [
    ...HISTORY_QUERY_KEY,
    "list",
    query.nodeId ?? "",
    query.componentId ?? "",
    query.workspaceId ?? "",
    query.status ?? "",
    query.limit ?? 50,
    query.cursor ?? "",
  ] as const
}

function itemQueryKey(id: string): readonly unknown[] {
  return [...HISTORY_QUERY_KEY, "item", id] as const
}

/**
 * 节点运行历史列表查询。
 *
 * 默认不启用 placeholderData，分页查询时建议传入 enabled 控制触发时机。
 * 使用 keepPreviousData 避免翻页时列表闪烁。
 */
export function useNodeRunHistory(query: NodeRunHistoryQueryDTO, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: listQueryKey(query),
    queryFn: () => listNodeRunHistory(query),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    enabled: options?.enabled ?? true,
    retry: false,
  })
}

/** 单条历史详情查询。 */
export function useNodeRunHistoryItem(id: string | undefined) {
  return useQuery({
    queryKey: id ? itemQueryKey(id) : [...HISTORY_QUERY_KEY, "item", "missing"],
    queryFn: () => getNodeRunHistory(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
    retry: false,
  })
}

/** 删除单条历史。成功后失效相关列表缓存。 */
export function useDeleteNodeRunHistory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteNodeRunHistory(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: itemQueryKey(id), exact: true })
      invalidateHistoryLists(queryClient)
    },
  })
}

/** 按节点/组件/工作区/时间清理历史。 */
export function useClearNodeRunHistory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (query: NodeRunHistoryClearQueryDTO) => clearNodeRunHistory(query),
    onSuccess: () => {
      invalidateHistoryLists(queryClient)
    },
  })
}

/** 失效所有历史列表缓存（删除/清理后调用）。 */
export function invalidateHistoryLists(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({
    queryKey: [...HISTORY_QUERY_KEY, "list"],
    refetchType: "active",
  })
}

/** 主动把一条历史写入缓存（运行结束后立即刷新场景用）。 */
export function prefetchNodeRunHistoryItem(
  queryClient: ReturnType<typeof useQueryClient>,
  item: NodeRunHistoryItemDTO,
): void {
  queryClient.setQueryData(itemQueryKey(item.id), item)
}
