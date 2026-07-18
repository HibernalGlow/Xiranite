import { useQuery } from "@tanstack/react-query"
import { getBackend } from "@/backend/client"
import type { Backend } from "@/backend/client"

/**
 * 等待 backend runtime 初始化完成，并返回同一个 Backend 实例。
 * 生命周期、缓存和错误状态交给 TanStack Query 管理。
 */
export function useBackend() {
  const query = useQuery<Backend, Error>({
    queryKey: ["backend"],
    queryFn: getBackend,
    staleTime: Infinity,
    retry: false,
  })

  return {
    backend: query.data ?? null,
    error: query.error,
    ready: query.isSuccess,
  }
}
