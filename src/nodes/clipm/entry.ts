import type { AppNodeEntry } from "@xiranite/contract"
import { def } from "@xiranite/node-clipm/definition"
import type { ClipmNodeConfig } from "@xiranite/node-clipm/platform"
import { Component } from "./Component"
import type { ClipmCardState } from "./types"

// GUI 面不带引擎（ADR-0074 §5）：那份 TS core 只在宿主内的 QuickJS 里求值，浏览器这一侧只登记定义与视图。
// `entry.core` 没有任何宿主代码路径读它（见 `packages/contract/src/index.ts` 里 `AppNodeEntry.core` 的注释），
// 值导入 `@xiranite/node-clipm/core` 只会把 `runClipm` 那台执行器（dist/core.js，12.5 KB）连同它的动作词表
// 拉进 GUI chunk —— 面里能跑节点逻辑，就是协议之外的第二个执行宿主。
// 界面要跑动作只走 `/operations`：`./useClipmWorkspace.ts` 经 `host.runner` → `@/nodes/shared/api`。
export default {
  def,
  Component,
} satisfies AppNodeEntry<Record<string, never>, ClipmCardState, ClipmNodeConfig>
