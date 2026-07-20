/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/ai/AiTitleTranslationCard.tsx
 * @migration-status adapted
 */
import { Languages } from "lucide-react"
import { useEffect, useState } from "react"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

import type { ReaderAiTranslationConfigDto } from "../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { DEFAULT_AI_TRANSLATION_CONFIG, mergeAiTranslationConfig } from "./ai/ai-translation-defaults"

export default function AiTitleTranslationCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开 AI 面板后管理标题翻译</ReaderCardEmptyState>
  return <AiTitleTranslationContent {...props} />
}

function AiTitleTranslationContent({ client, disabled }: ReaderPanelContext) {
  const [config, setConfig] = useState<ReaderAiTranslationConfigDto>(DEFAULT_AI_TRANSLATION_CONFIG)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void client.config(controller.signal).then((runtime) => {
      if (!controller.signal.aborted) setConfig(mergeAiTranslationConfig(runtime.aiTranslation))
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => controller.abort()
  }, [client])

  async function patch(next: Partial<ReaderAiTranslationConfigDto>): Promise<void> {
    if (!client.updateAiTranslation) {
      setError("当前 Reader 后端不支持 AI 翻译配置写入。")
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const updated = await client.updateAiTranslation({ aiTranslation: next })
      setConfig(mergeAiTranslationConfig(updated))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 text-xs" data-neoview-card="ai-title-translation">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Languages className="size-4 text-muted-foreground" />
          <Label>启用 AI 标题翻译</Label>
        </div>
        <Switch
          checked={config.enabled}
          disabled={disabled || busy}
          onCheckedChange={(checked) => void patch({ enabled: checked, service: checked && config.service === "disabled" ? "ollama" : config.service })}
        />
      </div>

      {config.enabled ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm">自动翻译无 EMM 翻译的标题</Label>
            <Switch
              checked={config.autoTranslate}
              disabled={disabled || busy}
              onCheckedChange={(checked) => void patch({ autoTranslate: checked })}
            />
          </div>
          <div className="rounded-md border bg-muted/30 p-3 space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">当前服务</span><span>{config.service === "ollama" ? `Ollama (${config.ollamaModel || "未选模型"})` : "未配置"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">语言</span><span className="tabular-nums">{config.sourceLanguage} → {config.targetLanguage}</span></div>
          </div>
          {config.service === "disabled" ? (
            <p className="text-amber-600 dark:text-amber-400">请在“翻译服务配置”中启用 Ollama。</p>
          ) : null}
        </>
      ) : null}

      {error ? <div role="alert" className="text-destructive">{error}</div> : null}
    </div>
  )
}
