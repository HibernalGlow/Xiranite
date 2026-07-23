import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type HTMLAttributes } from "react"
import type { NodeClipboardCapability, NodeLocalFilesCapability } from "@xiranite/contract"
import type { LoratCollectionResult } from "@xiranite/node-lorat/core"
import type { NexusCaptureDTO } from "@xiranite/shared"
import { ChevronRight, ClipboardPaste, Folder, FolderOpen, ImagePlus, LoaderCircle, PackageCheck, Trash2, Upload, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { TagsInput, TagsInputInput, TagsInputItem, TagsInputList } from "@/components/ui/tags-input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useLocalFileDrop } from "@/nodes/shared/useLocalFileDrop"
import { LoratNexusInbox } from "./LoratNexusInbox"
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
  localFiles?: NodeLocalFilesCapability
  clipboard?: NodeClipboardCapability
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
  const [importing, setImporting] = useState(false)
  const inputDisabled = props.disabled || importing
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [directoryLevel, setDirectoryLevel] = useState("")
  const [directories, setDirectories] = useState<Array<{ name: string; path: string }>>([])
  const [directoriesLoading, setDirectoriesLoading] = useState(false)
  const selected = items.find((item) => item.id === selectedId) ?? items[0]
  const resultBySource = useMemo(() => new Map((props.data.collectionResults ?? []).map((result) => [result.item.sourcePath, result])), [props.data.collectionResults])
  const modelDrop = useLocalFileDrop({
    disabled: inputDisabled,
    subscribeDrops: props.localFiles?.subscribeDrops,
    onDropPaths: addModelPaths,
    onUnsupported: () => setDropMessage(props.t("collection.desktopOnly", "需要桌面端提供本机路径，浏览器文件不能直接复制到 LoRA 库。")),
  })
  const previewDrop = useLocalFileDrop({
    disabled: inputDisabled,
    subscribeDrops: props.localFiles?.subscribeDrops,
    onDropPaths: bindPreviewPaths,
    onUnsupported: () => setDropMessage(props.t("collection.desktopOnly", "需要桌面端提供本机路径，浏览器文件不能直接复制到 LoRA 库。")),
  })

  useEffect(() => {
    setDirectoryLevel("")
  }, [props.data.collectionRoot])

  useEffect(() => {
    const root = props.data.collectionRoot?.trim()
    if (!root || !props.localFiles?.list) {
      setDirectories([])
      return
    }
    let disposed = false
    const timeout = window.setTimeout(() => {
      setDirectoriesLoading(true)
      void props.localFiles!.list!(joinHostPath(root, directoryLevel), { recursive: false, includeDirectories: true, limit: 500 })
        .then((entries) => {
          if (disposed) return
          setDirectories(entries.filter((entry) => entry.isDirectory).map((entry) => ({ name: entry.name, path: entry.path })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })))
          setDropMessage("")
        })
        .catch((error) => {
          if (!disposed) {
            setDirectories([])
            setDropMessage(error instanceof Error ? error.message : String(error))
          }
        })
        .finally(() => { if (!disposed) setDirectoriesLoading(false) })
    }, 250)
    return () => {
      disposed = true
      window.clearTimeout(timeout)
    }
  }, [directoryLevel, props.data.collectionRoot, props.localFiles])

  function replaceItems(next: LoratCollectionDraft[]) {
    props.onPatch({ collectionItems: next })
    if (!next.some((item) => item.id === selectedId)) setSelectedId(next[0]?.id)
  }

  async function addModels(files: File[]) {
    const valid = files.filter((file) => hasExtension(file.name, MODEL_EXTENSIONS))
    const paths = valid.flatMap((file) => nativePath(file) ? [nativePath(file)!] : [])
    if (!valid.length) setDropMessage(props.t("collection.modelOnly", "这里只接受 .safetensors、.ckpt 或 .pt LoRA 模型。"))
    const pathless = valid.filter((file) => !nativePath(file))
    if (!pathless.length) {
      if (paths.length) addModelPaths(paths)
      return
    }
    if (!props.localFiles?.stageFiles) {
      if (paths.length) addModelPaths(paths)
      setDropMessage(props.t("collection.desktopOnly", "当前环境无法取得或暂存本机文件。"))
      return
    }
    setImporting(true)
    try {
      addModelPaths([...paths, ...await props.localFiles.stageFiles(pathless)])
    } catch (error) {
      setDropMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setImporting(false)
    }
  }

  function addModelPaths(paths: string[]) {
    const valid = paths.filter((path) => hasExtension(path, MODEL_EXTENSIONS))
    const next = [...items]
    for (const sourcePath of valid) {
      if (next.some((item) => item.sourcePath === sourcePath)) continue
      const sourceName = fileName(sourcePath)
      next.push({
        id: `${sourcePath}:${Date.now()}:${next.length}`,
        sourcePath,
        sourceName,
        targetRelativeDir: suggestRelativeDir(sourcePath, sourceName, props.data.collectionCreateModelFolder ?? false),
        triggerText: inferTrigger(sourceName),
      })
    }
    if (!valid.length) setDropMessage(props.t("collection.modelOnly", "这里只接受 .safetensors、.ckpt 或 .pt LoRA 模型。"))
    else setDropMessage("")
    replaceItems(next)
  }

  async function bindPreview(files: File[]) {
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
      if (!props.localFiles?.stageFiles) {
        setDropMessage(props.t("collection.desktopOnly", "当前环境无法取得或暂存本机文件。"))
        return
      }
      setImporting(true)
      try {
        const [stagedPath] = await props.localFiles.stageFiles([file])
        if (stagedPath) bindPreviewPath(stagedPath, file.name, props.localFiles.getUrl(stagedPath))
      } catch (error) {
        setDropMessage(error instanceof Error ? error.message : String(error))
      } finally {
        setImporting(false)
      }
      return
    }
    bindPreviewPath(sourcePath, file.name, URL.createObjectURL(file))
  }

  function bindPreviewPaths(paths: string[]) {
    const sourcePath = paths.find((path) => hasExtension(path, IMAGE_EXTENSIONS))
    if (!sourcePath) {
      setDropMessage(props.t("collection.imageOnly", "预览图支持 PNG、JPG、WEBP 或 AVIF。"))
      return
    }
    bindPreviewPath(sourcePath, fileName(sourcePath), props.localFiles?.getUrl(sourcePath))
  }

  function bindPreviewPath(sourcePath: string, name: string, previewUrl?: string) {
    if (!selected) {
      setDropMessage(props.t("collection.selectFirst", "先从队列选择一个 LoRA，再绑定预览图。"))
      return
    }
    const oldUrl = previewUrls[selected.id]
    if (oldUrl?.startsWith("blob:")) URL.revokeObjectURL(oldUrl)
    if (previewUrl) setPreviewUrls((current) => ({ ...current, [selected.id]: previewUrl }))
    replaceItems(items.map((item) => item.id === selected.id ? { ...item, previewSourcePath: sourcePath, previewName: name } : item))
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

  async function applyNexusCapture(capture: NexusCaptureDTO) {
    if (!selected) throw new Error("Select a LoRA model before applying a Nexus capture.")
    const sourceUrl = capture.source.pageUrl || capture.source.url
    const captureText = capture.content?.text?.trim()
      || (typeof capture.metadata?.description === "string" ? capture.metadata.description.trim() : "")
    const notes = [selected.notes?.trim(), captureText].filter(Boolean).join("\n")
    let previewPatch: Partial<LoratCollectionDraft> = {}

    if (capture.kind === "image") {
      const attachment = capture.attachments?.[0]
      if (!attachment) throw new Error("The Nexus image capture has no attachment.")
      if (!props.localFiles?.stageFiles) throw new Error("This host cannot stage the captured image.")
      setImporting(true)
      try {
        const file = await fileFromNexusAttachment(attachment)
        const [previewSourcePath] = await props.localFiles.stageFiles([file])
        if (!previewSourcePath) throw new Error("Staging the Nexus image did not return a path.")
        previewPatch = { previewSourcePath, previewName: file.name }
        setPreviewUrls((current) => ({ ...current, [selected.id]: props.localFiles!.getUrl(previewSourcePath) }))
      } finally {
        setImporting(false)
      }
    }

    replaceItems(items.map((item) => item.id === selected.id ? {
      ...item,
      sourceUrl,
      ...(notes ? { notes } : {}),
      ...previewPatch,
    } : item))
    setDropMessage("")
  }

  async function browseModels() {
    if (!props.localFiles?.pickFiles) {
      modelInputRef.current?.click()
      return
    }
    try {
      addModelPaths(await props.localFiles.pickFiles({
        title: "选择 LoRA 模型",
        filters: [{ displayName: "LoRA 模型", pattern: "*.safetensors;*.ckpt;*.pt" }],
      }))
    } catch (error) {
      setDropMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function browsePreview() {
    if (!props.localFiles?.pickFiles) {
      previewInputRef.current?.click()
      return
    }
    try {
      bindPreviewPaths(await props.localFiles.pickFiles({
        title: "选择 LoRA 预览图",
        filters: [{ displayName: "预览图", pattern: "*.png;*.jpg;*.jpeg;*.webp;*.avif" }],
      }))
    } catch (error) {
      setDropMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function browseCollectionRoot() {
    if (!props.localFiles?.pickDirectory) return
    try {
      const collectionRoot = await props.localFiles.pickDirectory()
      if (collectionRoot) props.onPatch({ collectionRoot })
    } catch (error) {
      setDropMessage(error instanceof Error ? error.message : String(error))
    }
  }

  function selectDirectory(name: string) {
    const next = normalizeRelativePath([directoryLevel, name].filter(Boolean).join("/"))
    patchSelected({ targetRelativeDir: next })
    setDirectoryLevel(next)
  }

  async function pastePreview() {
    if (!selected) {
      setDropMessage(props.t("collection.selectFirst", "先从队列选择一个 LoRA，再绑定预览图。"))
      return
    }
    if (!props.clipboard?.readImage || !props.localFiles?.stageFiles) {
      setDropMessage(props.t("collection.clipboardUnsupported", "当前环境不支持粘贴剪贴板图片。"))
      return
    }
    setImporting(true)
    try {
      const image = await props.clipboard.readImage()
      if (!image) {
        setDropMessage(props.t("collection.clipboardEmpty", "剪贴板中没有图片。"))
        return
      }
      const name = `clipboard-preview.${extensionForMimeType(image.mimeType)}`
      const file = fileFromBase64(image.base64, image.mimeType, name)
      const [stagedPath] = await props.localFiles.stageFiles([file])
      if (!stagedPath) throw new Error("暂存剪贴板图片失败。")
      bindPreviewPath(stagedPath, name, props.localFiles.getUrl(stagedPath))
    } catch (error) {
      setDropMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setImporting(false)
    }
  }

  function handleModelInput(event: ChangeEvent<HTMLInputElement>) {
    void addModels(Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ""
  }

  function handlePreviewInput(event: ChangeEvent<HTMLInputElement>) {
    void bindPreview(Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ""
  }

  const canCollect = Boolean(props.data.collectionRoot?.trim() && items.length && !inputDisabled)
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

      <LoratNexusInbox disabled={inputDisabled} hasSelection={Boolean(selected)} onApply={applyNexusCapture} />

      <div className={cn("grid min-h-0 flex-1 gap-3", props.compact ? "grid-cols-1" : "@5xl/lorat:grid-cols-[minmax(210px,.7fr)_minmax(260px,1fr)_minmax(240px,.75fr)]")}>
        <section className="flex min-h-0 flex-col rounded-lg border bg-card">
          <DropTarget
            label={props.t("collection.dropModels", "拖入 LoRA 文件")}
            description={props.t("collection.dropModelsDescription", ".safetensors / .ckpt / .pt")}
            disabled={inputDisabled}
            icon={Upload}
            onBrowse={() => void browseModels()}
            targetProps={modelDrop.targetProps}
            dragging={modelDrop.dragging}
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
            {...previewDrop.targetProps}
            className={cn("grid min-h-44 flex-1 place-items-center rounded-md border border-dashed bg-muted/20 p-3 text-center transition-colors", previewDrop.dragging && "border-primary bg-primary/5 ring-2 ring-primary/20")}
            data-testid="lorat-collection-preview-drop"
          >
            {selected && previewUrls[selected.id] ? <img alt={selected.previewName ?? selected.sourceName} className="h-full max-h-64 w-full rounded object-contain" src={previewUrls[selected.id]} /> : <div className="flex flex-col items-center gap-2 text-muted-foreground"><ImagePlus /><span className="text-sm font-medium">{selected ? props.t("collection.dropPreview", "拖入图片绑定预览") : props.t("collection.selectModel", "从队列选择 LoRA")}</span><span className="text-xs">{props.t("collection.previewHint", "PNG、JPG、WEBP 或 AVIF")}</span></div>}
          </div>
          <input ref={previewInputRef} accept={IMAGE_EXTENSIONS.join(",")} className="sr-only" type="file" onChange={handlePreviewInput} />
          <div className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-xs text-muted-foreground">{selected?.previewName ?? props.t("collection.noPreview", "尚未绑定预览图")}</span><div className="flex shrink-0 gap-1"><Button disabled={!selected || inputDisabled || !props.clipboard?.readImage} size="xs" variant="outline" onClick={() => void pastePreview()}><ClipboardPaste data-icon="inline-start" />{props.t("collection.pastePreview", "粘贴图片")}</Button><Button disabled={!selected || inputDisabled} size="xs" variant="outline" onClick={() => void browsePreview()}><ImagePlus data-icon="inline-start" />{props.t("collection.bindPreview", "绑定图片")}</Button></div></div>
        </section>

        <section className="min-h-0 rounded-lg border bg-card p-3">
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={rootInputId}>{props.t("collection.libraryRoot", "LoRA 库目录")}</FieldLabel>
              <InputGroup><InputGroupAddon align="inline-start"><InputGroupText>~/</InputGroupText></InputGroupAddon><InputGroupInput id={rootInputId} disabled={props.disabled} placeholder="D:\\ComfyUI\\models\\loras" value={props.data.collectionRoot ?? ""} onChange={(event) => props.onPatch({ collectionRoot: event.currentTarget.value })} />{props.localFiles?.pickDirectory && <InputGroupAddon align="inline-end"><InputGroupButton aria-label={props.t("collection.pickRoot", "选择 LoRA 库目录")} disabled={props.disabled} size="icon-xs" onClick={() => void browseCollectionRoot()}><FolderOpen /></InputGroupButton></InputGroupAddon>}</InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor={targetInputId}>{props.t("collection.relativeDir", "相对存放目录")}</FieldLabel>
              <InputGroup><InputGroupAddon align="inline-start"><InputGroupText>/</InputGroupText></InputGroupAddon><InputGroupInput id={targetInputId} disabled={!selected || props.disabled} placeholder="style/mecha" value={selected?.targetRelativeDir ?? ""} onChange={(event) => patchSelected({ targetRelativeDir: event.currentTarget.value })} /></InputGroup>
              <DirectoryTags directories={directories} level={directoryLevel} loading={directoriesLoading} disabled={!selected || inputDisabled} onLevelChange={setDirectoryLevel} onSelect={selectDirectory} />
            </Field>
            <Field>
              <FieldTitle>{props.t("collection.triggers", "触发词")}</FieldTitle>
              <FieldContent>
                <TagsInput addOnPaste addOnTab className="w-full gap-1" delimiter="," disabled={!selected || inputDisabled} value={triggerTags} onValueChange={(values) => patchSelected({ triggerText: values.join(", ") })}>
                  <TagsInputList className="min-h-9 px-2 py-1"><TagsInputInput aria-label={props.t("collection.triggers", "触发词")} className="text-xs" placeholder={props.t("collection.addTrigger", "输入后按 Enter")}/>{triggerTags.map((tag) => <TagsInputItem key={tag} value={tag} className="px-2 py-0.5 text-xs">{tag}</TagsInputItem>)}</TagsInputList>
                </TagsInput>
                <FieldDescription>{props.t("collection.triggerHint", "提交时写入同名 .trigger.txt sidecar。")}</FieldDescription>
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${targetInputId}-source-url`}>{props.t("collection.sourceUrl", "来源网址")}</FieldLabel>
              <InputGroup><InputGroupInput id={`${targetInputId}-source-url`} disabled={!selected || inputDisabled} inputMode="url" placeholder="https://civitai.com/models/..." value={selected?.sourceUrl ?? ""} onChange={(event) => patchSelected({ sourceUrl: event.currentTarget.value })} /></InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${targetInputId}-notes`}>{props.t("collection.notes", "其他信息")}</FieldLabel>
              <Textarea id={`${targetInputId}-notes`} className="min-h-16 resize-y text-xs" disabled={!selected || inputDisabled} placeholder={props.t("collection.notesPlaceholder", "作者、版本、基础模型或其他说明") } value={selected?.notes ?? ""} onChange={(event) => patchSelected({ notes: event.currentTarget.value })} />
              <FieldDescription>{props.t("collection.metadataHint", "网址和其他信息会以 TOML 风格注释写入 .trigger.txt。")}</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <FieldContent><FieldLabel htmlFor={overwriteId}>{props.t("collection.overwrite", "覆盖已有文件")}</FieldLabel><FieldDescription>{props.t("collection.overwriteHint", "默认跳过同名目标文件。")}</FieldDescription></FieldContent>
              <Switch id={overwriteId} checked={props.data.collectionOverwrite ?? false} disabled={props.disabled} onCheckedChange={(collectionOverwrite) => props.onPatch({ collectionOverwrite })} />
            </Field>
            <Field orientation="horizontal">
              <FieldContent><FieldLabel htmlFor={`${overwriteId}-folder`}>{props.t("collection.createModelFolder", "每个 LoRA 单独建文件夹")}</FieldLabel><FieldDescription>{props.t("collection.createModelFolderHint", "把模型、预览图和 trigger.txt 放在同一个模型目录。")}</FieldDescription></FieldContent>
              <Switch id={`${overwriteId}-folder`} checked={props.data.collectionCreateModelFolder ?? false} disabled={props.disabled} onCheckedChange={(collectionCreateModelFolder) => props.onPatch({ collectionCreateModelFolder })} />
            </Field>
            <CollectionCommitButton canCollect={canCollect} running={props.running} t={props.t} onCollect={props.onCollect} />
          </FieldGroup>
        </section>
      </div>
    </div>
  )
}

function DropTarget(props: { description: string; disabled: boolean; dragging: boolean; icon: typeof Upload; label: string; onBrowse: () => void; targetProps: HTMLAttributes<HTMLDivElement>; testId: string }) {
  const Icon = props.icon
  return <div {...props.targetProps} data-testid={props.testId} className={cn("grid place-items-center gap-1.5 p-4 text-center transition-colors", props.dragging && "bg-primary/5 ring-2 ring-inset ring-primary/20")}><Icon className="text-muted-foreground" /><span className="text-sm font-medium">{props.label}</span><span className="text-xs text-muted-foreground">{props.description}</span><Button disabled={props.disabled} size="xs" variant="outline" onClick={props.onBrowse}>浏览文件</Button></div>
}

function DirectoryTags(props: { directories: Array<{ name: string; path: string }>; disabled: boolean; level: string; loading: boolean; onLevelChange: (level: string) => void; onSelect: (name: string) => void }) {
  const parts = normalizeRelativePath(props.level).split("/").filter(Boolean)
  return (
    <div className="grid gap-1.5" data-testid="lorat-directory-tags">
      <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Button aria-label="返回 LoRA 根目录" disabled={props.disabled || !parts.length} size="icon-xs" variant="ghost" onClick={() => props.onLevelChange("")}><Folder /></Button>
        {parts.map((part, index) => <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-1"><ChevronRight className="size-3 shrink-0" /><Button className="h-6 max-w-36 px-1.5" disabled={props.disabled} size="xs" variant="ghost" onClick={() => props.onLevelChange(parts.slice(0, index + 1).join("/"))}>{part}</Button></span>)}
        {props.loading && <LoaderCircle className="size-3 animate-spin" />}
      </div>
      <div aria-label="LoRA 子文件夹" className="flex min-h-7 flex-wrap gap-1" role="list">
        {props.directories.map((directory) => <span key={directory.path.replace(/\\/g, "/").toLowerCase()} className="min-w-0" role="listitem"><Button className="h-7 max-w-full px-2" disabled={props.disabled} size="xs" variant="outline" onClick={() => props.onSelect(directory.name)}><Folder data-icon="inline-start" /><span className="truncate">{directory.name}</span></Button></span>)}
        {!props.loading && !props.directories.length && <span className="text-xs text-muted-foreground">当前层没有子文件夹</span>}
      </div>
    </div>
  )
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

function fileName(path: string): string {
  return path.replaceAll("\\", "/").split("/").at(-1) ?? path
}

function hasExtension(name: string, extensions: string[]): boolean {
  return extensions.some((extension) => name.toLowerCase().endsWith(extension))
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  if (mimeType === "image/avif") return "avif"
  return "png"
}

function fileFromBase64(base64: string, mimeType: string, name: string): File {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], name, { type: mimeType })
}

async function fileFromNexusAttachment(attachment: NonNullable<NexusCaptureDTO["attachments"]>[number]): Promise<File> {
  const mimeType = attachment.mimeType || "image/png"
  const name = attachment.name || `nexus-image.${extensionForMimeType(mimeType)}`
  if (attachment.dataBase64) return fileFromBase64(attachment.dataBase64, mimeType, name)
  const response = await fetch(attachment.url)
  if (!response.ok) throw new Error(`Downloading the Nexus image returned ${response.status}.`)
  return new File([await response.blob()], name, { type: response.headers.get("content-type") || mimeType })
}

function suggestRelativeDir(path: string, name: string, createModelFolder: boolean): string {
  const normalized = path.replace(/\\/g, "/").toLowerCase()
  const matched = DIRECTORY_SUGGESTIONS.find((segment) => normalized.includes(`/${segment}/`))
  if (matched) return matched
  const stem = name.replace(/\.(safetensors|ckpt|pt)$/i, "").replace(/[_\s]+/g, "-").toLowerCase()
  return createModelFolder ? "uncategorized" : `uncategorized/${stem}`
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "")
}

function joinHostPath(root: string, relative: string): string {
  if (!relative) return root
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/"
  return `${root.replace(/[\\/]+$/, "")}${separator}${normalizeRelativePath(relative).replace(/\//g, separator)}`
}

function inferTrigger(name: string): string {
  return name.replace(/\.(safetensors|ckpt|pt)$/i, "").replace(/[-_ ]?(step\d+|v\d+|final)$/i, "").replace(/[_-]+/g, " ").trim()
}
