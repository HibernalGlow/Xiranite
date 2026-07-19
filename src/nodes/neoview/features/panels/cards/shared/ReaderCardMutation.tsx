import { RotateCcw } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"

export type ReaderCardSaveState =
  | { phase: "idle" | "saving" | "saved" }
  | { phase: "error"; message: string }

export function useReaderCardMutation() {
  const [state, setState] = useState<ReaderCardSaveState>({ phase: "idle" })
  const mountedRef = useRef(true)
  const generationRef = useRef(0)
  const retryRef = useRef<(() => Promise<void>)>()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      retryRef.current = undefined
    }
  }, [])

  const run = useCallback((operation: () => Promise<void>, retry = operation) => {
    const generation = ++generationRef.current
    retryRef.current = retry
    setState({ phase: "saving" })
    let result: Promise<void>
    try {
      result = operation()
    } catch (cause) {
      if (mountedRef.current && generation === generationRef.current) {
        setState({ phase: "error", message: cause instanceof Error ? cause.message : String(cause) })
      }
      return
    }
    void result.then(() => {
      if (!mountedRef.current || generation !== generationRef.current) return
      retryRef.current = undefined
      setState({ phase: "saved" })
    }).catch((cause) => {
      if (!mountedRef.current || generation !== generationRef.current) return
      setState({ phase: "error", message: cause instanceof Error ? cause.message : String(cause) })
    })
  }, [])

  const markEdited = useCallback((retry?: () => Promise<void>) => {
    generationRef.current += 1
    retryRef.current = retry
    setState({ phase: "idle" })
  }, [])

  const retry = useCallback(() => {
    const operation = retryRef.current
    if (operation) run(operation, operation)
  }, [run])

  return { state, run, markEdited, retry }
}

export function ReaderCardSaveFeedback({ state, disabled = false, onRetry }: {
  state: ReaderCardSaveState
  disabled?: boolean
  onRetry(): void
}) {
  if (state.phase === "saving") {
    return <p role="status" aria-live="polite" className="text-xs text-muted-foreground">正在保存...</p>
  }
  if (state.phase === "saved") {
    return <p role="status" aria-live="polite" className="text-xs text-muted-foreground">已保存</p>
  }
  if (state.phase === "error") {
    return (
      <div role="alert" className="flex items-center justify-between gap-2 border-l-2 border-destructive bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
        <span>保存失败：{state.message}</span>
        <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={disabled}>
          <RotateCcw />重试
        </Button>
      </div>
    )
  }
  return null
}
