/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/ai/AiTranslationTestCard.tsx
 * @migration-status adapted
 */
import { Languages, Loader2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

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

  async function translate(): Promise<void> {
    if (!client.aiTranslate) {
      setError("当前 Reader 后端不支持 AI 翻译请求。")
      return
    }
    const text = input.trim()
    if (!text) return
    setBusy(true)
    setError(undefined)
    setOutput("")
    setCached(undefined)
    try {
      const result = await client.aiTranslate({ text })
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
      <div className="flex items-center gap-2 text-sm font-medium">
        <Languages className="size-4 text-muted-foreground" />
        翻译测试
      </div>
      <div className="grid gap-2">
        <Label htmlFor="ai-test-input">输入文本</Label>
        <textarea
          id="ai-test-input"
          className="min-h-16 rounded-md border border-border bg-background px-2 py-1"
          value={input}
          disabled={disabled || busy}
          onChange={(event) => setInput(event.currentTarget.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={disabled || busy || !input.trim()} onClick={() => void translate()}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          翻译
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => { setInput(""); setOutput(""); setError(undefined); setCached(undefined) }}>
          清空
        </Button>
      </div>
      {output ? (
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="mb-1 text-muted-foreground">结果{cached === undefined ? "" : cached ? "（缓存）" : "（新请求）"}</div>
          <div className="whitespace-pre-wrap break-words">{output}</div>
        </div>
      ) : null}
      {error ? <div role="alert" className="text-destructive">{error}</div> : null}
    </div>
  )
}
