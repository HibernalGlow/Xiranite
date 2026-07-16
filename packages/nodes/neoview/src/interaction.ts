import type { InteractionValues, TerminalInteractionDefinition, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import { dirname } from "node:path"
import type { HeadlessReaderSnapshot } from "./core.js"
import type { ReaderFileTreeHeadlessController } from "./core.js"
import { createReaderFileTreeController, createReaderHeadlessController } from "./platform.js"

export interface NeoviewTuiInput {
  path: string
}

export interface NeoviewTuiResult {
  success: boolean
  message: string
  snapshot?: HeadlessReaderSnapshot
}

export type NeoviewFileTreeTuiAction = "tree" | "search" | "exclude" | "include" | "clear-cache"

export interface NeoviewFileTreeTuiInput {
  action: NeoviewFileTreeTuiAction
  path: string
  query?: string
  mode?: "text" | "glob"
  maximumDepth?: number
  maximumResults?: number
  caseSensitive?: boolean
}

export interface NeoviewFileTreeTuiResult {
  success: boolean
  message: string
  paths?: readonly string[]
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
        await controller.open({ path: input.action === "exclude" || input.action === "include" ? dirname(input.path) : input.path })
        if (input.action === "tree") {
          const page = await controller.tree()
          const paths = page?.entries.map((entry) => entry.path) ?? []
          return { success: true, message: `${paths.length} child directories.`, paths }
        }
        if (input.action === "search") {
          const handle = controller.search(input.query ?? "", {
            mode: input.mode,
            caseSensitive: input.caseSensitive,
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
          return { success: true, message: `${paths.length} matches.`, paths }
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
  return {
    id: "neoview-file-tree",
    title: "NeoView File Tree",
    description: zh ? "目录树、递归搜索与排除规则" : "Directory tree, recursive search and exclusions",
    initialValues: { action: "tree", path: "", query: "", mode: "text", maximumDepth: 10, maximumResults: 512, caseSensitive: false },
    fields: [
      { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: [
        { value: "tree", label: zh ? "展开树节点" : "Expand tree node" },
        { value: "search", label: zh ? "递归搜索" : "Recursive search" },
        { value: "exclude", label: zh ? "排除目录" : "Exclude directory" },
        { value: "include", label: zh ? "取消排除" : "Include directory" },
        { value: "clear-cache", label: zh ? "清理树缓存" : "Clear tree cache" },
      ] },
      { id: "path", label: zh ? "目录路径" : "Directory path", kind: "text" },
      { id: "query", label: zh ? "搜索内容" : "Query", kind: "text", visibleWhen: search },
      { id: "mode", label: zh ? "匹配方式" : "Match mode", kind: "select", options: [{ value: "text", label: zh ? "文本" : "Text" }, { value: "glob", label: "Glob" }], visibleWhen: search },
      { id: "maximumDepth", label: zh ? "最大深度" : "Maximum depth", kind: "number", min: 0, max: 4096, step: 1, visibleWhen: search },
      { id: "maximumResults", label: zh ? "结果上限" : "Result limit", kind: "number", min: 1, max: 10000, step: 1, visibleWhen: search },
      { id: "caseSensitive", label: zh ? "区分大小写" : "Case sensitive", kind: "boolean", visibleWhen: search },
    ],
    toInput: (values) => ({
      action: isFileTreeAction(values.action) ? values.action : "tree",
      path: String(values.path ?? "").trim(),
      query: String(values.query ?? "").trim(),
      mode: values.mode === "glob" ? "glob" : "text",
      maximumDepth: Number(values.maximumDepth ?? 10),
      maximumResults: Number(values.maximumResults ?? 512),
      caseSensitive: values.caseSensitive === true,
    }),
    validate: (_values, input) => !input.path
      ? (zh ? "请输入目录路径。" : "Enter a directory path.")
      : input.action === "search" && !input.query
        ? (zh ? "请输入搜索内容。" : "Enter a search query.")
        : null,
    preview: (input) => [input.path, input.action === "search" ? `${input.mode}: ${input.query}` : input.action],
    isDangerous: (input) => input.action === "exclude" || input.action === "include" || input.action === "clear-cache",
    dangerPrompt: (input) => ({
      title: zh ? "确认文件树操作" : "Confirm file-tree operation",
      body: input.action === "clear-cache"
        ? (zh ? "将清理当前有界树缓存。" : "The bounded file-tree cache will be cleared.")
        : (zh ? "将修改 [nodes.neoview.folder.tree] 排除设置。" : "This changes [nodes.neoview.folder.tree] exclusions."),
      confirmLabel: zh ? "确认" : "Confirm",
    }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.paths }),
  }
}

function isFileTreeAction(value: unknown): value is NeoviewFileTreeTuiAction {
  return value === "tree" || value === "search" || value === "exclude" || value === "include" || value === "clear-cache"
}
