/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/ai/AiServiceConfigCard.tsx
 * @migration-status adapted
 */
import {
  Ban,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react"
import { useCallback, useEffect, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

import type {
  ReaderAiTranslationConfigDto,
  ReaderOllamaModelDto,
} from "../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { DEFAULT_AI_TRANSLATION_CONFIG, mergeAiTranslationConfig } from "./ai/ai-translation-defaults"

type ServiceChoice = ReaderAiTranslationConfigDto["service"]

export default function AiServiceConfigCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开 AI 面板后配置翻译服务</ReaderCardEmptyState>
  return <AiServiceConfigContent {...props} />
}

function AiServiceConfigContent({ client, disabled }: ReaderPanelContext) {
  const [config, setConfig] = useState<ReaderAiTranslationConfigDto>(DEFAULT_AI_TRANSLATION_CONFIG)
  const [draft, setDraft] = useState<ReaderAiTranslationConfigDto>(DEFAULT_AI_TRANSLATION_CONFIG)
  const [models, setModels] = useState<readonly ReaderOllamaModelDto[]>([])
  const [online, setOnline] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void client.config(controller.signal).then((runtime) => {
      if (controller.signal.aborted) return
      const next = mergeAiTranslationConfig(runtime.aiTranslation)
      setConfig(next)
      setDraft(next)
      setError(undefined)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [client])

  async function persist(patch: Partial<ReaderAiTranslationConfigDto>): Promise<ReaderAiTranslationConfigDto> {
    if (!client.updateAiTranslation) throw new Error("当前 Reader 后端不支持 AI 翻译配置写入。")
    const updated = await client.updateAiTranslation({ aiTranslation: patch })
    const next = mergeAiTranslationConfig(updated)
    setConfig(next)
    setDraft(next)
    return next
  }

  const probeOllama = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (!client.aiCheck || !client.aiModels) {
      if (!signal?.aborted) setError("当前 Reader 后端不支持 Ollama 探测。")
      return
    }
    setChecking(true)
    try {
      const status = await client.aiCheck(signal)
      if (signal?.aborted) return
      setOnline(status.online)
      if (!status.online) {
        setModels([])
        return
      }
      const listed = await client.aiModels(signal)
      if (!signal?.aborted) setModels(listed)
    } catch (cause) {
      if (!signal?.aborted) {
        setOnline(false)
        setModels([])
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (!signal?.aborted) setChecking(false)
    }
  }, [client])

  useEffect(() => {
    if (loading || draft.service !== "ollama") return
    const controller = new AbortController()
    void probeOllama(controller.signal)
    return () => controller.abort()
  }, [draft.service, loading, probeOllama])

  async function selectService(service: ServiceChoice): Promise<void> {
    if (disabled || busy || service === draft.service) return
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      await persist({
        service,
        enabled: service === "disabled" ? false : true,
      })
      setOnline(service === "ollama" ? null : false)
      if (service !== "ollama") setModels([])
      setMessage(service === "ollama" ? "已切换到 Ollama" : "已禁用翻译服务")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function saveEndpoint(): Promise<void> {
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      await persist({
        service: draft.service,
        ollamaUrl: draft.ollamaUrl,
        ollamaModel: draft.ollamaModel,
        sourceLanguage: draft.sourceLanguage,
        targetLanguage: draft.targetLanguage,
        promptTemplate: draft.promptTemplate,
        memoryCacheEntries: draft.memoryCacheEntries,
        enabled: draft.service !== "disabled",
      })
      setMessage("已保存")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function checkAndList(): Promise<void> {
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      if (JSON.stringify(draft) !== JSON.stringify(config)) {
        await persist({
          service: "ollama",
          ollamaUrl: draft.ollamaUrl,
          ollamaModel: draft.ollamaModel,
          sourceLanguage: draft.sourceLanguage,
          targetLanguage: draft.targetLanguage,
          promptTemplate: draft.promptTemplate,
          memoryCacheEntries: draft.memoryCacheEntries,
          enabled: true,
        })
      }
      await probeOllama()
      setMessage("已刷新 Ollama 状态和模型列表")
    } catch (cause) {
      setOnline(false)
      setModels([])
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="h-28 animate-pulse rounded-md bg-muted/40" role="status" aria-label="正在加载 AI 服务配置" />
  }

  const ollama = draft.service === "ollama"

  return (
    <div className="space-y-3 text-xs" data-neoview-card="ai-service-config">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Server className="size-3.5 text-muted-foreground" />
          翻译服务
        </div>
      {checking ? (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" role="status">
          <Loader2 className="size-3 animate-spin" />
          检测中
        </span>
      ) : online == null ? null : (
          <span className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
            online ? "bg-emerald-500/15 text-emerald-500" : "bg-destructive/15 text-destructive",
          )}>
            {online ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
            {online ? "在线" : "离线"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-muted/25 p-1" role="radiogroup" aria-label="翻译服务类型">
        <ServicePill
          active={draft.service === "disabled"}
          disabled={disabled || busy}
          icon={<Ban className="size-3" />}
          label="禁用"
          onClick={() => void selectService("disabled")}
        />
        <ServicePill
          active={false}
          disabled
          icon={<ExternalLink className="size-3" />}
          label="LibreTranslate"
          title="LibreTranslate 尚未接入统一控制面"
        />
        <ServicePill
          active={ollama}
          disabled={disabled || busy}
          icon={<Server className="size-3" />}
          label="Ollama"
          onClick={() => void selectService("ollama")}
        />
      </div>

      {ollama ? (
        <div className="space-y-2.5 rounded-md border border-border/50 bg-muted/15 p-2.5">
          <div className="grid gap-1.5">
            <Label htmlFor="ai-ollama-url" className="text-[10px] text-muted-foreground">Ollama URL</Label>
            <Input
              id="ai-ollama-url"
              className="h-8 text-xs"
              value={draft.ollamaUrl}
              disabled={disabled || busy}
              onChange={(event) => setDraft((current) => ({ ...current, ollamaUrl: event.currentTarget.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ai-ollama-model" className="text-[10px] text-muted-foreground">模型</Label>
            {models.length ? (
              <select
                id="ai-ollama-model"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={draft.ollamaModel}
                disabled={disabled || busy}
                onChange={(event) => setDraft((current) => ({ ...current, ollamaModel: event.currentTarget.value }))}
              >
                <option value="">选择模型</option>
                {models.map((model) => (
                  <option key={model.name} value={model.name}>{model.name}</option>
                ))}
              </select>
            ) : (
              <Input
                id="ai-ollama-model"
                className="h-8 text-xs"
                value={draft.ollamaModel}
                disabled={disabled || busy}
                placeholder="例如 qwen2.5:7b"
                onChange={(event) => setDraft((current) => ({ ...current, ollamaModel: event.currentTarget.value }))}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ai-source-lang" className="text-[10px] text-muted-foreground">源语言</Label>
              <Input
                id="ai-source-lang"
                className="h-8 text-xs"
                value={draft.sourceLanguage}
                disabled={disabled || busy}
                onChange={(event) => setDraft((current) => ({ ...current, sourceLanguage: event.currentTarget.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-target-lang" className="text-[10px] text-muted-foreground">目标语言</Label>
              <Input
                id="ai-target-lang"
                className="h-8 text-xs"
                value={draft.targetLanguage}
                disabled={disabled || busy}
                onChange={(event) => setDraft((current) => ({ ...current, targetLanguage: event.currentTarget.value }))}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ai-prompt" className="text-[10px] text-muted-foreground">提示词模板</Label>
            <textarea
              id="ai-prompt"
              className="min-h-16 rounded-md border border-input bg-background px-2 py-1.5 text-[11px] leading-relaxed"
              value={draft.promptTemplate}
              disabled={disabled || busy}
              onChange={(event) => setDraft((current) => ({ ...current, promptTemplate: event.currentTarget.value }))}
            />
          </div>
        </div>
      ) : (
        <p className="rounded-md border border-border/50 bg-muted/15 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
          翻译服务已禁用。标题自动翻译与测试翻译将不可用；LibreTranslate 仍待接入统一控制面。
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="sm" className="h-8 gap-1.5 text-[11px]" disabled={disabled || busy || !ollama} onClick={() => void saveEndpoint()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          保存
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-[11px]" disabled={disabled || busy || checking || !ollama} onClick={() => void checkAndList()}>
          <RefreshCw className="size-3.5" />
          探测模型
        </Button>
      </div>

      {error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">{error}</div> : null}
      {message ? <div className="text-[11px] text-muted-foreground" role="status">{message}</div> : null}
    </div>
  )
}

function ServicePill({
  active,
  disabled,
  icon,
  label,
  title,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  icon: ReactNode
  label: string
  title?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1 rounded-md px-1.5 text-[10px] transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
        disabled && !active && "opacity-50",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}
