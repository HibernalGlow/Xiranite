/**
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/ai/TranslationOverlayCard.tsx
 * @migration-status adapted
 *
 * Region persistence is still local-session only until a shared control-plane store lands.
 * UI mirrors the legacy card so the panel is usable and discoverable.
 */
import {
  Download,
  Eye,
  EyeOff,
  Palette,
  Square,
  Trash2,
  Type,
  Upload,
} from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"

import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"

interface OverlaySettings {
  enabled: boolean
  showBoundingBox: boolean
  showTranslation: boolean
  showOriginal: boolean
  showOriginalOnHover: boolean
  opacity: number
}

interface OverlayRegion {
  id: string
  pageIndex: number
  original: string
  translation: string
}

const DEFAULT_SETTINGS: OverlaySettings = {
  enabled: false,
  showBoundingBox: true,
  showTranslation: true,
  showOriginal: false,
  showOriginalOnHover: true,
  opacity: 0.9,
}

export default function TranslationOverlayCard(props: ReaderPanelContext) {
  if (!props.panelActive) return <ReaderCardEmptyState>打开 AI 面板后查看翻译叠加层</ReaderCardEmptyState>
  return <TranslationOverlayContent {...props} />
}

function TranslationOverlayContent({ session, disabled }: ReaderPanelContext) {
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_SETTINGS)
  const [regions, setRegions] = useState<readonly OverlayRegion[]>([])
  const [message, setMessage] = useState<string>()
  const pageIndex = session?.frame.anchorPageIndex ?? 0

  const currentPageRegionCount = useMemo(
    () => regions.filter((region) => region.pageIndex === pageIndex).length,
    [pageIndex, regions],
  )

  function patch(next: Partial<OverlaySettings>): void {
    setSettings((current) => ({ ...current, ...next }))
  }

  function exportRegions(): void {
    const blob = new Blob([JSON.stringify({ settings, regions }, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `translation_regions_${Date.now()}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setMessage("已导出会话内叠加层数据")
  }

  function importRegions(): void {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "application/json,.json"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const parsed = JSON.parse(await file.text()) as { regions?: OverlayRegion[]; settings?: Partial<OverlaySettings> }
        if (Array.isArray(parsed.regions)) setRegions(parsed.regions)
        if (parsed.settings) setSettings((current) => ({ ...current, ...parsed.settings }))
        setMessage("已导入叠加层数据（仅当前会话）")
      } catch {
        setMessage("导入失败：文件格式无效")
      }
    }
    input.click()
  }

  return (
    <div className="space-y-3 text-xs" data-neoview-card="translation-overlay">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-xs font-medium">
          {settings.enabled
            ? <Eye className="size-3.5 text-primary" />
            : <EyeOff className="size-3.5 text-muted-foreground" />}
          翻译叠加层
        </Label>
        <Switch
          className="scale-90"
          checked={settings.enabled}
          disabled={disabled}
          onCheckedChange={(checked) => {
            patch({ enabled: checked })
            setMessage(checked ? "翻译叠加层已开启（会话本地）" : "翻译叠加层已关闭")
          }}
        />
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        在图片上显示翻译区域和译文。当前仅会话本地预览；区域持久化与跨端同步仍待统一控制面。
      </p>

      <Separator />

      <div className="space-y-2">
        <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">显示选项</p>
        <ToggleRow
          icon={<Square className="size-3" />}
          label="显示边界框"
          checked={settings.showBoundingBox}
          disabled={disabled || !settings.enabled}
          onCheckedChange={(checked) => patch({ showBoundingBox: checked })}
        />
        <ToggleRow
          icon={<Type className="size-3" />}
          label="显示译文"
          checked={settings.showTranslation}
          disabled={disabled || !settings.enabled}
          onCheckedChange={(checked) => patch({ showTranslation: checked })}
        />
        <ToggleRow
          label="显示原文"
          checked={settings.showOriginal}
          disabled={disabled || !settings.enabled}
          onCheckedChange={(checked) => patch({ showOriginal: checked })}
        />
        <ToggleRow
          label="悬停显示原文"
          checked={settings.showOriginalOnHover}
          disabled={disabled || !settings.enabled}
          onCheckedChange={(checked) => patch({ showOriginalOnHover: checked })}
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5 text-xs">
            <Palette className="size-3" />
            透明度
          </Label>
          <span className="text-[10px] tabular-nums text-muted-foreground">{Math.round(settings.opacity * 100)}%</span>
        </div>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={[settings.opacity]}
          disabled={disabled || !settings.enabled}
          onValueChange={(value) => patch({ opacity: value[0] ?? settings.opacity })}
        />
      </div>

      <Separator />

      <div className="space-y-1 rounded-md bg-muted/50 p-2">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">当前页区域</span>
          <span className="font-mono tabular-nums">{currentPageRegionCount}</span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">总区域数</span>
          <span className="font-mono tabular-nums">{regions.length}</span>
        </div>
      </div>

      <Separator />

      <div className="space-y-2">
        <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">数据管理</p>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-[10px]" disabled={disabled} onClick={importRegions}>
            <Upload className="size-3" />
            导入
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-[10px]" disabled={disabled || regions.length === 0} onClick={exportRegions}>
            <Download className="size-3" />
            导出
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-[10px]"
            disabled={disabled || currentPageRegionCount === 0}
            onClick={() => {
              setRegions((current) => current.filter((region) => region.pageIndex !== pageIndex))
              setMessage("已清除当前页翻译区域")
            }}
          >
            <Trash2 className="size-3" />
            清除当前页
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-[10px] text-destructive hover:text-destructive"
            disabled={disabled || regions.length === 0}
            onClick={() => {
              setRegions([])
              setMessage("已清除全部翻译区域")
            }}
          >
            <Trash2 className="size-3" />
            清除全部
          </Button>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8 w-full text-[11px]"
          disabled={disabled || !session}
          onClick={() => {
            const id = `region-${Date.now()}`
            setRegions((current) => [
              ...current,
              {
                id,
                pageIndex,
                original: "これはテストです",
                translation: "这是一个测试",
              },
            ])
            if (!settings.enabled) patch({ enabled: true })
            setMessage("已添加测试区域（会话本地）")
          }}
        >
          添加测试区域
        </Button>
      </div>

      {message ? <div className="text-[11px] text-muted-foreground" role="status">{message}</div> : null}
    </div>
  )
}

function ToggleRow({
  icon,
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  icon?: ReactNode
  label: string
  checked: boolean
  disabled?: boolean
  onCheckedChange(checked: boolean): void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </Label>
      <Switch className="scale-75" checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}
