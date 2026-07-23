import { useMemo, useState, type ReactNode } from "react"
import type { XlchemyData, XlchemyFormat } from "@xiranite/node-xlchemy/core"
import { ReactCompareSlider } from "react-compare-slider"
import { Check, ClipboardCheck, ClipboardPaste, Copy, Image as ImageIcon, LoaderCircle, RefreshCw, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type ClipboardImageData = { base64: string; mimeType: string }
export type ClipboardConversionResult = { copied?: boolean; data: XlchemyData; format: XlchemyFormat; output: ClipboardImageData; quality: number }

export function ClipboardConvertDialog(props: {
  configuration: ReactNode
  autoCopy: boolean
  disabled?: boolean
  onAutoCopyChange: (autoCopy: boolean) => void
  onRead: () => Promise<ClipboardImageData>
  onConvert: (source: ClipboardImageData) => Promise<ClipboardConversionResult>
  onCopy: (output: ClipboardImageData) => Promise<void>
  portalContainer?: HTMLElement | null
}) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<ClipboardImageData>()
  const [result, setResult] = useState<ClipboardConversionResult>()
  const [loading, setLoading] = useState(false)
  const [converting, setConverting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")
  const [previewError, setPreviewError] = useState(false)
  const sourceUrl = useMemo(() => source ? imageDataUrl(source) : "", [source])
  const outputUrl = useMemo(() => result ? imageDataUrl(result.output) : "", [result])

  async function readClipboard() {
    setLoading(true); setError(""); setResult(undefined); setCopied(false); setPreviewError(false)
    try { setSource(await props.onRead()) }
    catch (reason) { setSource(undefined); setError(errorMessage(reason)) }
    finally { setLoading(false) }
  }

  async function convert() {
    if (!source) return
    setConverting(true); setError(""); setCopied(false); setPreviewError(false)
    try {
      const nextResult = await props.onConvert(source)
      setResult(nextResult)
      setCopied(nextResult.copied ?? false)
    }
    catch (reason) { setError(errorMessage(reason)) }
    finally { setConverting(false) }
  }

  async function copyResult() {
    if (!result) return
    setError("")
    try { await props.onCopy(result.output); setCopied(true) }
    catch (reason) { setError(errorMessage(reason)) }
  }

  function changeOpen(next: boolean) {
    setOpen(next)
    if (next) void readClipboard()
  }

  const inputBytes = result?.data.inputBytes || (source ? decodedBase64Size(source.base64) : 0)
  const outputBytes = result?.data.outputBytes || (result ? decodedBase64Size(result.output.base64) : 0)
  const savedPercent = inputBytes > 0 && result ? (1 - outputBytes / inputBytes) * 100 : undefined

  return <Dialog open={open} onOpenChange={changeOpen}>
    <Tooltip><TooltipTrigger asChild><DialogTrigger asChild><Button aria-label="打开剪贴板图片工作台" disabled={props.disabled} size="icon-sm" variant="ghost"><ClipboardPaste /></Button></DialogTrigger></TooltipTrigger><TooltipContent>剪贴板图片工作台</TooltipContent></Tooltip>
    <DialogContent bare contained={Boolean(props.portalContainer)} portalContainer={props.portalContainer} className={cn("grid grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0", props.portalContainer ? "inset-2 h-auto w-auto sm:inset-3" : "h-[min(820px,calc(100dvh-2rem))] w-[min(1120px,calc(100vw-2rem))]")} data-testid="xlchemy-clipboard-workbench">
      <DialogHeader className="border-b px-5 py-3 pr-12">
        <div className="flex flex-wrap items-center gap-2"><div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground"><ClipboardPaste className="size-4" /></div><DialogTitle>剪贴板图片工作台</DialogTitle>{result ? <Badge variant="secondary">{result.format}</Badge> : null}<div className="ml-auto flex items-center gap-1"><Tooltip><TooltipTrigger asChild><Button aria-label="转换后自动写入剪贴板" aria-pressed={props.autoCopy} disabled={converting} size="icon" variant={props.autoCopy ? "default" : "outline"} onClick={() => props.onAutoCopyChange(!props.autoCopy)}><ClipboardCheck /></Button></TooltipTrigger><TooltipContent>{props.autoCopy ? "已开启自动写入剪贴板" : "自动写入剪贴板"}</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button aria-label="重新读取剪贴板图片" disabled={loading || converting} size="icon" variant="outline" onClick={() => void readClipboard()}>{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}</Button></TooltipTrigger><TooltipContent>重新读取剪贴板</TooltipContent></Tooltip><Button disabled={!source || converting || loading} onClick={() => void convert()}>{converting ? <LoaderCircle className="animate-spin" /> : <Sparkles />}{converting ? "转换中" : "转换"}</Button><Button disabled={!result || converting} variant="default" onClick={() => void copyResult()}>{copied ? <Check /> : <Copy />}{copied ? "已复制" : "复制结果"}</Button></div></div>
        <DialogDescription>读取、转换、对比并在确认后复制结果。</DialogDescription>
      </DialogHeader>

      <div className="grid min-h-0 gap-2 overflow-hidden bg-muted/20 p-2 @3xl/xlchemy:grid-cols-[minmax(17rem,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-h-0 overflow-auto pr-1" data-testid="xlchemy-clipboard-configuration">{props.configuration}</div>
        <div className="min-h-[14rem] bg-black/90 p-3 sm:p-4">
          <div className="relative grid h-full min-h-0 place-items-center overflow-hidden rounded-md border border-white/15 bg-[linear-gradient(45deg,#202020_25%,transparent_25%),linear-gradient(-45deg,#202020_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#202020_75%),linear-gradient(-45deg,transparent_75%,#202020_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0]" data-testid="xlchemy-clipboard-preview">
          {loading ? <LoaderCircle className="size-7 animate-spin text-white/70" /> : source ? <>
            {result && !previewError ? <ReactCompareSlider className="size-full" defaultPosition={50} itemOne={<ComparisonImage alt="转换后" label="转换后" src={outputUrl} onError={() => setPreviewError(true)} />} itemTwo={<ComparisonImage alt="转换前" label="转换前" src={sourceUrl} labelSide="right" />} keyboardIncrement="2%" onlyHandleDraggable={false} transition="none" /> : <img alt="转换前" className="absolute inset-0 size-full object-contain" src={sourceUrl} />}
            {result && previewError ? <div className="absolute inset-x-4 bottom-4 rounded-md border border-white/15 bg-black/80 px-3 py-2 text-center text-xs text-white/75">当前浏览器不能直接预览 {result.output.mimeType}，结果仍可复制到剪贴板。</div> : null}
          </> : <div className="flex flex-col items-center gap-3 text-white/60"><ImageIcon className="size-10" /><span className="text-sm">{error || "剪贴板中没有图片"}</span></div>}
          </div>
        </div>
      </div>

      <div className="border-t px-5 py-3">
        <div className="grid grid-cols-3 gap-2" data-testid="xlchemy-clipboard-stats"><Metric label="转换前" value={source ? `${formatBytes(inputBytes)} · ${shortMime(source.mimeType)}` : "—"} /><Metric label="转换后" value={result ? `${formatBytes(outputBytes)} · ${shortMime(result.output.mimeType)}` : "—"} /><Metric accent={savedPercent !== undefined} label={savedPercent !== undefined && savedPercent < 0 ? "体积增加" : "节省空间"} value={savedPercent === undefined ? "—" : `${Math.abs(savedPercent).toFixed(1)}%`} /></div>
        {error && source ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>
    </DialogContent>
  </Dialog>
}

function Metric({ accent, label, value }: { accent?: boolean; label: string; value: string }) { return <div className="min-w-0 border-l pl-3 first:border-l-0 first:pl-0"><div className="text-[10px] text-muted-foreground">{label}</div><div className={accent ? "truncate text-sm font-semibold tabular-nums text-primary" : "truncate text-sm font-semibold tabular-nums"}>{value}</div></div> }
function ComparisonImage({ alt, label, labelSide = "left", onError, src }: { alt: string; label: string; labelSide?: "left" | "right"; onError?: () => void; src: string }) { return <div className="relative size-full"><img alt={alt} className="size-full object-contain" draggable={false} src={src} onError={onError} /><span className={cn("pointer-events-none absolute top-3 rounded bg-black/70 px-2 py-1 text-[10px] font-medium text-white", labelSide === "left" ? "left-3" : "right-3")}>{label}</span></div> }
function imageDataUrl(image: ClipboardImageData) { return `data:${image.mimeType};base64,${image.base64}` }
function decodedBase64Size(base64: string) { const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0; return Math.max(0, Math.floor(base64.length * 3 / 4) - padding) }
function shortMime(mimeType: string) { return mimeType.replace(/^image\//, "").toUpperCase() }
function formatBytes(bytes: number) { if (!bytes) return "0 B"; const units = ["B", "KB", "MB", "GB"], index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}` }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
