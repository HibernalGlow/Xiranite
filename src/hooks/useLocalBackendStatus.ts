import { useQuery } from "@tanstack/react-query"
import { checkLocalBackendStatus } from "@/backend/localBackendStatus"

export const LOCAL_BACKEND_STATUS_QUERY_KEY = ["local-backend", "status"] as const

export function useLocalBackendStatus() {
  return useQuery({
    queryKey: LOCAL_BACKEND_STATUS_QUERY_KEY,
    queryFn: checkLocalBackendStatus,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}
