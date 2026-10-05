import type { AppNodeEntry } from "@xiranite/contract"
import { def } from "@xiranite/node-encodeb/definition"
import { Component } from "./Component"

// GUI 面不带引擎（ADR-0074 §5）：那份 TS core 只在宿主内的 QuickJS 里求值，浏览器这一侧只登记定义与视图。
// `entry.core` 没有任何宿主代码路径读它（见 `packages/contract/src/index.ts` 里 `AppNodeEntry.core` 的注释），
// 按值把 `core` 挂进入口就是把 `runEncodeb` 那台执行器（dist/core.js，约 8 KB）连同动作词表放进面进程。
// `def` 走 `@xiranite/node-encodeb/definition` 这条 definition-only 子路径，不再碰仍 `export * from "./core.js"` 的包根 barrel
// （尺：`scripts/audit-face-execution-path.ts` 把裸包名也算一条 core 边）。
// 界面要跑动作只走 `/operations`：`./Component.tsx` 经 `host.runner` → `@/nodes/shared/api`。
export default {
  def,
  Component,
} satisfies AppNodeEntry<Record<string, never>>
