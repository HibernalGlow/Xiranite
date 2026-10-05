import type { AppNodeEntry } from "@xiranite/contract"
import type { ClassqCardState } from "./types"
import { def } from "@xiranite/node-classq/definition"
import { Component } from "./Component"

// GUI 面不带引擎（ADR-0074 §5）：那份 TS core 只在宿主内的 QuickJS 里求值，浏览器这一侧只登记定义与视图。
// `entry.core` 没有任何宿主代码路径读它（见 `packages/contract/src/index.ts` 里 `AppNodeEntry.core` 的注释），
// 值导入 `@xiranite/node-classq` 的 `core` 只会把 `runClassq` 那台执行器（dist/core.js，7.6 KB）连同它的动作词表
// 拉进 GUI chunk —— 面里能跑节点逻辑，就是协议之外的第二个执行宿主。
// 界面要跑动作只走 `/operations`：`./Component.tsx` 经 `host.runner.run ?? host.actions.run` → `@/nodes/shared/api` 的 `runNodeOperation`。
// `def` 走 `@xiranite/node-classq/definition` 这条 definition-only 子路径：包根 barrel 仍 `export * from "./core.js"`，
// 从包根取值就把整份 core 图再接回 GUI chunk（尺：`scripts/audit-face-execution-path.ts` 把裸包名也算一条 core 边）。
export default { def, Component } satisfies AppNodeEntry<Record<string, never>, ClassqCardState, Partial<ClassqCardState>>
