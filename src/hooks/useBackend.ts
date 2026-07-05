import { useEffect, useRef, useState } from "react"
import { getBackend } from "@/backend/client"
import type { Backend } from "@/backend/client"

/**
 * useBackend — React hook，等 backend 就绪后返回 Backend 实例。
 * 三种 viewMode 下共用同一个 backend 实例，数据互通。
 */
export function useBackend() {
  const [backend, setBackend] = useState<Backend | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    getBackend()
      .then(b => { if (mountedRef.current) setBackend(b) })
      .catch(e => { if (mountedRef.current) setError(e) })
    return () => { mountedRef.current = false }
  }, [])

  return { backend, error, ready: backend != null }
}
