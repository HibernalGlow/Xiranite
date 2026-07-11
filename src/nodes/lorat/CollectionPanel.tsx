import { useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import type { LoratCollectionResult } from "@xiranite/node-lorat/core"
import { ImagePlus, PackageCheck, Trash2, Upload, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { TagsInput, TagsInputInput, TagsInputItem, TagsInputList } from "@/components/ui/tags-input"
import { cn } from "@/lib/utils"
import type { LoratCardState, LoratCollectionDraft } from "./types"

type Translate = (key: string, fallback: string, vars?: Record<string, unknown>) => string
type NativeFile = File & { path?: string }

const MODEL_EXTENSIONS = [".safetensors", ".ckpt", ".pt"]
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif"]
const DIRECTORY_SUGGESTIONS = ["style", "character", "artist", "concept", "self"]

export function LoratCollectionPanel(props: {
  compact: boolean
  data: LoratCardState
  disabled: boolean
  running: boolean
  onCollect: () => void
  onPatch: (patch: Partial<LoratCardState>) => void
  t: Translate
}) {
  const modelInputRef = useRef<HTMLInputElement>(null)
  const previewInputRef = useRef<HTMLInputElement>(null)
  const targetInputId = useId()
  const rootInputId = useId()
  const overwriteId = useId()
  const items = props.data.collectionItems ?? []
  const [selectedId, setSelectedId] = useState<string | undefined>(items[0]?.id)
  const [dropMessage, setDropMessage] = useState<string>("")
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const selected = items.find((item) => item.id === selectedId) ?? items[0]
  const resultBySource = useMemo(() => new Map((props.data.collectionResults ?? []).map((result) => [result.item.sourcePath, result])), [props.data.collectionResults])

  function replaceItems(next: LoratCollectionDraft[]) {
    props.onPatch({ collectionItems: next })
    if (!next.some((item) => item.id === selectedId)) setSelectedId(next[0]?.id)
  }

  function addModels(files: File[]) {
    const valid = files.filter((file) => hasExtension(file.name, MODEL_EXTENSIONS))
    const missingPath = valid.filter((file) => !nativePath(file))
    if (missingPath.length) {
      setDropMessage(props.t("collection.desktopOnly", "需要桌面端提供本机路径，浏览器文件不能直接复制到 LoRA 库。"))
    }
    const next = [...items]
    for (const file of valid) {
      const sourcePath = nativePath(file)
      if (!sourcePath || next.some((item) => item.sourcePath === sourcePath)) continue
      const sourceName = file.name
      next.push({
        id: `${sourcePath}:${Date.now()}:${next.length}`,
        sourcePath,
        sourceName,
        targetRelativeDir: suggestRelativeDir(sourcePath, sourceName),
        triggerText: inferTrigger(sourceName),
      })
    }
    if (!valid.length) setDropMessage(props.t("collection.modelOnly", "这里只接受 .safetensors、.ckpt 或 .pt LoRA 模型。"))
    replaceItems(next)
  }

  function bindPreview(files: File[]) {
    if (!selected) {
      setDropMessage(props.t("collection.selectFirst", "先从队列选择一个 LoRA，再绑定预览图。"))
      return
    }
    const file = files.find((candidate) => hasExtension(candidate.name, IMAGE_EXTENSIONS))
    if (!file) {
      setDropMessage(props.t("collection.imageOnly", "预览图支持 PNG、JPG、WEBP 或 AVIF。"))
      return
    }
    const sourcePath = nativePath(file)
    if (!sourcePath) {
      setDropMessage(props.t("collection.desktopOnly", "需要桌面端提供本机路径，浏览器文件不能直接复制到 LoRA 库。"))
      return
    }
    const oldUrl = previewUrls[selected.id]
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    setPreviewUrls((current) => ({ ...current, [selected.id]: URL.createObjectURL(file) }))
    replaceItems(items.map((item) => item.id === selected.id ? { ...item, previewSourcePath: sourcePath, previewName: file.name } : item))
    setDropMessage("")
  }

  function removeItem(id: string) {
    const previewUrl = previewUrls[id]
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrls((current) => {
      const { [id]: _, ...rest } = current
      return rest
    })
    replaceItems(items.filter((item) => item.id !== id))
  }

  function patchSelected(patch: Partial<LoratCollectionDraft>) {
    if (!selected) return
    replaceItems(items.map((item) => item.id === selected.id ? { ...item, ...patch } : item))
  }

  function handleModelInput(event: ChangeEvent<HTMLInputElement>) {
    addModels(Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ""
  }

  function handlePreviewInput(event: ChangeEvent<HTMLInputElement>) {
    bindPreview(Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ""
  }

  function preventDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
  }

  function handleModelDrop(event: DragEvent<HTMLElement>) {
    preventDrop(event)
    addModels(Array.from(event.dataTransfer.files))
  }

  function handlePreviewDrop(event: DragEvent<HTMLElement>) {
    preventDrop(event)
    bindPreview(Array.from(event.dataTransfer.files))
  }

  const canCollect = Boolean(props.data.collectionRoot?.trim() && items.length && !props.disabled)
  const triggerTags = selected?.triggerText?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? []

  return (
    <div data-testid="lorat-collection-panel" className={cn("flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3", props.compact && "gap-2 px-2 pb-2")}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{props.t("collection.title", "收集 LoRA")}</h3>
          <p className="text-xs text-muted-foreground">{props.t("collection.subtitle", "从下载目录投入库，并一起保存预览图和触发词。")}</p>
        </div>
        <Badge variant={items.length ? "secondary" : "outline"}>{props.t("collection.queued", "{{count}} 个待收集", { count: items.length })}</Badge>
      </div>

      {dropMessage && <Alert variant="destructive" className="shrink-0 py-2"><X data-icon="inline-start" /><AlertTitle>{props.t("collection.dropIssue", "无法加入队列")}</AlertTitle><AlertDescription>{dropMessage}</AlertDescription></Alert>}

      <div className={cn("grid min-h-0 flex-1 gap-3", props.compact ? "grid-cols-1" : "@5xl/lorat:grid-cols-[minmax(210px,.7fr)_minmax(260px,1fr)_minmax(240px,.75fr)]")}>
        <section className="flex min-h-0 flex-col rounded-lg border bg-card">
          <DropTarget
            label={props.t("collection.dropModels", "拖入 LoRA 文件")}
            description={props.t("collection.dropModelsDescription", ".safetensors / .ckpt / .pt")}
            disabled={props.disabled}
            icon={Upload}
            onBrowse={() => modelInputRef.current?.click()}
            onDragOver={preventDrop}
            onDrop={handleModelDrop}
            testId="lorat-collection-model-drop"
          />
          <input ref={modelInputRef} accept={MODEL_EXTENSIONS.join(",")} className="sr-only" multiple type="file" onChange={handleModelInput} />
          <ScrollArea className="min-h-0 flex-1 border-t">
            <div className="flex flex-col gap-1 p-2">
              {items.length ? items.map((item) => <CollectionQueueItem key={item.id} item={item} result={resultBySource.get(item.sourcePath)} selected={item.id === selected?.id} onRemove={() => removeItem(item.id)} onSelect={() => setSelectedId(item.id)} />) : <div className="p-3 text-center text-xs text-muted-foreground">{props.t("collection.emptyQueue", "投入模型后在这里排队。")}</div>}
            </div>
          </ScrollArea>
        </section>

        <section className="flex min-h-0 flex-col rounded-lg border bg-card p-3">
          <div
            className="grid min-h-44 flex-1 place-items-center rounded-md border border-dashed bg-muted/20 p-3 text-center"
            onDragOver={preventDrop}
            onDrop={handlePreviewDrop}
            data-testid="lorat-collection-preview-drop"
          >
            {selected && previewUrls[selected.id] ? <img alt={selected.previewName ?? selected.sourceName} className="h-full max-h-64 w-full rounded object-contain" src={previewUrls[selected.id]} /> : <div className="flex flex-col items-center gap-2 text-muted-foreground"><ImagePlus /><span className="text-sm font-medium">{selected ? props.t("collection.dropPreview", "拖入图片绑定预览") : props.t("collection.selectModel", "从队列选择 LoRA")}</span><span className="text-xs">{props.t("collection.previewHint", "PNG、JPG、WEBP 或 AVIF")}</span></div>}
          </div>
          <input ref={previewInputRef} accept={IMAGE_EXTENSIONS.join(",")} className="sr-only" type="file" onChange={handlePreviewInput} />
          <div className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-xs text-muted-foreground">{selected?.previewName ?? props.t("collection.noPreview", "尚未绑定预览图")}</span><Button disabled={!selected || props.disabled} size="xs" variant="outline" onClick={() => previewInputRef.current?.click()}><ImagePlus data-icon="inline-start" />{props.t("collection.bindPreview", "绑定图片")}</Button></div>
        </section>

        <section className="min-h-0 rounded-lg border bg-card p-3">
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={rootInputId}>{props.t("collection.libraryRoot", "LoRA 库目录")}</FieldLabel>
              <InputGroup><InputGroupAddon align="inline-start"><InputGroupText>~/</InputGroupText></InputGroupAddon><InputGroupInput id={rootInputId} disabled={props.disabled} placeholder="D:\\ComfyUI\\models\\loras" value={props.data.collectionRoot ?? ""} onChange={(event) => props.onPatch({ collectionRoot: event.currentTarget.value })} /></InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor={targetInputId}>{props.t("collection.relativeDir", "相对存放目录")}</FieldLabel>
              <InputGroup><InputGroupAddon align="inline-start"><InputGroupText>/</InputGroupText></InputGroupAddon><InputGroupInput id={targetInputId} disabled={!selected || props.disabled} placeholder="style/mecha" value={selected?.targetRelativeDir ?? ""} onChange={(event) => patchSelected({ targetRelativeDir: event.currentTarget.value })} /></InputGroup>
              <div className="flex flex-wrap gap-1">{DIRECTORY_SUGGESTIONS.map((directory) => <Button key={directory} disabled={!selected || props.disabled} size="xs" variant="outline" onClick={() => patchSelected({ targetRelativeDir: directory })}>/{directory}/</Button>)}</div>
            </Field>
            <Field>
              <FieldTitle>{props.t("collection.triggers", "触发词")}</FieldTitle>
              <FieldContent>
                <TagsInput addOnPaste addOnTab className="w-full gap-1" delimiter="," disabled={!selected || props.disabled} value={triggerTags} onValueChange={(values) => patchSelected({ triggerText: values.join(", ") })}>
                  <TagsInputList className="min-h-9 px-2 py-1"><TagsInputInput aria-label={props.t("collection.triggers", "触发词")} className="text-xs" placeholder={props.t("collection.addTrigger", "输入后按 Enter")}/>{triggerTags.map((tag) => <TagsInputItem key={tag} value={tag} className="px-2 py-0.5 text-xs">{tag}</TagsInputItem>)}</TagsInputList>
                </TagsInput>
                <FieldDescription>{props.t("collection.triggerHint", "提交时写入同名 .trigger.txt sidecar。")}</FieldDescription>
              </FieldContent>
            </Field>
            <Field orientation="horizontal">
              <FieldContent><FieldLabel htmlFor={overwriteId}>{props.t("collection.overwrite", "覆盖已有文件")}</FieldLabel><FieldDescription>{props.t("collection.overwriteHint", "默认跳过同名目标文件。")}</FieldDescription></FieldContent>
              <Switch id={overwriteId} checked={props.data.collectionOverwrite ?? false} disabled={props.disabled} onCheckedChange={(collectionOverwrite) => props.onPatch({ collectionOverwrite })} />
            </Field>
            <CollectionCommitButton canCollect={canCollect} running={props.running} t={props.t} onCollect={props.onCollect} />
          </FieldGroup>
        </section>
      </div>
    </div>
  )
}

function DropTarget(props: { description: string; disabled: boolean; icon: typeof Upload; label: string; onBrowse: () => void; onDragOver: (event: DragEvent<HTMLElement>) => void; onDrop: (event: DragEvent<HTMLElement>) => void; testId: string }) {
  const Icon = props.icon
  return <div data-testid={props.testId} className="grid place-items-center gap-1.5 p-4 text-center" onDragOver={props.onDragOver} onDrop={props.onDrop}><Icon className="text-muted-foreground" /><span className="text-sm font-medium">{props.label}</span><span className="text-xs text-muted-foreground">{props.description}</span><Button disabled={props.disabled} size="xs" variant="outline" onClick={props.onBrowse}>浏览文件</Button></div>
}

function CollectionQueueItem(props: { item: LoratCollectionDraft; result?: LoratCollectionResult; selected: boolean; onRemove: () => void; onSelect: () => void }) {
  const resultVariant = props.result?.status === "error" ? "destructive" : props.result?.status === "collected" ? "default" : "outline"
  const resultLabel = props.result?.status === "collected" ? "已收集" : props.result?.status === "skipped" ? "已跳过" : props.result?.status === "error" ? "失败" : "待处理"
  return <div className={cn("flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors", props.selected && "border-primary bg-primary/5")}><button aria-pressed={props.selected} className="min-w-0 flex-1 text-left" type="button" onClick={props.onSelect}><div className="truncate text-xs font-medium">{props.item.sourceName}</div><div className="truncate font-mono text-[10px] text-muted-foreground">/{props.item.targetRelativeDir || "uncategorized"}/</div></button><Badge variant={resultVariant} className="shrink-0 text-[10px]">{resultLabel}</Badge><Button aria-label={`移除 ${props.item.sourceName}`} className="shrink-0" size="icon-xs" variant="ghost" onClick={props.onRemove}><Trash2 /></Button></div>
}

function CollectionCommitButton(props: { canCollect: boolean; running: boolean; t: Translate; onCollect: () => void }) {
  if (props.running) return <Button disabled><PackageCheck data-icon="inline-start" />{props.t("collection.collecting", "正在收集")}</Button>
  return <AlertDialog><AlertDialogTrigger asChild><Button disabled={!props.canCollect}><PackageCheck data-icon="inline-start" />{props.t("collection.commit", "收集到 LoRA 库")}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{props.t("collection.confirmTitle", "确认收集到 LoRA 库？")}</AlertDialogTitle><AlertDialogDescription>{props.t("collection.confirmDescription", "将复制队列中的模型、预览图和触发词 sidecar 到指定库目录。除非开启覆盖，同名文件会被跳过。")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{props.t("collection.cancel", "取消")}</AlertDialogCancel><AlertDialogAction onClick={props.onCollect}>{props.t("collection.confirm", "确认收集")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}

function nativePath(file: File): string | undefined {
  const native = file as NativeFile
  return native.path?.trim() || undefined
}

function hasExtension(name: string, extensions: string[]): boolean {
  return extensions.some((extension) => name.toLowerCase().endsWith(extension))
}

function suggestRelativeDir(path: string, name: string): string {
  const normalized = path.replace(/\\/g, "/").toLowerCase()
  const matched = DIRECTORY_SUGGESTIONS.find((segment) => normalized.includes(`/${segment}/`))
  if (matched) return matched
  const stem = name.replace(/\.(safetensors|ckpt|pt)$/i, "").replace(/[_\s]+/g, "-").toLowerCase()
  return `uncategorized/${stem}`
}

function inferTrigger(name: string): string {
  return name.replace(/\.(safetensors|ckpt|pt)$/i, "").replace(/[-_ ]?(step\d+|v\d+|final)$/i, "").replace(/[_-]+/g, " ").trim()
}
