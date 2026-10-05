import type { AppNodeEntry } from "@xiranite/contract"
import type { KisakiCardState } from "./types"
import type { KisakiNodeConfig } from "./node-config"
import { def } from "@xiranite/node-kisaki/definition"
import { Component } from "./Component"

// GUI 面不带引擎（ADR-0074 §5）：那份 TS core 只在宿主内的 QuickJS 里求值，浏览器这一侧只登记定义与视图。
// `entry.core` 没有任何宿主代码路径读它（见 `packages/contract/src/index.ts` 里 `AppNodeEntry.core` 的注释），
// 按值把 `core` 挂进入口就是把 Kisaki 的执行器（dist/core.js，约 40 KB）连同动作词表放进面进程。
// `def` 取自包侧的 definition-only 子路径 `@xiranite/node-kisaki/definition`（clipm 先落地的形状），
// 入口不再经包根 barrel——根 barrel 仍 `export * from "./core.js"`，从它取值就会把整份 core 图连进这个 chunk。
// 这条边还没有全断：`./use-kisaki-workbench.ts` 仍按值导入 `@xiranite/node-kisaki/core` 的 `smartSelect`，
// 那处属于 workbench 自己的迁移切片，不在入口的职责里；本文件只保证入口不再交出一份引擎对象。
// 界面要跑动作只走 `/operations`：`./use-kisaki-workbench.ts` 经 `host.runner` → `@/nodes/shared/api`。
export default {
  def,
  Component,
  nodeApp: {
    nativeProbe: { module: "@xiranite/czkawka-native", exportName: "getCzkawkaInfo" },
    releaseGate: { script: "scripts/smoke-node-app-kisaki.ts" },
  },
  host: { contractVersion: "^1.0.0", capabilities: ["state", "runner", "localFiles", "clipboard", "config", "env"] },
} satisfies AppNodeEntry<Record<string, never>, KisakiCardState, Partial<KisakiNodeConfig>>
