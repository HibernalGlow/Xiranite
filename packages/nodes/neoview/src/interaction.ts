import type { InteractionValues, TerminalInteractionDefinition, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import { dirname } from "node:path"
import type { HeadlessReaderSnapshot } from "./core.js"
import type { ReaderFileTreeHeadlessController } from "./core.js"
import type { ReaderLibraryHeadlessController } from "./core.js"
import { createReaderFileTreeController, createReaderHeadlessController, createReaderLibraryHeadlessController } from "./platform.js"

export interface NeoviewTuiInput {
  path: string
}

export interface NeoviewTuiResult {
  success: boolean
  message: string
  snapshot?: HeadlessReaderSnapshot
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
  scope?: "folder" | "file" | "bookmark" | "history"
}

export interface NeoviewFileTreeTuiResult {
  success: boolean
  message: string
  paths?: readonly string[]
}

export type NeoviewLibraryTuiAction =
  | "list-recents" | "cleanup-recents" | "delete-recent"
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
}

export interface NeoviewLibraryTuiResult {
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
        if (input.action === "list-recents") return itemsResult(await controller.listRecent(limit), "recent entries")
        if (input.action === "cleanup-recents") {
          const deleted = await controller.clearRecentBefore(input.before ?? 0, Math.min(limit, 500))
          return { success: true, message: `${deleted} recent entries deleted.` }
        }
        if (input.action === "delete-recent") return mutationResult(await controller.removeRecent(input.id ?? ""), "Recent entry")
        if (input.action === "list-bookmarks") return itemsResult(await controller.listBookmarks(input.listId, limit), "bookmarks")
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
    initialValues: { action: "tree", path: "", query: "", mode: "text", maximumDepth: 10, maximumResults: 512, caseSensitive: false, searchInPath: false },
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
  const destructive = new Set<NeoviewLibraryTuiAction>(["cleanup-recents", "delete-recent", "delete-bookmark", "delete-bookmark-list"])
  return {
    id: "neoview-library",
    title: "NeoView Library",
    description: zh ? "最近阅读、书签和书签列表" : "Recent reading, bookmarks and bookmark lists",
    initialValues: { action: "list-recents", path: "", id: "", name: "", listId: "", before: Date.now(), limit: 100, starred: false, favorite: false },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: LIBRARY_ACTIONS.map(([value, en, cn]) => ({ value, label: zh ? cn : en })) },
      { id: "path", label: zh ? "路径" : "Path", kind: "text", visibleWhen: actionIs("add-bookmark") },
      { id: "id", label: "ID", kind: "text", visibleWhen: actionIs("delete-recent", "delete-bookmark", "add-bookmark-list", "delete-bookmark-list") },
      { id: "name", label: zh ? "名称" : "Name", kind: "text", visibleWhen: actionIs("add-bookmark", "add-bookmark-list") },
      { id: "listId", label: zh ? "书签列表 ID" : "Bookmark list ID", kind: "text", visibleWhen: actionIs("list-bookmarks", "add-bookmark") },
      { id: "before", label: zh ? "早于时间戳" : "Before timestamp", kind: "number", min: 0, max: Number.MAX_SAFE_INTEGER, step: 1, visibleWhen: actionIs("cleanup-recents") },
      { id: "limit", label: zh ? "数量上限" : "Limit", kind: "number", min: 1, max: 500, step: 1, visibleWhen: actionIs("list-recents", "cleanup-recents", "list-bookmarks") },
      { id: "starred", label: zh ? "收藏" : "Starred", kind: "boolean", visibleWhen: actionIs("add-bookmark") },
      { id: "favorite", label: zh ? "收藏列表" : "Favorite list", kind: "boolean", visibleWhen: actionIs("add-bookmark-list") },
    ],
    toInput: (values) => ({
      action: isLibraryAction(values.action) ? values.action : "list-recents",
      path: String(values.path ?? "").trim(),
      id: String(values.id ?? "").trim(),
      name: String(values.name ?? "").trim(),
      listId: String(values.listId ?? "").trim() || undefined,
      before: Number(values.before ?? 0),
      limit: Number(values.limit ?? 100),
      starred: values.starred === true,
      favorite: values.favorite === true,
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

const LIBRARY_ACTIONS: ReadonlyArray<readonly [NeoviewLibraryTuiAction, string, string]> = [
  ["list-recents", "List recents", "最近阅读"], ["cleanup-recents", "Cleanup recents", "清理历史"], ["delete-recent", "Delete recent", "删除历史项"],
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
