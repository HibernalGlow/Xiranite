import type { AppNodeEntry } from "@xiranite/contract"
import { def } from "@xiranite/node-formatv/definition"
import { Component } from "./Component"

// GUI 面不带引擎（ADR-0074 §5）：那份 TS core 只在宿主内的 QuickJS 里求值，浏览器这一侧只登记定义与视图。
// `entry.core` 没有任何宿主代码路径读它（见 `packages/contract/src/index.ts` 里 `AppNodeEntry.core` 的注释），
// 按值把 `core` 挂进入口就是把 FormatV 的执行器（dist/core.js，约 12 KB）连同动作词表放进面进程。
// `def` 取自包侧的 definition-only 子路径 `@xiranite/node-formatv/definition`（clipm 先落地的形状）：
// 根 barrel `@xiranite/node-formatv` 仍 `export * from "./core.js"`，从它取值就会把整份 core 图连进这个 chunk，
// 那条边已由这条子路径断开——模块图不再因为 `def` 连到引擎。
// 界面要跑动作只走 `/operations`：`./Component.tsx` 经 `host.runner` → `@/nodes/shared/api`。
export default {
  def,
  Component,
} satisfies AppNodeEntry<Record<string, never>>
