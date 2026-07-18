import { Ban, Eraser, Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { ReaderPreloadActionDto, ReaderPreloadActionResultDto } from "../../../adapters/reader-http-client"

export interface PreloadActionControlsProps {
  disabled: boolean
  onAction?(action: ReaderPreloadActionDto, signal?: AbortSignal): Promise<ReaderPreloadActionResultDto>
  onComplete?(): void
}

export function PreloadActionControls({
  disabled,
  onAction,
  onComplete,
}: PreloadActionControlsProps) {
  const [operation, setOperation] = useState<ReaderPreloadActionDto>()
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string }>()
  const controllerRef = useRef<AbortController>()
  const generationRef = useRef(0)

  useEffect(() => () => {
    generationRef.current += 1
    controllerRef.current?.abort()
  }, [])

  async function runAction(action: ReaderPreloadActionDto) {
    if (!onAction || operation) return
    const controller = new AbortController()
    const generation = ++generationRef.current
    controllerRef.current?.abort()
    controllerRef.current = controller
    setOperation(action)
    setFeedback(undefined)
    try {
      const result = await onAction(action, controller.signal)
      if (generation !== generationRef.current) return
      setFeedback({ tone: "success", text: preloadActionMessage(result) })
      onComplete?.()
    } catch {
      if (generation === generationRef.current && !controller.signal.aborted) {
        setFeedback({ tone: "error", text: "预加载操作失败，请重试" })
      }
    } finally {
      if (generation === generationRef.current) setOperation(undefined)
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-1.5 border-t pt-2" aria-label="当前会话预加载操作" aria-busy={operation !== undefined}>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-[10px]" disabled={disabled || !onAction || operation !== undefined} onClick={() => void runAction("cancel-speculative")}>
          {operation === "cancel-speculative" ? <Loader2 className="size-3 animate-spin" /> : <Ban className="size-3" />}
          取消预读
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-[10px]" disabled={disabled || !onAction || operation !== undefined}>
              {operation === "release-retained" ? <Loader2 className="size-3 animate-spin" /> : <Eraser className="size-3" />}
              释放缓存
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>释放当前会话缓存？</AlertDialogTitle>
              <AlertDialogDescription>仅释放当前书籍的非可见预加载缓存；当前画面、其他会话和缩略图不会受影响。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => void runAction("release-retained")}>释放</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {feedback ? (
        <p className={feedback.tone === "error" ? "rounded bg-destructive/10 p-2 text-[10px] text-destructive" : "rounded bg-emerald-500/10 p-2 text-[10px] text-emerald-700"} role={feedback.tone === "error" ? "alert" : "status"} aria-live="polite">
          {feedback.text}
        </p>
      ) : null}
    </>
  )
}

function preloadActionMessage(result: ReaderPreloadActionResultDto): string {
  if (result.action === "cancel-speculative") return `已取消 ${result.cancelled} 个预读任务`
  return `已释放 ${result.released} 个缓存项，保留 ${result.visibleRetained} 个可见页`
}
