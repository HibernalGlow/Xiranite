import type { AppNodeEntry, NodeSchema } from "@xiranite/contract"
import { def } from "@xiranite/node-enginev/definition"
import { z } from "zod"
import { Component } from "./Component"
import type { EngineVCardState, EngineVNodeConfig } from "./types"

/**
 * Runtime validation schema for persisted enginev card state. Uses `.passthrough()`
 * so legacy fields (e.g. `wallpapers`, `filteredWallpapers`, `result`) do not
 * disappear during the migration period. The precise `EngineVCardState` type
 * stays hand-maintained in `./types`; this schema is the runtime guard wired
 * into `host.state.getData()`.
 */
export const enginevDataSchema = z
  .object({
    actionTrayPinned: z.boolean().optional(),
    workshopPath: z.string().optional(),
    titleFilter: z.string().optional(),
    ratingFilter: z.string().optional(),
    typeFilter: z.string().optional(),
    idsText: z.string().optional(),
    template: z.string().optional(),
    outputPath: z.string().optional(),
    exportFormat: z.string().optional(),
    dryRun: z.boolean().optional(),
    copyMode: z.boolean().optional(),
    permanent: z.boolean().optional(),
    targetPath: z.string().optional(),
    galleryColumns: z.number().optional(),
    galleryCompact: z.boolean().optional(),
    galleryShowMeta: z.boolean().optional(),
    galleryShowPath: z.boolean().optional(),
    logs: z.array(z.string()).optional(),
    phase: z.string().optional(),
    progress: z.number().optional(),
    progressText: z.string().optional(),
  })
  .passthrough()

const enginevUiConfigSchema = z
  .object({
    actionTrayPinned: z.boolean().optional(),
    galleryColumns: z.number().optional(),
    galleryCompact: z.boolean().optional(),
    galleryShowMeta: z.boolean().optional(),
    galleryShowPath: z.boolean().optional(),
  })
  .passthrough()

const enginevConfigSchema = z
  .object({
    workshopPath: z.string().optional(),
    outputPath: z.string().optional(),
    template: z.string().optional(),
    ui: enginevUiConfigSchema.optional(),
  })
  .passthrough()

// GUI 面不带引擎（ADR-0074 §5）：那份 TS core 只在宿主内的 QuickJS 里求值，浏览器这一侧只登记定义与视图。
// `entry.core` 没有任何宿主代码路径读它（见 `packages/contract/src/index.ts` 里 `AppNodeEntry.core` 的注释），
// 按值把 `core` 挂进入口就是把 EngineV 的执行器（dist/core.js，约 20 KB）连同动作词表放进面进程。
// 这条边还没有全断：`./Component.tsx` 仍按值导入 `@xiranite/node-enginev/core` 的 `filterWallpapers`，
// 那处属于 Component 自己的迁移切片，不在入口的职责里；本文件只保证入口不再交出一份引擎对象。
// 界面要跑动作只走 `/operations`：`./Component.tsx` 经 `host.runner` → `@/nodes/shared/api`。
const entry = {
  def,
  Component,
  host: {
    contractVersion: "^1.0.0",
    capabilities: ["state", "runner", "clipboard", "localFiles", "config", "env"],
  },
  schemas: {
    data: enginevDataSchema as unknown as NodeSchema<EngineVCardState>,
    config: enginevConfigSchema as unknown as NodeSchema<EngineVNodeConfig>,
  },
} satisfies AppNodeEntry<Record<string, never>, EngineVCardState, EngineVNodeConfig>

export default entry
