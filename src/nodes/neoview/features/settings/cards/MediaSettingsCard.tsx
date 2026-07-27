/**
 * Global media defaults. Runtime-only animated-video refinements stay on the sidebar card.
 */
import { Image as ImageIcon, Plus, X } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type {
  ReaderImageProcessingConfigDto,
  ReaderMediaConfigDto,
  ReaderMediaPatchDto,
} from "../../../adapters/reader-http-client"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"
import { SettingsCardSection, SettingsCardShell, SettingsToggleRow } from "../SettingsCardShell"

export function MediaSettingsCard({
  media,
  onMedia,
  imageProcessing,
  onImageProcessing,
}: {
  media: ReaderMediaConfigDto
  onMedia(patch: ReaderMediaPatchDto["media"]): Promise<ReaderMediaConfigDto>
  imageProcessing?: ReaderImageProcessingConfigDto
  onImageProcessing?(patch: Partial<ReaderImageProcessingConfigDto>): Promise<ReaderImageProcessingConfigDto>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  async function commit(patch: ReaderMediaPatchDto["media"]): Promise<boolean> {
    if (saving) return false
    setSaving(true)
    setError(undefined)
    try {
      await onMedia(patch)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCardShell
      id="media-settings"
      title="影像"
      description="配置全局图片/视频识别与播放默认值。动图关键词等细项仍可在侧栏「动图视频模式」中调整。"
      icon={ImageIcon}
    >
      <SettingsCardSection title="图片" description="动图行为与当前识别格式。">
        <SettingsToggleRow
          label="自动播放 GIF / APNG"
          description="关闭后动图以静态首帧显示，需手动触发播放。"
          control={<Switch checked={media.autoPlayAnimatedImages} disabled={saving} onCheckedChange={(value) => void commit({ autoPlayAnimatedImages: value })} aria-label="自动播放动图" />}
        />
        <SettingsToggleRow
          label="动图按视频模式播放"
          description="启用后 GIF/APNG 可走视频播放器（倍速/循环）。更细的关键词在侧栏卡片。"
          control={<Switch checked={media.animatedVideoEnabled} disabled={saving} onCheckedChange={(value) => void commit({ animatedVideoEnabled: value })} aria-label="动图视频模式" />}
        />
        <MediaFormatAliasesSettings media={media} kind="image" disabled={saving} onCommit={commit} />
      </SettingsCardSection>

      {imageProcessing && onImageProcessing ? (
        <ImageProcessingSettings
          config={imageProcessing}
          disabled={saving}
          onCommit={async (patch) => {
            if (saving) return
            setSaving(true)
            setError(undefined)
            try {
              await onImageProcessing(patch)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
            } finally {
              setSaving(false)
            }
          }}
        />
      ) : null}

      <SettingsCardSection title="视频" description="为伪装后缀指定实际视频 MIME 类型；新会话会按这里的类型交给播放器打开。">
        <MediaFormatAliasesSettings media={media} kind="video" disabled={saving} onCommit={commit} />
        <div className="grid gap-2 sm:grid-cols-3">
          <ReadonlyMetric label="最小倍速" value={String(media.videoMinPlaybackRate)} />
          <ReadonlyMetric label="最大倍速" value={String(media.videoMaxPlaybackRate)} />
          <ReadonlyMetric label="步进" value={String(media.videoPlaybackRateStep)} />
        </div>
      </SettingsCardSection>

      <SettingsCardSection title="字幕">
        <label className="grid gap-2 text-sm">
          <span className="font-medium">字号</span>
          <input
            type="number"
            min={10}
            max={64}
            className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2.5 text-sm"
            disabled={saving}
            value={media.subtitle.fontSize}
            aria-label="字幕字号"
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              if (!Number.isFinite(next)) return
              void commit({ subtitle: { fontSize: Math.min(64, Math.max(10, Math.round(next))) } })
            }}
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">底部边距（%）</span>
          <input
            type="number"
            min={0}
            max={40}
            className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2.5 text-sm"
            disabled={saving}
            value={media.subtitle.bottomPercent}
            aria-label="字幕底部边距"
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              if (!Number.isFinite(next)) return
              void commit({ subtitle: { bottomPercent: Math.min(40, Math.max(0, Math.round(next))) } })
            }}
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">背景不透明度</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2.5 text-sm"
            disabled={saving}
            value={media.subtitle.backgroundOpacity}
            aria-label="字幕背景不透明度"
            onChange={(event) => {
              const next = Number(event.currentTarget.value)
              if (!Number.isFinite(next)) return
              void commit({ subtitle: { backgroundOpacity: Math.min(1, Math.max(0, next)) } })
            }}
          />
        </label>
      </SettingsCardSection>
      {error ? <p role="alert" className="text-sm text-destructive">保存失败：{error}</p> : null}
    </SettingsCardShell>
  )
}

