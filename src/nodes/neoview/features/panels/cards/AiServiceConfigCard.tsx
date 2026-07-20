/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/ai/AiServiceConfigCard.tsx
 * @migration-status adapted
 */
import { Loader2, RefreshCw, Server } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

import type {
  ReaderAiTranslationConfigDto,
  ReaderOllamaModelDto,
} from "../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { DEFAULT_AI_TRANSLATION_CONFIG, mergeAiTranslationConfig } from "./ai/ai-translation-defaults"

export default function AiServiceConfigCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开 AI 面板后配置翻译服务</ReaderCardEmptyState>
  return <AiServiceConfigContent {...props} />
}

function AiServiceConfigContent({ client, disabled }: ReaderPanelContext) {
  const [config, setConfig] = useState<ReaderAiTranslationConfigDto>(DEFAULT_AI_TRANSLATION_CONFIG)
  const [draft, setDraft] = useState<ReaderAiTranslationConfigDto>(DEFAULT_AI_TRANSLATION_CONFIG)
  const [models, setModels] = useState<readonly ReaderOllamaModelDto[]>([])
  const [online, setOnline] = useState<boolean | null>(null)
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

  async function persist(patch: Partial<ReaderAiTranslationConfigDto>): Promise<void> {
    if (!client.updateAiTranslation) throw new Error("当前 Reader 后端不支持 AI 翻译配置写入。")
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      const updated = await client.updateAiTranslation({ aiTranslation: patch })
      const next = mergeAiTranslationConfig(updated)
      setConfig(next)
      setDraft(next)
      setMessage("已保存")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function checkAndList(): Promise<void> {
    if (!client.aiCheck || !client.aiModels) {
      setError("当前 Reader 后端不支持 Ollama 探测。")
      return
    }
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      // Persist draft first so check/models hit the intended endpoint.
      if (JSON.stringify(draft) !== JSON.stringify(config)) {
        await persist({
          service: draft.service,
          ollamaUrl: draft.ollamaUrl,
          ollamaModel: draft.ollamaModel,
          sourceLanguage: draft.sourceLanguage,
          targetLanguage: draft.targetLanguage,
          promptTemplate: draft.promptTemplate,
          memoryCacheEntries: draft.memoryCacheEntries,
        })
      }
      const status = await client.aiCheck()
      setOnline(status.online)
      if (status.service === "ollama" && status.online) {
        setModels(await client.aiModels())
        setMessage("Ollama 在线")
      } else {
        setModels([])
        setMessage(status.service === "ollama" ? "Ollama 离线" : "服务未启用")
      }
    } catch (cause) {
      setOnline(false)
      setModels([])
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="h-28 animate-pulse rounded bg-muted" role="status" aria-label="正在加载 AI 服务配置" />
  }

  return (
    <div className="space-y-3 text-xs" data-neoview-card="ai-service-config">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Server className="size-4 text-muted-foreground" />
        翻译服务
        {online === null ? null : (
          <span className={online ? "text-emerald-500" : "text-red-500"}>{online ? "在线" : "离线"}</span>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ai-service">服务类型</Label>
        <NativeSelect
          id="ai-service"
          value={draft.service}
          disabled={disabled || busy}
          onChange={(event) => setDraft((current) => ({
            ...current,
            service: event.currentTarget.value as ReaderAiTranslationConfigDto["service"],
          }))}
        >
          <NativeSelectOption value="disabled">禁用</NativeSelectOption>
          <NativeSelectOption value="ollama">Ollama</NativeSelectOption>
        </NativeSelect>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ai-ollama-url">Ollama URL</Label>
        <Input
          id="ai-ollama-url"
          value={draft.ollamaUrl}
          disabled={disabled || busy || draft.service !== "ollama"}
          onChange={(event) => setDraft((current) => ({ ...current, ollamaUrl: event.currentTarget.value }))}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ai-ollama-model">模型</Label>
        {models.length ? (
          <NativeSelect
            id="ai-ollama-model"
            value={draft.ollamaModel}
            disabled={disabled || busy || draft.service !== "ollama"}
            onChange={(event) => setDraft((current) => ({ ...current, ollamaModel: event.currentTarget.value }))}
          >
            <NativeSelectOption value="">选择模型</NativeSelectOption>
            {models.map((model) => (
              <NativeSelectOption key={model.name} value={model.name}>{model.name}</NativeSelectOption>
            ))}
          </NativeSelect>
        ) : (
          <Input
            id="ai-ollama-model"
            value={draft.ollamaModel}
            disabled={disabled || busy || draft.service !== "ollama"}
            placeholder="例如 qwen2.5:7b"
            onChange={(event) => setDraft((current) => ({ ...current, ollamaModel: event.currentTarget.value }))}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-2">
          <Label htmlFor="ai-source-lang">源语言</Label>
          <Input
            id="ai-source-lang"
            value={draft.sourceLanguage}
            disabled={disabled || busy}
            onChange={(event) => setDraft((current) => ({ ...current, sourceLanguage: event.currentTarget.value }))}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ai-target-lang">目标语言</Label>
          <Input
            id="ai-target-lang"
            value={draft.targetLanguage}
            disabled={disabled || busy}
            onChange={(event) => setDraft((current) => ({ ...current, targetLanguage: event.currentTarget.value }))}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ai-prompt">提示词模板</Label>
        <textarea
          id="ai-prompt"
          className="min-h-20 rounded-md border border-border bg-background px-2 py-1 text-xs"
          value={draft.promptTemplate}
          disabled={disabled || busy}
          onChange={(event) => setDraft((current) => ({ ...current, promptTemplate: event.currentTarget.value }))}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled || busy}
          onClick={() => void persist({
            service: draft.service,
            ollamaUrl: draft.ollamaUrl,
            ollamaModel: draft.ollamaModel,
            sourceLanguage: draft.sourceLanguage,
            targetLanguage: draft.targetLanguage,
            promptTemplate: draft.promptTemplate,
            memoryCacheEntries: draft.memoryCacheEntries,
            enabled: draft.service !== "disabled" ? draft.enabled || config.enabled : false,
          })}
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          保存
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || busy || draft.service !== "ollama"} onClick={() => void checkAndList()}>
          <RefreshCw />
          探测并拉取模型
        </Button>
      </div>

      {error ? <div role="alert" className="text-destructive">{error}</div> : null}
      {message ? <div className="text-muted-foreground">{message}</div> : null}
    </div>
  )
}
