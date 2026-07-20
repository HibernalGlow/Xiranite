/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/ai/AiTranslationTestCard.tsx
 * @migration-status adapted
 */
import { CheckCircle2, Info, Languages, Loader2, XCircle } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { AI_TEST_EXAMPLES, detectSampleLanguage } from "./ai/ai-translation-defaults"

export default function AiTranslationTestCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开 AI 面板后测试翻译</ReaderCardEmptyState>
  return <AiTranslationTestContent {...props} />
}

function AiTranslationTestContent({ client, disabled }: ReaderPanelContext) {
  const [input, setInput] = useState("こんにちは")
  const [output, setOutput] = useState("")
  const [cached, setCached] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const detected = useMemo(() => detectSampleLanguage(input), [input])
  const hasJapanese = /[぀-ヿ]/.test(input)

  async function translate(text = input): Promise<void> {
    if (!client.aiTranslate) {
      setError("当前 Reader 后端不支持 AI 翻译请求。")
      return
    }
    const value = text.trim()
    if (!value) return
    setBusy(true)
    setError(undefined)
    setOutput("")
    setCached(undefined)
    try {
      const result = await client.aiTranslate({ text: value })
      setOutput(result.text)
      setCached(result.cached)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 text-xs" data-neoview-card="ai-translation-test">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Languages className="size-3.5 text-muted-foreground" />
        翻译测试
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="ai-test-input" className="text-[10px] text-muted-foreground">输入文本</Label>
          {input.trim() ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Info className="size-3" />
              检测: {languageLabel(detected)}
              {hasJapanese ? <span className="text-amber-500">(含日文)</span> : null}
            </span>
          ) : null}
        </div>
        <textarea
          id="ai-test-input"
          className="min-h-16 w-full rounded-md border border-input bg-background px-2.5 py-2 text-[12px] leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
          placeholder="输入要翻译的文本，如：【かぐや様】四宮かぐや"
          value={input}
          disabled={disabled || busy}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault()
              void translate()
            }
          }}
        />
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 flex-1 gap-1.5 text-[11px]"
          disabled={disabled || busy || !input.trim()}
          onClick={() => void translate()}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
          {busy ? "翻译中..." : "翻译"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-[11px]"
          disabled={disabled || busy || (!input && !output && !error)}
          onClick={() => {
            setInput("")
            setOutput("")
            setError(undefined)
            setCached(undefined)
          }}
        >
          清空
        </Button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-600 dark:text-red-400" role="alert">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      ) : null}

      {output ? (
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">
            翻译结果{cached === undefined ? "" : cached ? "（缓存）" : "（新请求）"}
          </Label>
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-[12px] text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span className="break-all">{output}</span>
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label className="text-[10px] text-muted-foreground">快速测试示例</Label>
        <div className="flex flex-wrap gap-1">
          {AI_TEST_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className={cn(
                "h-6 rounded-md border border-border/70 bg-background/80 px-2 text-[10px] text-muted-foreground transition-colors",
                "hover:border-primary/40 hover:bg-primary/10 hover:text-foreground",
                disabled || busy ? "pointer-events-none opacity-50" : "",
              )}
              disabled={disabled || busy}
              onClick={() => {
                setInput(example)
                void translate(example)
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function languageLabel(value: "ja" | "zh" | "en" | "unknown"): string {
  switch (value) {
    case "ja":
      return "日语"
    case "zh":
      return "中文"
    case "en":
      return "英语"
    default:
      return "未知"
  }
}
