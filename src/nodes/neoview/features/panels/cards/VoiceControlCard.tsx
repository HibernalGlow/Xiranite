/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/ai/VoiceControlCard.tsx
 * @migration-status adapted
 *
 * Browser speech recognition is host-specific. This card mirrors the legacy layout
 * and exposes local enable/listen controls when SpeechRecognition is available.
 */
import {
  AlertCircle,
  CheckCircle2,
  History,
  Mic,
  MicOff,
  Settings2,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { readerVoiceCommandAction } from "../../input/ReaderVoiceCommands"

type VoiceStatus = "idle" | "listening" | "processing" | "error"

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | undefined {
  const scope = globalThis as typeof globalThis & {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

export default function VoiceControlCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开 AI 面板后查看语音控制</ReaderCardEmptyState>
  return <VoiceControlContent {...props} />
}

function VoiceControlContent({ disabled, onInputAction }: ReaderPanelContext) {
  const Recognition = useMemo(() => getSpeechRecognitionCtor(), [])
  const supported = Boolean(Recognition)
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<VoiceStatus>("idle")
  const [lastText, setLastText] = useState("")
  const [error, setError] = useState<string>()
  const [history, setHistory] = useState<readonly { text: string; at: number }[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [recognition, setRecognition] = useState<SpeechRecognitionLike>()

  useEffect(() => () => {
    try { recognition?.stop() } catch { /* ignore */ }
  }, [recognition])

  function startListening(): void {
    if (!Recognition || !enabled || disabled) return
    const instance = new Recognition()
    instance.continuous = false
    instance.interimResults = true
    instance.lang = "zh-CN"
    instance.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join("")
        .trim()
      if (!transcript) return
      setLastText(transcript)
      const action = readerVoiceCommandAction(transcript)
      if (action) onInputAction?.(action)
      setHistory((current) => [{ text: action ? `${transcript} -> ${action}` : transcript, at: Date.now() }, ...current].slice(0, 12))
      if (!action) setError("未匹配到 Reader 语音命令")
      setStatus("idle")
    }
    instance.onerror = (event) => {
      setStatus("error")
      setError(event.error ? `语音识别错误: ${event.error}` : "语音识别失败")
    }
    instance.onend = () => {
      setStatus((current) => current === "error" ? current : "idle")
    }
    try {
      instance.start()
      setRecognition(instance)
      setStatus("listening")
      setError(undefined)
    } catch (cause) {
      setStatus("error")
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  function stopListening(): void {
    try { recognition?.stop() } catch { /* ignore */ }
    setStatus("idle")
  }

  return (
    <div className="space-y-3 text-xs" data-neoview-card="voice-control">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-xs font-medium">
          {enabled ? <Mic className="size-3.5 text-primary" /> : <MicOff className="size-3.5 text-muted-foreground" />}
          启用语音控制
        </Label>
        <Switch
          className="scale-90"
          checked={enabled}
          disabled={disabled || !supported}
          onCheckedChange={(checked) => {
            setEnabled(checked)
            if (!checked) stopListening()
          }}
        />
      </div>

      {!supported ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>当前宿主未提供 Web SpeechRecognition，语音控制不可用。请使用输入绑定完成导航。</span>
        </div>
      ) : (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          识别结果目前仅记录在本卡片历史中；与 Reader 动作字典的完整绑定仍待统一能力面接入。
        </p>
      )}

      <Separator />

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 text-[11px]"
          disabled={disabled || !supported || !enabled || status === "listening"}
          onClick={startListening}
        >
          <Mic className="size-3.5" />
          开始监听
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-[11px]"
          disabled={disabled || status !== "listening"}
          onClick={stopListening}
        >
          <MicOff className="size-3.5" />
          停止
        </Button>
      </div>

      <div className="space-y-1 rounded-md border border-border/50 bg-muted/20 p-2.5 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">状态</span>
          <span className="inline-flex items-center gap-1">
            {status === "listening" ? <Mic className="size-3 text-primary" /> : null}
            {status === "error" ? <AlertCircle className="size-3 text-destructive" /> : null}
            {status === "idle" ? <CheckCircle2 className="size-3 text-muted-foreground" /> : null}
            {statusLabel(status)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">最近识别</span>
          <span className="max-w-[60%] truncate text-right">{lastText || "—"}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 flex-1 gap-1 text-[10px]"
          disabled={disabled}
          onClick={() => setShowHistory((value) => !value)}
        >
          <History className="size-3" />
          {showHistory ? "隐藏历史" : "识别历史"}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-[10px]" disabled title="指令字典编辑尚未接入">
          <Settings2 className="size-3" />
          指令
        </Button>
      </div>

      {showHistory ? (
        <div className="max-h-28 space-y-1 overflow-auto rounded-md border border-border/50 bg-muted/15 p-2">
          {history.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">暂无识别记录</p>
          ) : history.map((entry) => (
            <div key={`${entry.at}-${entry.text}`} className="flex items-center justify-between gap-2 text-[10px]">
              <span className="truncate">{entry.text}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {new Date(entry.at).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">{error}</div> : null}
    </div>
  )
}

function statusLabel(status: VoiceStatus): string {
  switch (status) {
    case "listening":
      return "监听中"
    case "processing":
      return "处理中"
    case "error":
      return "错误"
    default:
      return "空闲"
  }
}
