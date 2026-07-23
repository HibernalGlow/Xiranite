import { useState } from "react"
import type { XlchemyFormat } from "@xiranite/node-xlchemy/core"
import { ChevronDown, ClipboardPaste, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
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
  const [converting, setConverting] = useState(false)
  const lossless = props.format === "PNG" || props.format === "TIFF"

  async function convert() {
    setConverting(true)
    try { await props.onConvert() } finally { setConverting(false) }
  }

  return <ButtonGroup className="gap-0">
    <Tooltip><TooltipTrigger asChild><Button aria-label="一键转换剪贴板图片" disabled={props.disabled || converting} size="icon-sm" variant="ghost" onClick={() => void convert()}>{converting ? <LoaderCircle className="animate-spin" /> : <ClipboardPaste />}</Button></TooltipTrigger><TooltipContent>一键转换剪贴板图片为 {props.format}</TooltipContent></Tooltip>
    <DropdownMenu>
      <Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><Button aria-label="剪贴板转换选项" disabled={props.disabled || converting} size="icon-xs" variant="ghost"><ChevronDown /></Button></DropdownMenuTrigger></TooltipTrigger><TooltipContent>剪贴板转换选项</TooltipContent></Tooltip>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>目标格式</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={props.format} onValueChange={(clipboardFormat) => props.onChange({ clipboardFormat: clipboardFormat as XlchemyFormat })}>
          {CLIPBOARD_FORMATS.map((item) => <DropdownMenuRadioItem key={item.value} value={item.value} onSelect={(event) => event.preventDefault()}>{item.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="grid gap-2 py-2">
          <span className="flex items-center justify-between"><span>质量</span><span className="font-normal tabular-nums text-muted-foreground">{lossless ? "无损" : props.quality}</span></span>
          <Slider aria-label="剪贴板质量" disabled={lossless} min={1} max={100} step={1} value={[props.quality]} onValueChange={([clipboardQuality]) => clipboardQuality !== undefined && props.onChange({ clipboardQuality })} />
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  </ButtonGroup>
}
