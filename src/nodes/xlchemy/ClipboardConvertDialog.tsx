import { useMemo, useState } from "react"
import type { XlchemyData, XlchemyFormat } from "@xiranite/node-xlchemy/core"
import { ArrowLeftRight, Check, ClipboardPaste, Copy, Image as ImageIcon, LoaderCircle, RefreshCw, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { XlchemyFormatField, XlchemySliderField } from "./ConversionControls"

export type ClipboardImageData = { base64: string; mimeType: string }
export type ClipboardConversionResult = { data: XlchemyData; format: XlchemyFormat; output: ClipboardImageData; quality: number }

const CLIPBOARD_FORMATS: XlchemyFormat[] = ["JPEG XL", "AVIF", "WebP", "PNG", "TIFF", "JPEG"]

export function ClipboardConvertDialog(props: {
  disabled?: boolean
  format: XlchemyFormat
  quality: number
  onChange: (patch: { clipboardFormat?: XlchemyFormat; clipboardQuality?: number }) => void
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
  const [compare, setCompare] = useState(50)
  const [error, setError] = useState("")
  const [previewError, setPreviewError] = useState(false)
  const lossless = props.format === "PNG" || props.format === "TIFF"
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
    try { setResult(await props.onConvert(source)); setCompare(50) }
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
    <DialogContent bare contained={Boolean(props.portalContainer)} portalContainer={props.portalContainer} className={cn("grid grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden p-0", props.portalContainer ? "inset-2 h-auto w-auto sm:inset-3" : "h-[min(820px,calc(100dvh-2rem))] w-[min(1120px,calc(100vw-2rem))]")} data-testid="xlchemy-clipboard-workbench">
      <DialogHeader className="border-b px-5 py-4 pr-12">
        <div className="flex items-center gap-2"><div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground"><ClipboardPaste className="size-4" /></div><DialogTitle>剪贴板图片工作台</DialogTitle>{result ? <Badge variant="secondary">{result.format}</Badge> : null}</div>
        <DialogDescription>读取、转换、对比并在确认后复制结果。</DialogDescription>
      </DialogHeader>

      <div className="grid items-end gap-3 border-b bg-muted/20 px-5 py-3 md:grid-cols-[minmax(11rem,0.7fr)_minmax(14rem,1fr)_auto]">
        <XlchemyFormatField ariaLabel="剪贴板目标格式" formats={CLIPBOARD_FORMATS} value={props.format} onChange={(clipboardFormat) => { props.onChange({ clipboardFormat }); setResult(undefined); setCopied(false) }} />
        <div className="pb-1"><XlchemySliderField disabled={lossless} displayValue={lossless ? "无损" : undefined} label="剪贴板质量" min={1} max={100} value={props.quality} onChange={(clipboardQuality) => { props.onChange({ clipboardQuality }); setResult(undefined); setCopied(false) }} /></div>
        <div className="flex items-center justify-end gap-1"><Tooltip><TooltipTrigger asChild><Button aria-label="重新读取剪贴板图片" disabled={loading || converting} size="icon" variant="outline" onClick={() => void readClipboard()}>{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}</Button></TooltipTrigger><TooltipContent>重新读取剪贴板</TooltipContent></Tooltip><Button disabled={!source || converting || loading} onClick={() => void convert()}>{converting ? <LoaderCircle className="animate-spin" /> : <Sparkles />}{converting ? "转换中" : "转换"}</Button><Button disabled={!result || converting} variant="default" onClick={() => void copyResult()}>{copied ? <Check /> : <Copy />}{copied ? "已复制" : "复制结果"}</Button></div>
      </div>

      <div className="min-h-0 bg-black/90 p-3 sm:p-5">
        <div className="relative grid h-full min-h-64 place-items-center overflow-hidden rounded-md border border-white/15 bg-[linear-gradient(45deg,#202020_25%,transparent_25%),linear-gradient(-45deg,#202020_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#202020_75%),linear-gradient(-45deg,transparent_75%,#202020_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0]" data-testid="xlchemy-clipboard-preview">
          {loading ? <LoaderCircle className="size-7 animate-spin text-white/70" /> : source ? <>
            <img alt="转换前" className="absolute inset-0 size-full object-contain" src={sourceUrl} />
            {result && !previewError ? <><img alt="转换后" className="absolute inset-0 size-full object-contain" src={outputUrl} style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }} onError={() => setPreviewError(true)} /><div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,.45)]" style={{ left: `${compare}%` }}><span className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/60 bg-black/70 text-white"><ArrowLeftRight className="size-4" /></span></div><span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-[10px] font-medium text-white">转换后</span><span className="absolute right-3 top-3 rounded bg-black/70 px-2 py-1 text-[10px] font-medium text-white">转换前</span></> : null}
            {result && previewError ? <div className="absolute inset-x-4 bottom-4 rounded-md border border-white/15 bg-black/80 px-3 py-2 text-center text-xs text-white/75">当前浏览器不能直接预览 {result.output.mimeType}，结果仍可复制到剪贴板。</div> : null}
          </> : <div className="flex flex-col items-center gap-3 text-white/60"><ImageIcon className="size-10" /><span className="text-sm">{error || "剪贴板中没有图片"}</span></div>}
        </div>
      </div>

      <div className="grid gap-3 border-t px-5 py-3 md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)] md:items-center">
        <div className="grid grid-cols-3 gap-2" data-testid="xlchemy-clipboard-stats"><Metric label="转换前" value={source ? `${formatBytes(inputBytes)} · ${shortMime(source.mimeType)}` : "—"} /><Metric label="转换后" value={result ? `${formatBytes(outputBytes)} · ${shortMime(result.output.mimeType)}` : "—"} /><Metric accent={savedPercent !== undefined} label={savedPercent !== undefined && savedPercent < 0 ? "体积增加" : "节省空间"} value={savedPercent === undefined ? "—" : `${Math.abs(savedPercent).toFixed(1)}%`} /></div>
        <div className="grid gap-1.5"><div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>转换后</span><span>转换前</span></div><Slider aria-label="图片前后对比" disabled={!result || previewError} min={0} max={100} step={1} value={[compare]} onValueChange={([value]) => value !== undefined && setCompare(value)} /></div>
        {error && source ? <p className="md:col-span-2 text-xs text-destructive">{error}</p> : null}
      </div>
    </DialogContent>
  </Dialog>
}

function Metric({ accent, label, value }: { accent?: boolean; label: string; value: string }) { return <div className="min-w-0 border-l pl-3 first:border-l-0 first:pl-0"><div className="text-[10px] text-muted-foreground">{label}</div><div className={accent ? "truncate text-sm font-semibold tabular-nums text-primary" : "truncate text-sm font-semibold tabular-nums"}>{value}</div></div> }
function imageDataUrl(image: ClipboardImageData) { return `data:${image.mimeType};base64,${image.base64}` }
function decodedBase64Size(base64: string) { const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0; return Math.max(0, Math.floor(base64.length * 3 / 4) - padding) }
function shortMime(mimeType: string) { return mimeType.replace(/^image\//, "").toUpperCase() }
function formatBytes(bytes: number) { if (!bytes) return "0 B"; const units = ["B", "KB", "MB", "GB"], index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}` }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
