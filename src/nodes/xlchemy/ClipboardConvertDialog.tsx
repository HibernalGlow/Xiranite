import { useState } from "react"
import type { XlchemyFormat } from "@xiranite/node-xlchemy/core"
import { ClipboardPaste, LoaderCircle, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const CLIPBOARD_FORMATS: Array<{ value: XlchemyFormat; label: string }> = [
  { value: "JPEG XL", label: "JPEG XL (.jxl)" },
  { value: "AVIF", label: "AVIF (.avif)" },
  { value: "WebP", label: "WebP (.webp)" },
  { value: "PNG", label: "PNG (.png)" },
  { value: "TIFF", label: "TIFF (.tiff)" },
  { value: "JPEG", label: "JPEG (.jpg)" },
]

export function ClipboardConvertDialog(props: { disabled?: boolean; format: XlchemyFormat; quality: number; onChange: (patch: { clipboardFormat?: XlchemyFormat; clipboardQuality?: number }) => void; onConvert: () => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [converting, setConverting] = useState(false)
  const lossless = props.format === "PNG" || props.format === "TIFF"

  async function convert() {
    setConverting(true)
    try { if (await props.onConvert()) setOpen(false) } finally { setConverting(false) }
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    <ButtonGroup className="gap-0">
      <Tooltip><TooltipTrigger asChild><Button aria-label="一键转换剪贴板图片" disabled={props.disabled || converting} size="icon-sm" variant="ghost" onClick={() => void convert()}>{converting ? <LoaderCircle className="animate-spin" /> : <ClipboardPaste />}</Button></TooltipTrigger><TooltipContent>一键转换剪贴板图片为 {props.format}</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger asChild><DialogTrigger asChild><Button aria-label="配置剪贴板转换" disabled={props.disabled || converting} size="icon-xs" variant="ghost"><Settings2 /></Button></DialogTrigger></TooltipTrigger><TooltipContent>配置剪贴板格式与质量</TooltipContent></Tooltip>
    </ButtonGroup>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>转换剪贴板图片</DialogTitle><DialogDescription>读取剪贴板中的图片，按独立格式与质量转换后直接写回剪贴板。</DialogDescription></DialogHeader>
      <div className="grid gap-4 py-2">
        <Field><FieldLabel>剪贴板目标格式</FieldLabel><Select value={props.format} onValueChange={(clipboardFormat) => props.onChange({ clipboardFormat: clipboardFormat as XlchemyFormat })}><SelectTrigger aria-label="剪贴板目标格式"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{CLIPBOARD_FORMATS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        <Field><div className="flex items-center justify-between"><FieldLabel>剪贴板质量</FieldLabel><span className="text-xs tabular-nums text-muted-foreground">{lossless ? "无损" : props.quality}</span></div><Slider aria-label="剪贴板质量" disabled={lossless} min={1} max={100} step={1} value={[props.quality]} onValueChange={([clipboardQuality]) => clipboardQuality !== undefined && props.onChange({ clipboardQuality })} /></Field>
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">编码器、压缩力度、线程、色度采样及高级参数沿用当前节点设置；不会添加到输入队列，也不会改动主格式和主质量。</p>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button disabled={converting} onClick={() => void convert()}>{converting ? <LoaderCircle className="animate-spin" /> : <ClipboardPaste />}{converting ? "正在转换…" : "转换并写回"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
