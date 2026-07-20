/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/ai/AiTitleTranslationCard.tsx
 * @migration-status adapted
 */
import { Info, Languages } from "lucide-react"
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
    <div className="space-y-3 text-xs" data-neoview-card="ai-title-translation">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Languages className="size-3.5 text-muted-foreground" />
          <Label className="text-xs font-medium">启用 AI 标题翻译</Label>
        </div>
        <Switch
          className="scale-90"
          checked={config.enabled}
          disabled={disabled || busy}
          onCheckedChange={(checked) => void patch({
            enabled: checked,
            service: checked && config.service === "disabled" ? "ollama" : config.service,
          })}
        />
      </div>

      {config.enabled ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs">自动翻译无 EMM 翻译的标题</Label>
              <span title="当文件没有 EMM 翻译标题时，自动使用 AI 翻译日文标题">
                <Info className="size-3 text-muted-foreground" />
              </span>
            </div>
            <Switch
              className="scale-75"
              checked={config.autoTranslate}
              disabled={disabled || busy}
              onCheckedChange={(checked) => void patch({ autoTranslate: checked })}
            />
          </div>

          <div className="space-y-1 rounded-md border border-border/50 bg-muted/20 p-2.5 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">当前服务</span>
              <span className="font-medium">
                {config.service === "ollama"
                  ? `Ollama (${config.ollamaModel || "未选模型"})`
                  : "未配置"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">语言</span>
              <span className="tabular-nums">{config.sourceLanguage} → {config.targetLanguage}</span>
            </div>
          </div>

          {config.service === "disabled" ? (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              请在“翻译服务配置”中启用 Ollama。
            </p>
          ) : null}
        </>
      ) : null}

      {error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">{error}</div> : null}
    </div>
  )
}
