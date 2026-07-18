import { AlertCircle, Plus, Tags, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type {
  ReaderDirectoryEmmEditResultDto,
  ReaderDirectoryEntryDto,
  ReaderDirectorySelectionDescriptorDto,
  ReaderEmmMetadataPatchDto,
  ReaderEmmMetadataSnapshotDto,
  ReaderEmmTagDto,
  ReaderEmmTagSuggestionDto,
  ReaderHttpClient,
} from "../../../../adapters/reader-http-client"
import type { DirectoryCatalog } from "./DirectoryCatalog"

const MAX_EMM_TARGETS = 64
const MAX_MANUAL_TAGS = 256

type RatingMode = "keep" | "inherit" | "1" | "2" | "3" | "4" | "5"
type TagsMode = "keep" | "inherit" | "replace"

export type FolderCatalogUpdater = (catalog: DirectoryCatalog) => DirectoryCatalog

export default function FolderEmmEditor({
  client,
  sessionId,
  generation,
  selection,
  selectedCount,
  fallbackEntry,
  onCatalogUpdate,
  onRefresh,
  onClose,
}: {
  client: ReaderHttpClient
  sessionId: string
  generation: number
  selection: ReaderDirectorySelectionDescriptorDto
  selectedCount: number
  fallbackEntry: { path: string; name: string }
  onCatalogUpdate(update: FolderCatalogUpdater): void
  onRefresh(focusPath: string): Promise<void> | void
  onClose(): void
}) {
  const requestRef = useRef<AbortController>()
  const [targets, setTargets] = useState<readonly { path: string; metadata: ReaderEmmMetadataSnapshotDto }[]>([])
  const [suggestions, setSuggestions] = useState<readonly ReaderEmmTagSuggestionDto[]>([])
  const [ratingMode, setRatingMode] = useState<RatingMode>(selectedCount === 1 ? "inherit" : "keep")
  const [tagsMode, setTagsMode] = useState<TagsMode>(selectedCount === 1 ? "inherit" : "keep")
  const [tags, setTags] = useState<ReaderEmmTagDto[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "error" | "warning"; title: string; description: string }>()

  useEffect(() => {
    const request = new AbortController()
    requestRef.current = request
    void loadEditor(request.signal)
    return () => request.abort()
  }, [sessionId, generation])

  async function loadEditor(signal: AbortSignal) {
    setLoading(true)
    setFeedback(undefined)
    try {
      if (!client.readDirectoryEmm) throw new Error("当前后端不支持 EMM 元数据编辑。")
      const suggestionsPromise = client.suggestDirectoryEmmTags?.(12, signal).catch(() => []) ?? Promise.resolve([])
      const paths = await resolveTargetPaths(signal)
      const [snapshot, loadedSuggestions] = await Promise.all([
        client.readDirectoryEmm(sessionId, generation, paths, signal),
        suggestionsPromise,
      ])
      signal.throwIfAborted()
      setTargets(snapshot.items)
      setSuggestions(loadedSuggestions)
      initializeFields(snapshot.items)
    } catch (error) {
      if (!signal.aborted) setFeedback({ kind: "error", title: "无法加载 EMM 元数据", description: errorMessage(error) })
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }

  async function resolveTargetPaths(signal: AbortSignal): Promise<readonly string[]> {
    if (selectedCount <= 1) return [fallbackEntry.path]
    if (selectedCount > MAX_EMM_TARGETS) throw new Error(`一次最多编辑 ${MAX_EMM_TARGETS} 个项目，当前已选择 ${selectedCount} 个。`)
    if (!client.resolveDirectorySelection) throw new Error("当前后端无法解析跨分页选择。")
    const resolved = await client.resolveDirectorySelection(sessionId, selection, MAX_EMM_TARGETS, signal)
    if (resolved.selectedCount !== selectedCount || resolved.truncated || resolved.preview.length !== selectedCount) {
      throw new Error("所选项目未能完整解析，请刷新目录后重试。")
    }
    return resolved.preview
  }

  function initializeFields(items: readonly { metadata: ReaderEmmMetadataSnapshotDto }[]) {
    if (items.length !== 1) {
      setRatingMode("keep")
      setTagsMode("keep")
      setTags([])
      return
    }
    const overrides = items[0]!.metadata.overrides
    setRatingMode(overrides.rating ? String(overrides.rating) as RatingMode : "inherit")
    setTagsMode(overrides.manualTags ? "replace" : "inherit")
    setTags(overrides.manualTags ? [...overrides.manualTags] : [])
  }

  function appendSuggestion(suggestion: ReaderEmmTagSuggestionDto) {
    setTagsMode("replace")
    setTags((current) => dedupeTags([...current, { namespace: suggestion.category, tag: suggestion.tag }]))
  }

  async function submit() {
    const patch = buildPatch(ratingMode, tagsMode, tags)
    if (!patch) {
      setFeedback({ kind: "warning", title: "没有要应用的更改", description: "批量编辑时请选择评分或标签操作。" })
      return
    }
    const invalidTag = tagsMode === "replace" ? tags.find((value) => !value.namespace.trim() || !value.tag.trim()) : undefined
    if (invalidTag || tags.length > MAX_MANUAL_TAGS) {
      setFeedback({ kind: "error", title: "标签无效", description: `命名空间和标签不能为空，且最多 ${MAX_MANUAL_TAGS} 项。` })
      return
    }
    if (!client.editDirectoryEmm) {
      setFeedback({ kind: "error", title: "无法保存", description: "当前后端不支持 EMM 元数据编辑。" })
      return
    }

    const request = new AbortController()
    requestRef.current?.abort()
    requestRef.current = request
    const originals = new Map<string, ReaderDirectoryEntryDto>()
    const paths = targets.map((item) => item.path)
    onCatalogUpdate(optimisticEmmUpdater(paths, patch, originals))
    setSubmitting(true)
    setFeedback(undefined)
    try {
      const result = await client.editDirectoryEmm(sessionId, {
        generation,
        updates: targets.map((item) => ({
          path: item.path,
          expectedRevision: item.metadata.revision,
          patch,
        })),
      }, request.signal)
      request.signal.throwIfAborted()
      const failedPaths = result.results.flatMap((item) => item.status === "succeeded" ? [] : [targets[item.index]!.path])
      if (failedPaths.length) onCatalogUpdate(rollbackEmmUpdater(originals, new Set(failedPaths)))
      if (result.entries.length || result.generation !== null) {
        onCatalogUpdate(authoritativeEmmUpdater(result.entries, result.generation))
      }
      if (result.succeeded) {
        const firstSucceeded = result.results.find((item) => item.status === "succeeded")!
        if (result.refreshRequired) await onRefresh(targets[firstSucceeded.index]!.path)
      }
      request.signal.throwIfAborted()
      if (!result.conflicts && !result.failed) {
        onClose()
        return
      }
      await reloadAfterPartialResult(result, request.signal)
    } catch (error) {
      onCatalogUpdate(rollbackEmmUpdater(originals))
      if (!request.signal.aborted) setFeedback({ kind: "error", title: "保存失败", description: errorMessage(error) })
    } finally {
      if (!request.signal.aborted) setSubmitting(false)
    }
  }

  async function reloadAfterPartialResult(result: ReaderDirectoryEmmEditResultDto, signal: AbortSignal) {
    if (client.readDirectoryEmm) {
      const currentGeneration = result.generation ?? generation
      const snapshot = await client.readDirectoryEmm(sessionId, currentGeneration, targets.map((item) => item.path), signal)
      signal.throwIfAborted()
      setTargets(snapshot.items)
      initializeFields(snapshot.items)
    }
    setFeedback({
      kind: "warning",
      title: "部分项目未保存",
      description: `已保存 ${result.succeeded} 项，冲突 ${result.conflicts} 项，失败 ${result.failed} 项。内容已重新读取，请检查后重试。`,
    })
  }

  function close() {
    requestRef.current?.abort()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] p-0 sm:max-w-xl" data-neoview-folder-emm-editor="true">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="flex items-center gap-2"><Tags />编辑标签与评分</DialogTitle>
          <DialogDescription>
            {selectedCount > 1 ? `批量编辑 ${selectedCount} 个项目` : fallbackEntry.name}。保存只修改明确选择的字段。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 px-5">
          {loading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />正在读取元数据</div>
          ) : (
            <FieldGroup className="gap-5 py-1">
              {feedback ? (
                <Alert variant={feedback.kind === "error" ? "destructive" : "default"}>
                  <AlertCircle />
                  <AlertTitle>{feedback.title}</AlertTitle>
                  <AlertDescription>{feedback.description}</AlertDescription>
                </Alert>
              ) : null}

              <FieldSet>
                <FieldLegend variant="label">评分</FieldLegend>
                <ToggleGroup type="single" variant="outline" size="sm" value={ratingMode} onValueChange={(value) => { if (value) setRatingMode(value as RatingMode) }} aria-label="评分操作" className="max-w-full flex-wrap">
                  {selectedCount > 1 ? <ToggleGroupItem value="keep">保持</ToggleGroupItem> : null}
                  <ToggleGroupItem value="inherit">继承</ToggleGroupItem>
                  {[1, 2, 3, 4, 5].map((value) => <ToggleGroupItem key={value} value={String(value)} aria-label={`${value} 星`}>{value}</ToggleGroupItem>)}
                </ToggleGroup>
                <FieldDescription>“继承”会移除 XR 覆盖值，恢复旧 EMM 数据或默认评分。</FieldDescription>
              </FieldSet>

              <Separator />

              <FieldSet>
                <FieldLegend variant="label">手工标签</FieldLegend>
                <ToggleGroup type="single" variant="outline" size="sm" value={tagsMode} onValueChange={(value) => { if (value) setTagsMode(value as TagsMode) }} aria-label="标签操作">
                  {selectedCount > 1 ? <ToggleGroupItem value="keep">保持</ToggleGroupItem> : null}
                  <ToggleGroupItem value="inherit">继承</ToggleGroupItem>
                  <ToggleGroupItem value="replace">替换</ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>“替换”只写入下面的手工标签；原始 EMM 标签保持只读。</FieldDescription>
              </FieldSet>

              {tagsMode === "replace" ? (
                <Field>
                  <FieldLabel>标签列表</FieldLabel>
                  <div className="flex flex-col gap-2">
                    {tags.map((value, index) => (
                      <div key={index} className="grid grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)_auto] gap-2">
                        <Input aria-label={`标签 ${index + 1} 命名空间`} value={value.namespace} placeholder="namespace" onChange={(event) => setTags((current) => replaceTag(current, index, { ...value, namespace: event.target.value }))} />
                        <Input aria-label={`标签 ${index + 1} 名称`} value={value.tag} placeholder="tag" onChange={(event) => setTags((current) => replaceTag(current, index, { ...value, tag: event.target.value }))} />
                        <Button type="button" size="icon" variant="ghost" aria-label={`删除标签 ${index + 1}`} onClick={() => setTags((current) => current.filter((_, currentIndex) => currentIndex !== index))}><Trash2 /></Button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" className="self-start" disabled={tags.length >= MAX_MANUAL_TAGS} onClick={() => setTags((current) => [...current, { namespace: "", tag: "" }])}><Plus data-icon="inline-start" />添加标签</Button>
                  </div>
                </Field>
              ) : null}

              {suggestions.length ? (
                <Field>
                  <FieldLabel>收藏与常用标签</FieldLabel>
                  <div className="flex flex-wrap gap-2" data-neoview-emm-suggestions="true">
                    {suggestions.map((value) => (
                      <Button key={`${value.category}:${value.tag}`} type="button" variant="outline" size="sm" onClick={() => appendSuggestion(value)}>
                        {value.favorite ? "★ " : ""}{value.translatedTag ?? value.tag}
                        <Badge variant="secondary">{value.category}</Badge>
                      </Button>
                    ))}
                  </div>
                </Field>
              ) : null}
            </FieldGroup>
          )}
        </ScrollArea>

        <DialogFooter className="border-t px-5 py-4">
          <Button type="button" variant="outline" onClick={close}>取消</Button>
          <Button type="button" disabled={loading || submitting || !targets.length} onClick={() => { void submit() }}>
            {submitting ? <Spinner data-icon="inline-start" /> : null}保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function buildPatch(ratingMode: RatingMode, tagsMode: TagsMode, tags: readonly ReaderEmmTagDto[]): ReaderEmmMetadataPatchDto | undefined {
  const patch: ReaderEmmMetadataPatchDto = {}
  if (ratingMode === "inherit") patch.rating = null
  else if (ratingMode !== "keep") patch.rating = Number(ratingMode)
  if (tagsMode === "inherit") patch.manualTags = null
  else if (tagsMode === "replace") patch.manualTags = dedupeTags(tags.map((value) => ({ namespace: value.namespace.trim(), tag: value.tag.trim() })))
  return Object.keys(patch).length ? patch : undefined
}

function optimisticEmmUpdater(
  paths: readonly string[],
  patch: ReaderEmmMetadataPatchDto,
  originals: Map<string, ReaderDirectoryEntryDto>,
): FolderCatalogUpdater {
  const keys = new Set(paths.map(normalizePath))
  return (catalog) => mapCatalogEntries(catalog, (entry) => {
    if (!keys.has(normalizePath(entry.path))) return entry
    if (!originals.has(normalizePath(entry.path))) originals.set(normalizePath(entry.path), entry)
    return {
      ...entry,
      ...(patch.rating !== undefined ? { rating: patch.rating ?? undefined } : {}),
      ...(patch.manualTags !== undefined ? { tags: patch.manualTags?.map((value) => `${value.namespace}:${value.tag}`) } : {}),
    }
  })
}

function rollbackEmmUpdater(originals: ReadonlyMap<string, ReaderDirectoryEntryDto>, paths?: ReadonlySet<string>): FolderCatalogUpdater {
  const normalizedPaths = paths ? new Set([...paths].map(normalizePath)) : undefined
  return (catalog) => mapCatalogEntries(catalog, (entry) => {
    const key = normalizePath(entry.path)
    if (normalizedPaths && !normalizedPaths.has(key)) return entry
    return originals.get(key) ?? entry
  })
}

function authoritativeEmmUpdater(
  entries: readonly ReaderDirectoryEntryDto[],
  generation: number | null,
): FolderCatalogUpdater {
  const replacements = new Map(entries.map((entry) => [normalizePath(entry.path), entry]))
  return (catalog) => {
    const projected = mapCatalogEntries(catalog, (entry) => replacements.get(normalizePath(entry.path)) ?? entry)
    return generation === null || generation === projected.generation ? projected : { ...projected, generation }
  }
}

function mapCatalogEntries(catalog: DirectoryCatalog, project: (entry: ReaderDirectoryEntryDto) => ReaderDirectoryEntryDto): DirectoryCatalog {
  let changed = false
  const pages = new Map([...catalog.pages].map(([cursor, entries]) => {
    const next = entries.map((entry) => {
      const projected = project(entry)
      if (projected !== entry) changed = true
      return projected
    })
    return [cursor, next] as const
  }))
  return changed ? { ...catalog, pages } : catalog
}

function replaceTag(values: readonly ReaderEmmTagDto[], index: number, value: ReaderEmmTagDto): ReaderEmmTagDto[] {
  return values.map((current, currentIndex) => currentIndex === index ? value : current)
}

function dedupeTags(values: readonly ReaderEmmTagDto[]): ReaderEmmTagDto[] {
  return [...new Map(values.map((value) => [`${value.namespace.toLocaleLowerCase()}\0${value.tag.toLocaleLowerCase()}`, value])).values()]
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").toLocaleLowerCase("en-US")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
