import type { InteractionValues, TerminalInteractionDefinition, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import { dirname, resolve } from "node:path"
import type {
  HeadlessReaderBookSettingsUpdate,
  HeadlessReaderSnapshot,
  OpenHeadlessReaderInput,
  ReaderBookSettingsPatch,
  ReaderBookSettingsSnapshot,
  ReaderDirectoryFilter,
} from "./core.js"
import type { ReaderFileTreeHeadlessController } from "./core.js"
import type { ReaderLibraryHeadlessController } from "./core.js"
import type { ReaderFileMutation, ReaderFileOperationService } from "./core.js"
import { createReaderFileOperationService, createReaderFileTreeController, createReaderHeadlessController, createReaderLibraryHeadlessController } from "./platform.js"

export interface NeoviewTuiInput {
  path: string
}

export interface NeoviewTuiResult {
  success: boolean
  message: string
  snapshot?: HeadlessReaderSnapshot
}

export interface NeoviewBookSettingsTuiInput {
  action: "get" | "set"
  path: string
  patch?: ReaderBookSettingsPatch
}

export interface NeoviewBookSettingsTuiResult {
  success: boolean
  message: string
  settings?: ReaderBookSettingsSnapshot
  reader?: HeadlessReaderSnapshot
}

export interface NeoviewBookSettingsTuiPort extends AsyncDisposable {
  open(input: OpenHeadlessReaderInput): Promise<HeadlessReaderSnapshot>
  getBookSettings(signal?: AbortSignal): Promise<ReaderBookSettingsSnapshot>
  updateBookSettings(expectedRevision: number, patch: ReaderBookSettingsPatch, signal?: AbortSignal): Promise<HeadlessReaderBookSettingsUpdate>
}

export type NeoviewFileTreeTuiAction =
  | "tree" | "search" | "exclude" | "include" | "clear-cache"
  | "history" | "delete-history" | "clear-history"

export interface NeoviewFileTreeTuiInput {
  action: NeoviewFileTreeTuiAction
  path: string
  query?: string
  mode?: "text" | "glob"
  maximumDepth?: number
  maximumResults?: number
  caseSensitive?: boolean
  searchInPath?: boolean
  filter?: ReaderDirectoryFilter
  scope?: "folder" | "file" | "bookmark" | "history"
}

export interface NeoviewFileTreeTuiResult {
  success: boolean
  message: string
  paths?: readonly string[]
}

export type NeoviewLibraryTuiAction =
  | "list-recents" | "cleanup-recents" | "delete-recent"
  | "cleanup-invalid"
  | "list-bookmarks" | "add-bookmark" | "delete-bookmark"
  | "list-bookmark-lists" | "add-bookmark-list" | "delete-bookmark-list"

export interface NeoviewLibraryTuiInput {
  action: NeoviewLibraryTuiAction
  path?: string
  id?: string
  name?: string
  listId?: string
  before?: number
  limit?: number
  starred?: boolean
  favorite?: boolean
  cleanupKind?: "recents" | "bookmarks" | "both"
  concurrency?: number
  filter?: ReaderDirectoryFilter
}

export interface NeoviewLibraryTuiResult {
  success: boolean
  message: string
  lines?: readonly string[]
}

export type NeoviewFileOperationTuiAction = "copy" | "move" | "rename" | "delete" | "trash" | "create-directory" | "undo" | "discard-undo"

export interface NeoviewFileOperationTuiInput {
  action: NeoviewFileOperationTuiAction
  sourcePath?: string
  destinationPath?: string
  overwrite?: boolean
}

export interface NeoviewFileOperationTuiResult {
  success: boolean
  message: string
  lines?: readonly string[]
}

export function createNeoviewTuiDefinition(
  language: "zh" | "en" = "zh",
): TerminalInteractionDefinition<NeoviewTuiInput, NeoviewTuiResult> {
  return {
    schema: createNeoviewTuiSchema(language),
    async run(input) {
      const controller = await createReaderHeadlessController()
      try {
        const snapshot = await controller.open({ path: input.path })
        return { success: true, message: `Opened ${snapshot.book.displayName}.`, snapshot }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      } finally {
        await controller[Symbol.asyncDispose]()
      }
    },
  }
}

export function createNeoviewBookSettingsTuiDefinition(
  language: "zh" | "en" = "zh",
  createController: () => Promise<NeoviewBookSettingsTuiPort> = createReaderHeadlessController,
  archivePasswords?: OpenHeadlessReaderInput["archivePasswords"],
): TerminalInteractionDefinition<NeoviewBookSettingsTuiInput, NeoviewBookSettingsTuiResult> {
  return {
    schema: createNeoviewBookSettingsTuiSchema(language),
    async run(input) {
      const controller = await createController()
      try {
        await controller.open({ path: input.path, archivePasswords })
        const current = await controller.getBookSettings()
        if (input.action === "get") {
          return { success: true, message: `Book settings revision ${current.revision}.`, settings: current }
        }
        const updated = await controller.updateBookSettings(current.revision, input.patch ?? {})
        return {
          success: true,
          message: `Book settings updated to revision ${updated.settings.revision}.`,
          settings: updated.settings,
          reader: updated.reader,
        }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      } finally {
        await controller[Symbol.asyncDispose]()
      }
    },
  }
}

export function createNeoviewFileTreeTuiDefinition(
  language: "zh" | "en" = "zh",
  createController: () => Promise<ReaderFileTreeHeadlessController> = createReaderFileTreeController,
): TerminalInteractionDefinition<NeoviewFileTreeTuiInput, NeoviewFileTreeTuiResult> {
  let active: ReaderFileTreeHeadlessController | undefined
  return {
    schema: createNeoviewFileTreeTuiSchema(language),
    async run(input, onEvent) {
      const controller = await createController()
      active = controller
      try {
        const needsTreeSession = input.action !== "history" && input.action !== "delete-history" && input.action !== "clear-history"
        if (needsTreeSession) {
          await controller.open({ path: input.action === "exclude" || input.action === "include" ? dirname(input.path) : input.path })
        }
        if (input.action === "tree") {
          const page = await controller.tree()
          const paths = page?.entries.map((entry) => entry.path) ?? []
          return { success: true, message: `${paths.length} child directories.`, paths }
        }
        if (input.action === "search") {
          await controller.setFilter(input.filter ?? "all")
          const handle = controller.search(input.query ?? "", {
            mode: input.mode,
            caseSensitive: input.caseSensitive,
            searchInPath: input.searchInPath,
            maximumDepth: input.maximumDepth,
            maximumResults: input.maximumResults,
          })
          const paths: string[] = []
          try {
            for await (const event of handle.events) {
              if (event.type === "entry") {
                paths.push(event.entry.path)
                onEvent({ type: "progress", message: event.entry.path })
              }
            }
          } finally {
            await handle.close()
          }
          await controller.recordSearchHistory("folder", input.query ?? "")
          return { success: true, message: `${paths.length} matches.`, paths }
        }
        if (input.action === "history") {
          const entries = await controller.listSearchHistory(input.scope ?? "folder", input.maximumResults ?? 20)
          return { success: true, message: `${entries.length} history entries.`, paths: entries.map((entry) => entry.query) }
        }
        if (input.action === "delete-history") {
          const removed = await controller.removeSearchHistory(input.scope ?? "folder", input.query ?? "")
          return { success: true, message: removed ? "Search history entry removed." : "Search history entry not found." }
        }
        if (input.action === "clear-history") {
          const cleared = await controller.clearSearchHistory(input.scope ?? "folder")
          return { success: true, message: `${cleared} search history entries cleared.` }
        }
        if (input.action === "clear-cache") {
          const snapshot = controller.clearCache()
          return { success: true, message: `Tree cache cleared; remaining=${snapshot?.size ?? 0}.` }
        }
        const action = input.action === "exclude" ? "exclude" : "include"
        const snapshot = await controller.updateExclusion({ action, path: input.path })
        return { success: true, message: `${action === "exclude" ? "Excluded" : "Included"}: ${input.path}`, paths: snapshot?.excludedPaths }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      } finally {
        if (active === controller) active = undefined
        await controller[Symbol.asyncDispose]()
      }
    },
    cancel: async () => {
      const controller = active
      active = undefined
      await controller?.[Symbol.asyncDispose]()
    },
  }
}

export function createNeoviewLibraryTuiDefinition(
  language: "zh" | "en" = "zh",
  createController: () => Promise<ReaderLibraryHeadlessController> = createReaderLibraryHeadlessController,
): TerminalInteractionDefinition<NeoviewLibraryTuiInput, NeoviewLibraryTuiResult> {
  return {
    schema: createNeoviewLibraryTuiSchema(language),
    async run(input) {
      const controller = await createController()
      try {
        const limit = input.limit ?? 100
        if (input.action === "list-recents") return itemsResult(await controller.listRecent(limit, 0, input.filter ?? "all"), "recent entries")
        if (input.action === "cleanup-recents") {
          const deleted = await controller.clearRecentBefore(input.before ?? 0, Math.min(limit, 500))
          return { success: true, message: `${deleted} recent entries deleted.` }
        }
        if (input.action === "cleanup-invalid") {
          const result = await controller.cleanupInvalid({
            kind: input.cleanupKind ?? "both",
            scanLimit: limit,
            deleteLimit: limit,
            concurrency: input.concurrency ?? 8,
          })
          return { success: true, message: `${result.deleted}/${result.missing} invalid entries deleted.`, lines: [JSON.stringify(result)] }
        }
        if (input.action === "delete-recent") return mutationResult(await controller.removeRecent(input.id ?? ""), "Recent entry")
        if (input.action === "list-bookmarks") return itemsResult(await controller.listBookmarks(input.listId, limit, 0, input.filter ?? "all"), "bookmarks")
        if (input.action === "add-bookmark") {
          const item = await controller.savePathBookmark({
            path: input.path ?? "",
            name: input.name,
            starred: input.starred,
            listIds: input.listId ? [input.listId] : undefined,
          })
          return { success: true, message: "Bookmark saved.", lines: [JSON.stringify(item)] }
        }
        if (input.action === "delete-bookmark") return mutationResult(await controller.removeBookmark(input.id ?? ""), "Bookmark")
        if (input.action === "list-bookmark-lists") return itemsResult(await controller.listBookmarkLists(), "bookmark lists")
        if (input.action === "add-bookmark-list") {
          const item = await controller.saveBookmarkList({ id: input.id, name: input.name ?? "", isFavorite: input.favorite })
          return { success: true, message: "Bookmark list saved.", lines: [JSON.stringify(item)] }
        }
        return mutationResult(await controller.removeBookmarkList(input.id ?? ""), "Bookmark list")
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      } finally {
        await controller[Symbol.asyncDispose]()
      }
    },
  }
}

export function createNeoviewFileOperationTuiDefinition(
  language: "zh" | "en" = "zh",
  createService: () => Promise<ReaderFileOperationService> = createReaderFileOperationService,
): TerminalInteractionDefinition<NeoviewFileOperationTuiInput, NeoviewFileOperationTuiResult> {
  let service: Promise<ReaderFileOperationService> | undefined
  const getService = () => service ??= createService()
  return {
    schema: createNeoviewFileOperationTuiSchema(language),
    async run(input) {
      try {
        if (input.action === "undo") {
          const result = await (await getService()).undoLatest()
          return {
            success: result.failed === 0 && result.succeeded > 0,
            message: result.succeeded > 0 ? `${result.succeeded} operation(s) undone.` : "No operation is available to undo.",
            lines: result.results.map((item) => JSON.stringify(item)),
          }
        }
        if (input.action === "discard-undo") {
          const result = await (await getService()).discardLatest()
          return {
            success: result.discarded,
            message: result.discarded ? "Latest undo transaction discarded." : "No undo transaction is available.",
            lines: [JSON.stringify(result)],
          }
        }
        const operation = fileOperationFromInput(input)
        const result = await (await getService()).execute({ operations: [operation], concurrency: 1 })
        const item = result.results[0]!
        return {
          success: item.status === "succeeded",
          message: item.status === "succeeded" ? `${operation.kind} completed.` : item.error ?? `${operation.kind} ${item.status}.`,
          lines: [JSON.stringify(item)],
        }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

function createNeoviewTuiSchema(language: "zh" | "en"): TerminalInteractionSchema<NeoviewTuiInput, NeoviewTuiResult> {
  const zh = language === "zh"
  return {
    id: "neoview",
    title: "NeoView",
    description: zh ? "图像与漫画阅读工作台" : "Image and comic reader workbench",
    initialValues: { path: "" },
    fields: [{
      id: "path",
      label: zh ? "书籍路径" : "Book path",
      kind: "text",
      placeholder: zh ? "图像、目录、CBZ、CBR 或 CB7" : "Image, directory, CBZ, CBR or CB7",
    }],
    toInput: (values: Readonly<InteractionValues>) => ({ path: String(values.path ?? "").trim() }),
    validate: (_values, input) => input.path ? null : zh ? "请输入书籍路径。" : "Enter a book path.",
    preview: (input) => [input.path],
    isDangerous: () => false,
    result: (result) => ({
      success: result.success,
      message: result.message,
      lines: result.snapshot ? [`${result.snapshot.book.pageCount} page(s)`] : [],
    }),
  }
}

function createNeoviewBookSettingsTuiSchema(
  language: "zh" | "en",
): TerminalInteractionSchema<NeoviewBookSettingsTuiInput, NeoviewBookSettingsTuiResult> {
  const zh = language === "zh"
  const setting = (values: Readonly<InteractionValues>) => values.action === "set"
  const keep = zh ? "保持不变" : "Keep unchanged"
  const inherit = zh ? "继承全局" : "Inherit global"
  return {
    id: "neoview-book-settings",
    title: zh ? "NeoView 本书设置" : "NeoView Book Settings",
    description: zh ? "读取或更新规范的本书覆盖" : "Read or update canonical per-book overrides",
    initialValues: {
      action: "get",
      path: "",
      favorite: "keep",
      rating: "keep",
      direction: "keep",
      pageMode: "keep",
      horizontalBook: "keep",
    },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: [
        { value: "get", label: zh ? "查看" : "Get" },
        { value: "set", label: zh ? "更新" : "Set" },
      ] },
      { id: "path", label: zh ? "书籍路径" : "Book path", kind: "text" },
      { id: "favorite", label: zh ? "收藏" : "Favorite", kind: "select", visibleWhen: setting, options: [
        { value: "keep", label: keep }, { value: "inherit", label: inherit },
        { value: "true", label: zh ? "收藏" : "Favorite" }, { value: "false", label: zh ? "不收藏" : "Not favorite" },
      ] },
      { id: "rating", label: zh ? "评分" : "Rating", kind: "select", visibleWhen: setting, options: [
        { value: "keep", label: keep }, { value: "inherit", label: inherit },
        ...[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} / 5` })),
      ] },
      { id: "direction", label: zh ? "阅读方向" : "Direction", kind: "select", visibleWhen: setting, options: [
        { value: "keep", label: keep }, { value: "inherit", label: inherit },
        { value: "left-to-right", label: zh ? "从左到右" : "Left to right" },
        { value: "right-to-left", label: zh ? "从右到左" : "Right to left" },
      ] },
      { id: "pageMode", label: zh ? "页面模式" : "Page mode", kind: "select", visibleWhen: setting, options: [
        { value: "keep", label: keep }, { value: "inherit", label: inherit },
        { value: "single", label: zh ? "单页" : "Single" }, { value: "double", label: zh ? "双页" : "Double" },
      ] },
      { id: "horizontalBook", label: zh ? "横版本子" : "Horizontal book", kind: "select", visibleWhen: setting, options: [
        { value: "keep", label: keep }, { value: "inherit", label: inherit },
        { value: "true", label: zh ? "启用" : "Enabled" }, { value: "false", label: zh ? "禁用" : "Disabled" },
      ] },
    ],
    toInput: (values) => ({
      action: values.action === "set" ? "set" : "get",
      path: String(values.path ?? "").trim(),
      patch: values.action === "set" ? bookSettingsPatchFromInteraction(values) : undefined,
    }),
    validate: (_values, input) => !input.path
      ? (zh ? "请输入书籍路径。" : "Enter a book path.")
      : input.action === "set" && !Object.keys(input.patch ?? {}).length
        ? (zh ? "至少选择一项要更新的设置。" : "Select at least one setting to update.")
        : null,
    preview: (input) => [input.path, input.action, ...Object.entries(input.patch ?? {}).map(([key, value]) => `${key}=${String(value)}`)],
    isDangerous: () => false,
    result: (result) => ({
      success: result.success,
      message: result.message,
      lines: result.settings ? bookSettingsResultLines(result.settings) : [],
    }),
  }
}

function bookSettingsPatchFromInteraction(values: Readonly<InteractionValues>): ReaderBookSettingsPatch {
  const patch: ReaderBookSettingsPatch = {}
  const favorite = interactionBooleanOverride(values.favorite)
  const horizontalBook = interactionBooleanOverride(values.horizontalBook)
  const rating = values.rating === "inherit" ? null : /^[1-5]$/.test(String(values.rating ?? "")) ? Number(values.rating) : undefined
  const direction = values.direction === "inherit" ? null
    : values.direction === "left-to-right" || values.direction === "right-to-left" ? values.direction : undefined
  const pageMode = values.pageMode === "inherit" ? null
    : values.pageMode === "single" || values.pageMode === "double" ? values.pageMode : undefined
  if (favorite !== undefined) patch.favorite = favorite
  if (rating !== undefined) patch.rating = rating
  if (direction !== undefined) patch.direction = direction
  if (pageMode !== undefined) patch.pageMode = pageMode
  if (horizontalBook !== undefined) patch.horizontalBook = horizontalBook
  return patch
}

function interactionBooleanOverride(value: unknown): boolean | null | undefined {
  if (value === "inherit") return null
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

function bookSettingsResultLines(settings: ReaderBookSettingsSnapshot): string[] {
  return (["favorite", "rating", "direction", "pageMode", "horizontalBook"] as const).map((key) => (
    `${key}: ${String(settings.effective[key])} (${settings.inherited.includes(key) ? "inherited" : "override"})`
  ))
}

const READER_DIRECTORY_FILTER_OPTIONS: Array<{ value: ReaderDirectoryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "archive", label: "Archive" },
  { value: "directory", label: "Directory" },
  { value: "video", label: "Video" },
]

function readerDirectoryFilterValue(value: unknown): ReaderDirectoryFilter {
  return value === "archive" || value === "directory" || value === "video" ? value : "all"
}

function createNeoviewFileTreeTuiSchema(language: "zh" | "en"): TerminalInteractionSchema<NeoviewFileTreeTuiInput, NeoviewFileTreeTuiResult> {
  const zh = language === "zh"
  const search = (values: Readonly<InteractionValues>) => values.action === "search"
  const query = (values: Readonly<InteractionValues>) => values.action === "search" || values.action === "delete-history"
  const history = (values: Readonly<InteractionValues>) => values.action === "history" || values.action === "delete-history" || values.action === "clear-history"
  const needsPath = (action: NeoviewFileTreeTuiAction) => action !== "history" && action !== "delete-history" && action !== "clear-history"
  return {
    id: "neoview-file-tree",
    title: "NeoView File Tree",
    description: zh ? "目录树、递归搜索与排除规则" : "Directory tree, recursive search and exclusions",
    initialValues: { action: "tree", path: "", query: "", mode: "text", filter: "all", maximumDepth: 10, maximumResults: 512, caseSensitive: false, searchInPath: false },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: [
        { value: "tree", label: zh ? "展开树节点" : "Expand tree node" },
        { value: "search", label: zh ? "递归搜索" : "Recursive search" },
        { value: "exclude", label: zh ? "排除目录" : "Exclude directory" },
        { value: "include", label: zh ? "取消排除" : "Include directory" },
        { value: "clear-cache", label: zh ? "清理树缓存" : "Clear tree cache" },
        { value: "history", label: zh ? "搜索历史" : "Search history" },
        { value: "delete-history", label: zh ? "删除搜索记录" : "Delete search entry" },
        { value: "clear-history", label: zh ? "清空搜索历史" : "Clear search history" },
      ] },
      { id: "path", label: zh ? "目录路径" : "Directory path", kind: "text" },
      { id: "query", label: zh ? "搜索内容" : "Query", kind: "text", visibleWhen: query },
      { id: "scope", label: zh ? "历史范围" : "History scope", kind: "select", options: [
        { value: "folder", label: zh ? "文件夹" : "Folder" },
        { value: "file", label: zh ? "文件" : "File" },
        { value: "bookmark", label: zh ? "书签" : "Bookmark" },
        { value: "history", label: zh ? "阅读历史" : "Reading history" },
      ], visibleWhen: history },
      { id: "mode", label: zh ? "匹配方式" : "Match mode", kind: "select", options: [{ value: "text", label: zh ? "文本" : "Text" }, { value: "glob", label: "Glob" }], visibleWhen: search },
      { id: "filter", label: zh ? "类型筛选" : "Type filter", kind: "select", options: READER_DIRECTORY_FILTER_OPTIONS, visibleWhen: search },
      { id: "maximumDepth", label: zh ? "最大深度" : "Maximum depth", kind: "number", min: 0, max: 4096, step: 1, visibleWhen: search },
      { id: "maximumResults", label: zh ? "结果上限" : "Result limit", kind: "number", min: 1, max: 10000, step: 1, visibleWhen: search },
      { id: "caseSensitive", label: zh ? "区分大小写" : "Case sensitive", kind: "boolean", visibleWhen: search },
      { id: "searchInPath", label: zh ? "匹配相对路径" : "Match relative paths", kind: "boolean", visibleWhen: search },
    ],
    toInput: (values) => ({
      action: isFileTreeAction(values.action) ? values.action : "tree",
      path: String(values.path ?? "").trim(),
      query: String(values.query ?? "").trim(),
      mode: values.mode === "glob" ? "glob" : "text",
      filter: readerDirectoryFilterValue(values.filter),
      maximumDepth: Number(values.maximumDepth ?? 10),
      maximumResults: Number(values.maximumResults ?? 512),
      caseSensitive: values.caseSensitive === true,
      searchInPath: values.searchInPath === true,
      scope: isSearchHistoryScope(values.scope) ? values.scope : "folder",
    }),
    validate: (_values, input) => needsPath(input.action) && !input.path
      ? (zh ? "请输入目录路径。" : "Enter a directory path.")
      : (input.action === "search" || input.action === "delete-history") && !input.query
        ? (zh ? "请输入搜索内容。" : "Enter a search query.")
        : null,
    preview: (input) => [input.path, input.action === "search" ? `${input.mode}: ${input.query}` : input.action],
    isDangerous: (input) => input.action === "exclude" || input.action === "include" || input.action === "clear-cache" || input.action === "delete-history" || input.action === "clear-history",
    dangerPrompt: (input) => ({
      title: zh ? "确认文件树操作" : "Confirm file-tree operation",
      body: input.action === "clear-cache"
        ? (zh ? "将清理当前有界树缓存。" : "The bounded file-tree cache will be cleared.")
        : input.action === "delete-history" || input.action === "clear-history"
          ? (zh ? "将删除 NeoView 主数据库中的搜索历史。" : "This removes search history from the NeoView primary database.")
        : (zh ? "将修改 [nodes.neoview.folder.tree] 排除设置。" : "This changes [nodes.neoview.folder.tree] exclusions."),
      confirmLabel: zh ? "确认" : "Confirm",
    }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.paths }),
  }
}

function createNeoviewLibraryTuiSchema(language: "zh" | "en"): TerminalInteractionSchema<NeoviewLibraryTuiInput, NeoviewLibraryTuiResult> {
  const zh = language === "zh"
  const actionIs = (...actions: NeoviewLibraryTuiAction[]) => (values: Readonly<InteractionValues>) => actions.includes(values.action as NeoviewLibraryTuiAction)
  const destructive = new Set<NeoviewLibraryTuiAction>(["cleanup-recents", "cleanup-invalid", "delete-recent", "delete-bookmark", "delete-bookmark-list"])
  return {
    id: "neoview-library",
    title: "NeoView Library",
    description: zh ? "最近阅读、书签和书签列表" : "Recent reading, bookmarks and bookmark lists",
    initialValues: { action: "list-recents", path: "", id: "", name: "", listId: "", filter: "all", before: Date.now(), limit: 100, starred: false, favorite: false },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: LIBRARY_ACTIONS.map(([value, en, cn]) => ({ value, label: zh ? cn : en })) },
      { id: "path", label: zh ? "路径" : "Path", kind: "text", visibleWhen: actionIs("add-bookmark") },
      { id: "id", label: "ID", kind: "text", visibleWhen: actionIs("delete-recent", "delete-bookmark", "add-bookmark-list", "delete-bookmark-list") },
      { id: "name", label: zh ? "名称" : "Name", kind: "text", visibleWhen: actionIs("add-bookmark", "add-bookmark-list") },
      { id: "listId", label: zh ? "书签列表 ID" : "Bookmark list ID", kind: "text", visibleWhen: actionIs("list-bookmarks", "add-bookmark") },
      { id: "filter", label: zh ? "类型筛选" : "Type filter", kind: "select", options: READER_DIRECTORY_FILTER_OPTIONS, visibleWhen: actionIs("list-recents", "list-bookmarks") },
      { id: "before", label: zh ? "早于时间戳" : "Before timestamp", kind: "number", min: 0, max: Number.MAX_SAFE_INTEGER, step: 1, visibleWhen: actionIs("cleanup-recents") },
      { id: "cleanupKind", label: zh ? "清理范围" : "Cleanup scope", kind: "select", options: [
        { value: "both", label: zh ? "历史与书签" : "Recents and bookmarks" },
        { value: "recents", label: zh ? "历史" : "Recents" },
        { value: "bookmarks", label: zh ? "书签" : "Bookmarks" },
      ], visibleWhen: actionIs("cleanup-invalid") },
      { id: "limit", label: zh ? "数量上限" : "Limit", kind: "number", min: 1, max: 500, step: 1, visibleWhen: actionIs("list-recents", "cleanup-recents", "cleanup-invalid", "list-bookmarks") },
      { id: "concurrency", label: zh ? "检查并发" : "Check concurrency", kind: "number", min: 1, max: 16, step: 1, visibleWhen: actionIs("cleanup-invalid") },
      { id: "starred", label: zh ? "收藏" : "Starred", kind: "boolean", visibleWhen: actionIs("add-bookmark") },
      { id: "favorite", label: zh ? "收藏列表" : "Favorite list", kind: "boolean", visibleWhen: actionIs("add-bookmark-list") },
    ],
    toInput: (values) => ({
      action: isLibraryAction(values.action) ? values.action : "list-recents",
      path: String(values.path ?? "").trim(),
      id: String(values.id ?? "").trim(),
      name: String(values.name ?? "").trim(),
      listId: String(values.listId ?? "").trim() || undefined,
      filter: readerDirectoryFilterValue(values.filter),
      before: Number(values.before ?? 0),
      limit: Number(values.limit ?? 100),
      starred: values.starred === true,
      favorite: values.favorite === true,
      cleanupKind: values.cleanupKind === "recents" || values.cleanupKind === "bookmarks" ? values.cleanupKind : "both",
      concurrency: Number(values.concurrency ?? 8),
    }),
    validate: (_values, input) => input.action === "add-bookmark" && !input.path
      ? (zh ? "请输入书签路径。" : "Enter a bookmark path.")
      : input.action === "add-bookmark-list" && !input.name
        ? (zh ? "请输入列表名称。" : "Enter a list name.")
        : (input.action === "delete-recent" || input.action === "delete-bookmark" || input.action === "delete-bookmark-list") && !input.id
          ? (zh ? "请输入 ID。" : "Enter an ID.")
          : null,
    preview: (input) => [input.action, input.path || input.id || input.name || ""].filter(Boolean),
    isDangerous: (input) => destructive.has(input.action),
    dangerPrompt: () => ({ title: zh ? "确认删除" : "Confirm deletion", body: zh ? "该操作会修改 NeoView 主数据库。" : "This operation modifies the NeoView primary database.", confirmLabel: zh ? "确认" : "Confirm" }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.lines }),
  }
}

function createNeoviewFileOperationTuiSchema(language: "zh" | "en"): TerminalInteractionSchema<NeoviewFileOperationTuiInput, NeoviewFileOperationTuiResult> {
  const zh = language === "zh"
  const needsSource = (values: Readonly<InteractionValues>) => values.action !== "create-directory" && values.action !== "undo" && values.action !== "discard-undo"
  const needsDestination = (values: Readonly<InteractionValues>) => values.action === "copy" || values.action === "move" || values.action === "rename" || values.action === "create-directory"
  const supportsOverwrite = (values: Readonly<InteractionValues>) => values.action === "copy" || values.action === "move" || values.action === "rename"
  return {
    id: "neoview-file-operations",
    title: "NeoView File Operations",
    description: zh ? "复制、移动、重命名、删除与新建目录" : "Copy, move, rename, delete and create directories",
    initialValues: { action: "copy", sourcePath: "", destinationPath: "", overwrite: false },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: FILE_OPERATION_ACTIONS.map(([value, en, cn]) => ({ value, label: zh ? cn : en })) },
      { id: "sourcePath", label: zh ? "源路径" : "Source path", kind: "text", visibleWhen: needsSource },
      { id: "destinationPath", label: zh ? "目标路径" : "Destination path", kind: "text", visibleWhen: needsDestination },
      { id: "overwrite", label: zh ? "允许覆盖" : "Allow overwrite", kind: "boolean", visibleWhen: supportsOverwrite },
    ],
    toInput: (values) => ({
      action: isFileOperationAction(values.action) ? values.action : "copy",
      sourcePath: String(values.sourcePath ?? "").trim(),
      destinationPath: String(values.destinationPath ?? "").trim(),
      overwrite: values.overwrite === true,
    }),
    validate: (_values, input) => input.action !== "create-directory" && input.action !== "undo" && input.action !== "discard-undo" && !input.sourcePath
      ? (zh ? "请输入源路径。" : "Enter a source path.")
      : (input.action === "copy" || input.action === "move" || input.action === "rename" || input.action === "create-directory") && !input.destinationPath
        ? (zh ? "请输入目标路径。" : "Enter a destination path.")
        : null,
    preview: (input) => [input.action, input.sourcePath ?? "", input.destinationPath ?? ""].filter(Boolean),
    isDangerous: (input) => input.action === "delete" || input.action === "trash" || input.action === "undo" || input.action === "discard-undo",
    dangerPrompt: (input) => ({
      title: zh ? "确认文件操作" : "Confirm file operation",
      body: input.action === "delete"
        ? (zh ? "该路径将被永久删除。" : "The path will be permanently deleted.")
        : input.action === "trash"
          ? (zh ? "该路径将移动到系统回收站。" : "The path will be moved to the system trash.")
          : input.action === "undo"
            ? (zh ? "将撤销最近一批仍通过安全校验的文件操作。" : "The latest file-operation batch will be undone after safety checks.")
            : (zh ? "将丢弃最新的撤销记录，文件本身不会改变。" : "The latest undo record will be discarded without changing files."),
      confirmLabel: zh ? "确认" : "Confirm",
    }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.lines }),
  }
}

const FILE_OPERATION_ACTIONS: ReadonlyArray<readonly [NeoviewFileOperationTuiAction, string, string]> = [
  ["copy", "Copy", "复制"], ["move", "Move", "移动"], ["rename", "Rename", "重命名"],
  ["trash", "Move to trash", "移到回收站"], ["delete", "Delete permanently", "永久删除"], ["create-directory", "Create directory", "新建目录"],
  ["undo", "Undo latest batch", "撤销最近操作"],
  ["discard-undo", "Discard latest undo", "丢弃最近撤销记录"],
]

function isFileOperationAction(value: unknown): value is NeoviewFileOperationTuiAction {
  return FILE_OPERATION_ACTIONS.some(([action]) => action === value)
}

function fileOperationFromInput(input: NeoviewFileOperationTuiInput): ReaderFileMutation {
  if (input.action === "undo" || input.action === "discard-undo") throw new Error("Undo actions do not create a file mutation.")
  if (input.action === "create-directory") return { kind: input.action, destinationPath: resolve(input.destinationPath ?? "") }
  if (input.action === "delete" || input.action === "trash") return { kind: input.action, sourcePath: resolve(input.sourcePath ?? "") }
  return {
    kind: input.action,
    sourcePath: resolve(input.sourcePath ?? ""),
    destinationPath: resolve(input.destinationPath ?? ""),
    overwrite: input.overwrite === true,
  }
}

const LIBRARY_ACTIONS: ReadonlyArray<readonly [NeoviewLibraryTuiAction, string, string]> = [
  ["list-recents", "List recents", "最近阅读"], ["cleanup-recents", "Cleanup recents", "清理历史"], ["cleanup-invalid", "Cleanup invalid paths", "清理无效路径"], ["delete-recent", "Delete recent", "删除历史项"],
  ["list-bookmarks", "List bookmarks", "书签"], ["add-bookmark", "Add bookmark", "添加书签"], ["delete-bookmark", "Delete bookmark", "删除书签"],
  ["list-bookmark-lists", "List bookmark lists", "书签列表"], ["add-bookmark-list", "Add bookmark list", "创建书签列表"], ["delete-bookmark-list", "Delete bookmark list", "删除书签列表"],
]

function isLibraryAction(value: unknown): value is NeoviewLibraryTuiAction {
  return LIBRARY_ACTIONS.some(([action]) => action === value)
}

function itemsResult(items: readonly unknown[], name: string): NeoviewLibraryTuiResult {
  return { success: true, message: `${items.length} ${name}.`, lines: items.map((item) => JSON.stringify(item)) }
}

function mutationResult(changed: boolean, name: string): NeoviewLibraryTuiResult {
  return { success: true, message: changed ? `${name} removed.` : `${name} not found.` }
}

function isFileTreeAction(value: unknown): value is NeoviewFileTreeTuiAction {
  return value === "tree" || value === "search" || value === "exclude" || value === "include" || value === "clear-cache"
    || value === "history" || value === "delete-history" || value === "clear-history"
}

function isSearchHistoryScope(value: unknown): value is "folder" | "file" | "bookmark" | "history" {
  return value === "folder" || value === "file" || value === "bookmark" || value === "history"
}