type MediaFormatKind = "image" | "video"

function MediaFormatAliasesSettings({
  media,
  kind,
  disabled,
  onCommit,
}: {
  media: ReaderMediaConfigDto
  kind: MediaFormatKind
  disabled: boolean
  onCommit(patch: ReaderMediaPatchDto["media"]): Promise<boolean>
}) {
  const isImage = kind === "image"
  const formatLabel = isImage ? "图片" : "视频"
  const formats = isImage ? media.supportedImageFormats : media.videoFormats
  const otherFormats = isImage ? media.videoFormats : media.supportedImageFormats
  const [extension, setExtension] = useState("")
  const [mimeType, setMimeType] = useState(isImage ? "image/webp" : "video/mp4")
  const [validationError, setValidationError] = useState<string>()

  async function addFormat() {
    const normalizedExtension = extension.trim().replace(/^\.+/u, "").toLowerCase()
    const normalizedMimeType = mimeType.trim().toLowerCase()
    if (!normalizedExtension || !normalizedMimeType) {
      setValidationError("请填写伪装后缀和实际 MIME 类型。")
      return
    }
    if (!normalizedMimeType.startsWith(`${kind}/`)) {
      setValidationError(`实际 MIME 类型必须以 ${kind}/ 开头。`)
      return
    }
    if (formats.includes(normalizedExtension)) {
      setValidationError(`.${normalizedExtension} 已在${formatLabel}格式中。`)
      return
    }
    if (otherFormats.includes(normalizedExtension)) {
      setValidationError(`.${normalizedExtension} 已属于另一种媒体类型。`)
      return
    }
    setValidationError(undefined)
    const mediaMimeTypes = { ...media.mediaMimeTypes, [normalizedExtension]: normalizedMimeType }
    const saved = await onCommit(isImage
      ? { supportedImageFormats: [...formats, normalizedExtension], mediaMimeTypes }
      : { videoFormats: [...formats, normalizedExtension], mediaMimeTypes })
    if (saved) setExtension("")
  }

  async function removeFormat(extensionToRemove: string) {
    const mediaMimeTypes: Record<string, string> = { ...media.mediaMimeTypes }
    delete mediaMimeTypes[extensionToRemove]
    await onCommit(isImage
      ? { supportedImageFormats: formats.filter((format) => format !== extensionToRemove), mediaMimeTypes }
      : { videoFormats: formats.filter((format) => format !== extensionToRemove), mediaMimeTypes })
  }

  const suggestionId = `${kind}-mime-suggestions`
  return (
    <div className="grid gap-2 rounded-md border bg-background/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="text-sm font-medium">当前{formatLabel}格式</div>
        <p className="text-[11px] text-muted-foreground">自定义后缀以指定的真实 MIME 交给阅读器。</p>
      </div>
      {formats.length ? (
        <div className="flex flex-wrap gap-1.5" aria-label={`当前${formatLabel}格式`}>
          {formats.map((format) => (
            <div key={format} className="flex h-7 items-center gap-1 rounded-md border bg-card px-1.5 text-xs">
              <span className="font-mono">.{format}</span>
              {media.mediaMimeTypes[format] ? <span className="text-muted-foreground">{media.mediaMimeTypes[format]}</span> : <span className="text-muted-foreground">内置映射</span>}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title={`移除 .${format}`}
                aria-label={`移除${formatLabel}格式 .${format}`}
                disabled={disabled}
                onClick={() => void removeFormat(format)}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-muted-foreground">尚未配置。</p>}
      <div className="grid gap-2 border-t pt-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] sm:items-end">
        <label className="grid gap-1 text-xs">
          <span>伪装后缀</span>
          <Input
            value={extension}
            disabled={disabled}
            aria-label={`添加${formatLabel}伪装后缀`}
            placeholder={isImage ? "wbp" : "nov"}
            onChange={(event) => setExtension(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void addFormat() }}
          />
        </label>
        <label className="grid gap-1 text-xs">
          <span>实际 MIME 类型</span>
          <Input
            value={mimeType}
            disabled={disabled}
            list={suggestionId}
            aria-label={`添加${formatLabel}实际 MIME 类型`}
            placeholder={isImage ? "image/webp" : "video/mp4"}
            onChange={(event) => setMimeType(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void addFormat() }}
          />
        </label>
        <Button
          type="button"
          size="icon"
          title={`添加${formatLabel}格式`}
          aria-label={`添加${formatLabel}格式`}
          disabled={disabled}
          onClick={() => void addFormat()}
        >
          <Plus />
        </Button>
        <datalist id={suggestionId}>
          {(isImage ? IMAGE_MIME_SUGGESTIONS : VIDEO_MIME_SUGGESTIONS).map((value) => <option key={value} value={value} />)}
        </datalist>
      </div>
      {validationError ? <p role="alert" className="text-xs text-destructive">{validationError}</p> : null}
    </div>
  )
}

const IMAGE_MIME_SUGGESTIONS = ["image/avif", "image/bmp", "image/gif", "image/jpeg", "image/jxl", "image/png", "image/tiff", "image/webp"]
const VIDEO_MIME_SUGGESTIONS = ["video/mp4", "video/webm", "video/x-matroska", "video/quicktime", "video/x-msvideo", "video/mpeg"]

function ImageProcessingSettings({
  config,
  disabled,
  onCommit,
}: {
  config: ReaderImageProcessingConfigDto
  disabled: boolean
  onCommit(patch: Partial<ReaderImageProcessingConfigDto>): Promise<void>
}) {
  const processingDisabled = disabled || !config.enabled
  return (
    <SettingsCardSection title="图像处理" description="分别控制阅读器兼容转换、系统原生缩略图与 Sharp 路径。">
      <SettingsToggleRow
        label="启用图像处理"
        description="总开关关闭时，阅读器优先返回原始 HTTP 资源，并暂停下列转换路径。"
        control={<Switch checked={config.enabled} disabled={disabled} onCheckedChange={(value) => void onCommit({ enabled: value })} aria-label="启用图像处理" />}
      />

      <ProcessingGroup title="阅读器与 JXL">
        <CompactToggle label="普通阅读器转换" checked={config.readerTransformEnabled} disabled={processingDisabled} onChange={(value) => onCommit({ readerTransformEnabled: value })} />
        <CompactToggle label="JXL 兼容转换" checked={config.jxlTransformEnabled} disabled={processingDisabled} onChange={(value) => onCommit({ jxlTransformEnabled: value })} />
        <CompactToggle label="JXL 无损输出" checked={config.jxlLossless} disabled={processingDisabled || !config.jxlTransformEnabled} onChange={(value) => onCommit({ jxlLossless: value })} />
        <QualityField label="JXL 质量" value={config.jxlQuality} disabled={processingDisabled || !config.jxlTransformEnabled || config.jxlLossless} onCommit={(value) => onCommit({ jxlQuality: value })} />
      </ProcessingGroup>

      <ProcessingGroup title="Windows 原生路径">
        <CompactToggle label="WIC 图像转换" checked={config.wicNativeEnabled} disabled={processingDisabled} onChange={(value) => onCommit({ wicNativeEnabled: value })} />
        <CompactToggle label="Windows Shell 缩略图" checked={config.windowsShellNativeEnabled} disabled={processingDisabled} onChange={(value) => onCommit({ windowsShellNativeEnabled: value })} />
      </ProcessingGroup>

      <ProcessingGroup title="缩略图">
        <CompactToggle label="生成缩略图" checked={config.thumbnailTransformEnabled} disabled={processingDisabled} onChange={(value) => onCommit({ thumbnailTransformEnabled: value })} />
        <CompactToggle label="缩略图无损输出" checked={config.thumbnailLossless} disabled={processingDisabled || !config.thumbnailTransformEnabled} onChange={(value) => onCommit({ thumbnailLossless: value })} />
        <QualityField label="缩略图质量" value={config.thumbnailQuality} disabled={processingDisabled || !config.thumbnailTransformEnabled || config.thumbnailLossless} onCommit={(value) => onCommit({ thumbnailQuality: value })} />
      </ProcessingGroup>

      <ProcessingGroup title="文件夹拼图">
        <CompactToggle label="生成多图拼接" checked={config.folderMosaicEnabled} disabled={processingDisabled} onChange={(value) => onCommit({ folderMosaicEnabled: value })} />
        <CompactToggle label="拼图无损输出" checked={config.mosaicLossless} disabled={processingDisabled || !config.folderMosaicEnabled} onChange={(value) => onCommit({ mosaicLossless: value })} />
        <QualityField label="拼图质量" value={config.mosaicQuality} disabled={processingDisabled || !config.folderMosaicEnabled || config.mosaicLossless} onCommit={(value) => onCommit({ mosaicQuality: value })} />
      </ProcessingGroup>

      <SettingsToggleRow
        label="Sharp fallback"
        description="仅在原生路径无法处理时允许加载 Sharp；文件夹拼图由上方独立开关控制。"
        control={<Switch checked={config.sharpFallbackEnabled} disabled={processingDisabled} onCheckedChange={(value) => void onCommit({ sharpFallbackEnabled: value })} aria-label="启用 Sharp fallback" />}
      />
    </SettingsCardSection>
  )
}

function ProcessingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2 rounded-md border bg-background/60 p-3">
      <legend className="px-1 text-xs font-semibold">{title}</legend>
      {children}
    </fieldset>
  )
}

function CompactToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onChange(value: boolean): Promise<void>
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={(value) => void onChange(value)} aria-label={label} />
    </div>
  )
}

function QualityField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string
  value: number
  disabled: boolean
  onCommit(value: number): Promise<void>
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const normalized = Math.min(100, Math.max(1, Math.round(draft)))
    setDraft(normalized)
    if (normalized !== value) void onCommit(normalized)
  }
  return (
    <label className="flex min-h-8 items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input
        type="number"
        min={1}
        max={100}
        step={1}
        value={draft}
        disabled={disabled}
        className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right tabular-nums"
        aria-label={label}
        onChange={(event) => setDraft(Number(event.currentTarget.value))}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }}
      />
    </label>
  )
}

function ReadonlyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background/60 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm tabular-nums">{value}</div>
    </div>
  )
}

export function SettingsMediaCard({ media, onMedia, imageProcessing, onImageProcessing }: ReaderSettingsCardContext) {
  if (!media || !onMedia) return null
  return <MediaSettingsCard media={media} onMedia={onMedia} imageProcessing={imageProcessing} onImageProcessing={onImageProcessing} />
}

export default function DockedMediaSettingsCard({ media, onMediaChange, imageProcessing, onImageProcessingChange }: ReaderPanelContext) {
  if (!media || !onMediaChange) return null
  return <MediaSettingsCard media={media} onMedia={onMediaChange} imageProcessing={imageProcessing} onImageProcessing={onImageProcessingChange} />
}
