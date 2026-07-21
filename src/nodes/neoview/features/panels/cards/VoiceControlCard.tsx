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
  Save,
  Settings2,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { readerVoiceCommandAction } from "../../input/ReaderVoiceCommands"
import { READER_INPUT_ACTION_LABELS, READER_INPUT_ACTIONS, type ReaderInputAction } from "@xiranite/node-neoview/ui-core"

type VoiceStatus = "idle" | "listening" | "processing" | "error"

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string; confidence?: number }>> }) => void) | null
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

function VoiceControlContent({ disabled, onInputAction, voiceControl, onVoiceControl }: ReaderPanelContext) {
  const Recognition = useMemo(() => getSpeechRecognitionCtor(), [])
  const supported = Boolean(Recognition)
  const enabled = voiceControl?.enabled ?? false
  const [status, setStatus] = useState<VoiceStatus>("idle")
  const [lastText, setLastText] = useState("")
  const [error, setError] = useState<string>()
  const [history, setHistory] = useState<readonly { text: string; at: number }[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showCommandEditor, setShowCommandEditor] = useState(false)
  const [editingAction, setEditingAction] = useState<ReaderInputAction>("reader.next-page")
  const [editingPhrases, setEditingPhrases] = useState("")
  const [recognition, setRecognition] = useState<SpeechRecognitionLike>()

  useEffect(() => {
    setEditingPhrases((voiceControl?.commands[editingAction] ?? []).join(", "))
  }, [editingAction, voiceControl?.commands])

  useEffect(() => () => {
    try { recognition?.stop() } catch { /* ignore */ }
  }, [recognition])

  useEffect(() => {
    if (!enabled || disabled) {
      try { recognition?.stop() } catch { /* ignore */ }
      setStatus("idle")
    }
  }, [disabled, enabled, recognition])

  function startListening(): void {
    if (!Recognition || !enabled || disabled) return
    const instance = new Recognition()
    instance.continuous = voiceControl?.continuous ?? false
    instance.interimResults = true
    instance.lang = voiceControl?.language ?? "zh-CN"
    instance.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join("")
        .trim()
      if (!transcript) return
      setLastText(transcript)
      const confidence = event.results[event.results.length - 1]?.[0]?.confidence
      if (confidence !== undefined && confidence < (voiceControl?.minConfidence ?? 0.6)) {
        setError("识别置信度不足")
        setStatus("idle")
        return
      }
      const action = readerVoiceCommandAction(transcript, voiceControl?.commands)
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

  function persistVoicePatch(patch: NonNullable<ReaderPanelContext["onVoiceControl"]> extends (patch: infer T) => unknown ? T : never): void {
    if (!onVoiceControl) return
    void onVoiceControl(patch).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }

  function saveCommandPhrases(): void {
    const phrases = [...new Set(editingPhrases.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean))]
    if (!phrases.length) { setError("至少需要一条语音指令"); return }
    persistVoicePatch({ commands: { ...voiceControl?.commands, [editingAction]: phrases } })
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
          disabled={disabled || !supported || !onVoiceControl}
          onCheckedChange={(checked) => {
            persistVoicePatch({ enabled: checked })
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
          识别到的指令会按已配置词典派发到 Reader 输入动作；监听只在本卡片激活时运行。
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

      {enabled ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-2">
          <Label className="text-[11px]">持续监听</Label>
          <Switch className="scale-90" checked={voiceControl?.continuous ?? false} disabled={disabled || !onVoiceControl} onCheckedChange={(continuous) => persistVoicePatch({ continuous })} />
        </div>
      ) : null}

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

      <div className="grid grid-cols-3 gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-[10px]"
          disabled={disabled}
          onClick={() => setShowHistory((value) => !value)}
        >
          <History className="size-3" />
          {showHistory ? "隐藏历史" : "识别历史"}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-[10px]" disabled={disabled || !onVoiceControl} onClick={() => setShowCommandEditor((value) => !value)}>
          <Settings2 className="size-3" />
          指令
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-[10px]" disabled={disabled || !onVoiceControl} onClick={() => setShowSettings((value) => !value)}><Settings2 className="size-3" /> 设置</Button>
      </div>

      {showSettings ? (
        <div className="space-y-2 rounded-md border border-border/50 bg-muted/15 p-2.5">
          <label className="flex items-center justify-between gap-2 text-[11px]">语言
            <select aria-label="语音识别语言" className="h-7 max-w-28 rounded border bg-background px-1 text-[11px]" value={voiceControl?.language ?? "zh-CN"} disabled={disabled || !onVoiceControl} onChange={(event) => persistVoicePatch({ language: event.currentTarget.value })}>
              <option value="zh-CN">中文</option><option value="ja-JP">日本语</option><option value="en-US">English</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[11px]">最低置信度
            <Input aria-label="最低识别置信度" className="h-7 flex-1" type="range" min="0" max="1" step="0.1" value={voiceControl?.minConfidence ?? 0.6} disabled={disabled || !onVoiceControl} onChange={(event) => persistVoicePatch({ minConfidence: Number(event.currentTarget.value) })} />
            <span className="w-8 text-right tabular-nums">{Math.round((voiceControl?.minConfidence ?? 0.6) * 100)}%</span>
          </label>
        </div>
      ) : null}

      {showCommandEditor ? (
        <div className="space-y-2 rounded-md border border-border/50 bg-muted/15 p-2.5">
          <select aria-label="语音动作" className="h-7 w-full rounded border bg-background px-1 text-[11px]" value={editingAction} onChange={(event) => setEditingAction(event.currentTarget.value as ReaderInputAction)}>
            {READER_INPUT_ACTIONS.map((action) => <option key={action} value={action}>{READER_INPUT_ACTION_LABELS[action]}</option>)}
          </select>
          <textarea aria-label="语音指令" className="min-h-16 w-full rounded border bg-background p-2 text-[11px]" value={editingPhrases} onChange={(event) => setEditingPhrases(event.currentTarget.value)} placeholder="用逗号分隔语音指令" />
          <Button type="button" size="sm" className="h-7 w-full gap-1 text-[10px]" disabled={disabled || !onVoiceControl} onClick={saveCommandPhrases}><Save className="size-3" /> 保存指令</Button>
        </div>
      ) : null}

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
