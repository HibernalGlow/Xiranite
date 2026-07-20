import { useEffect, useRef } from "react"

export function useDeferredFinalCleanup(cleanup: () => void): void {
  const cleanupRef = useRef(cleanup)
  const generationRef = useRef(0)
  cleanupRef.current = cleanup

  useEffect(() => {
    const generation = ++generationRef.current
    return () => {
      queueMicrotask(() => {
        if (generationRef.current === generation) cleanupRef.current()
      })
    }
  }, [])
}
