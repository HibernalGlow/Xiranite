# Xiranite 现代化优化决策

本文不是把某一份优化清单照单落地，而是基于当前仓库实现、已安装依赖、Wails 桌面壳约束和节点包边界，给出一套更稳的技术路线。

目标偏好：

- 少手写基础设施，优先使用成熟或现代框架承担状态、异步、拖拽、表单、路由、存储和 IPC。
- 性能和可维护性优先于“看起来新潮”。
- 节点包继续保持无适配器、可独立发布、`core.ts` 纯逻辑、`Component.tsx` 无壳内容。
- 渐进迁移，避免一次性重写导致 UI、节点包、Wails 后端和 CLI 同时震荡。

## 当前事实

- 桌面壳是 Wails v3 alpha，前端运行在 WebView 中，不是 Node 渲染进程。
- `src/store/workspaceContext.tsx` 约 580 行，使用 `useReducer + Context` 管理工作区、组件、lane、UI 偏好和自动持久化，含 41 个 action 与巨型 switch reducer。
- 已安装但主应用基本未使用的库包括 `zustand`、`@tanstack/react-query`、`@dnd-kit/*`、`react-hook-form`、`nuqs`。
- `src/main.tsx` 已有 `QueryClientProvider` 和 `NuqsAdapter`，但 Query 主要服务 `ocean-dataview`，主应用后端调用仍是裸 `useEffect + useState`。
- Wails IPC 当前通过 `runtime.Call.ByName("main.XiraniteService.Method")` 字符串调用。
- Go 端持久化是 `~/.xiranite/storage.json`，每次读写 JSON map。
- `FlowView` 已经使用 `tldraw`，但根依赖还保留 `@xyflow/react`，且 `tldraw` 未在根 `package.json` 显式声明。
- `niko-table` 目录基本是未接入的旧表格实现，当前 DatabaseModule 使用 `@hibernalglow/ocean-dataview`。
- CLI 和节点迁移计划单独见 [cli-modernization-plan.md](cli-modernization-plan.md)。

## 总体结论

最优路线不是“装了什么库就用什么库”，而是按职责分层：

| 领域 | 推荐方案 | 现在是否做 | 原因 |
| --- | --- | --- | --- |
| 客户端状态 | Zustand v5 + selector + devtools，必要时加 immer | 立即做 | 替代巨型 Context reducer，减少重渲染和样板代码 |
| 后端异步状态 | TanStack Query v5 | 立即做 | 接管 hydrate/list/save/scan/node run 的 loading、error、cache、mutation |
| 拖拽排序 | @dnd-kit | 立即做 lane/kanban | 当前手写 HTML5 DnD 是跨容器 bug 的高风险源 |
| URL 状态 | nuqs 优先，TanStack Router 暂缓 | 近期做 | 当前是单壳桌面应用，先把 viewMode/floatingComponent/search params 类型化 |
| 表单 | 短期 React Hook Form + zod，长期再评估 TanStack Form | 选择性做 | shadcn form 已绑定 RHF；不要同时维护两套表单体系 |
| 本地持久化 | Go 后端 SQLite + migration + DTO 校验 | 中期做 | Wails WebView 不能自然使用 better-sqlite3；Go SQLite 更稳 |
| IPC | Wails codegen 或自生成 typed facade + zod 边界校验 | 中期做 | 消除 `Call.ByName` 字符串和 DTO 隐式信任 |
| 模块注册 | 代码生成 registry | 中期做 | 比 `import.meta.glob` 更适合 workspace 外部 npm 包集成 |
| Node Runner | Wails Events 流式事件 + operationId | 中期做 | 长任务需要实时进度和取消能力 |
| 死代码和依赖 | 删除未接入代码，显式声明真实依赖 | 立即做 | 减小认知负担和依赖漂移 |

## P0: 立即止损

### 1. 用 Zustand v5 替换 workspace reducer

当前问题：

- `workspaceContext.tsx` 同时管理领域数据、UI 状态、持久化副作用和 action creator。
- Context value 包含完整 `state`，任意 dispatch 都会让所有消费者重新计算。
- 自动持久化里重新写入 `createdAt: Date.now()`，会覆盖真实创建时间。
- `hostApi.env.theme` 当前硬编码为 `"light"`，与实际主题不一致。
- `updateComponent` 当前会根据 patch 多次 dispatch，容易制造额外渲染和中间状态。

推荐方案：

- 新建 `src/store/workspaceStore.ts`，使用 `zustand`。
- slice 拆分：
  - `workspaceSlice`: workspaces、activeWorkspaceId
  - `componentSlice`: components、deploy/remove/update/visibility/data
  - `laneSlice`: lanes、lane reorder、card order
  - `uiSlice`: theme、viewMode、cardLayout、overlay、fullscreen、focus、visual prefs
  - `backendSlice`: backendReady、hydrate、dirty state
- 使用 selector 订阅，例如 `useWorkspaceStore(s => s.components)`。
- 使用 `subscribeWithSelector` 处理持久化订阅。
- 使用 `devtools` 追踪动作。
- `immer` 可作为新增依赖引入，但第一阶段也可以用显式 immutable update，避免迁移时同时改变太多。

不推荐第一阶段启用 `persist` 保存 workspace 数据。原因是当前 Wails 后端已有存储源，Zustand `persist` 默认走 localStorage，会造成双写和恢复顺序不确定。`persist` 可以只用于纯 UI 偏好，或者等 SQLite/存储层收敛后再接入。

迁移步骤：

1. 保留 `WorkspaceProvider` 和 `useWorkspace()` 外部 API，内部改为读取 Zustand，先做兼容层。
2. 将 reducer action 逐步搬成 store action，不一次性修改所有调用点。
3. 修复 `createdAt`、`theme`、`updateComponent` 三个明确 bug。
4. 最后再把调用点改成细粒度 selector，移除兼容层。

验收：

- `bun run typecheck`
- `bun run build`
- 创建、重命名、删除 workspace 正常。
- 部署、隐藏、移动、全屏、lane 移动组件正常。
- 刷新或重启后 `createdAt` 不被覆盖。

### 2. 用 TanStack Query 接管后端异步状态

当前问题：

- `useBackend.ts`、workspace hydrate、EngineV 扫描等逻辑使用裸 `useEffect + useState`。
- 没有统一缓存、去重、重试、mutation 状态或 invalidation。
- `src/main.tsx` 里 QueryClient 默认 `staleTime: Infinity` 和 `retry: false`，这对 `ocean-dataview` 可接受，但不适合作为全局后端数据策略。

推荐方案：

- 保留一个 QueryClient，但主应用 query 显式设置自己的 `staleTime`、`gcTime`、`retry`。
- 把 host/backend 资源建成 query：
  - `["backend", "ready"]`
  - `["workspace", "list"]`
  - `["lane", "list"]`
  - `["component", "list"]`
  - `["enginev", "scan", root]`
- 所有写操作用 `useMutation`，在 `onSuccess` 或 `onSettled` invalidate 相关 query。
- Zustand 负责当前交互状态，TanStack Query 负责和后端同步的远端状态。

注意边界：

- 不要把每个按键输入都做成 mutation。
- 不要用 Query 替代所有客户端 store。
- 长任务的实时事件不适合只靠 Query，应该接 Node Runner 流式事件。

### 3. 用 @dnd-kit 替换手写 HTML5 DnD

当前问题：

- `LaneView`、`LaneCard`、`Lane`、`KanbanModule` 都在手写 `dataTransfer`、`onDragOver`、`onDrop`。
- 手写跨容器拖拽容易丢状态，也不支持键盘和触摸传感器。
- 仓库已有 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/modifiers`、`@dnd-kit/utilities`。

推荐方案：

- lane 视图用 `DndContext + SortableContext`。
- lane 本身和 lane 内 card 分两层 sortable。
- 使用 `KeyboardSensor`、`PointerSensor`、`closestCenter` 或自定义 collision strategy。
- 复用 `src/components/ui/sortable.tsx` 的基础包装，必要时新增面向 lane 的 adapter。

不需要迁移：

- `FlowView` 的 canvas 交互继续交给 `tldraw`。
- `DockviewView` 的 panel 管理继续交给 `dockview-react`。

## P1: 架构收敛

### 4. 存储层迁移到 SQLite，但不推荐在 Wails WebView 里直接用 better-sqlite3

原清单里提到 `Drizzle ORM + better-sqlite3`，这个方向如果未来切到 Bun/Electrobun 很好，但当前 Wails 架构下不是最优第一选择。

原因：

- 前端运行在 WebView，不是 Node 渲染进程，不能自然加载 `better-sqlite3` native binding。
- Go 后端已经拥有文件系统和桌面权限，SQLite 放在 Go 层更稳定。
- 当前数据正确性问题来自全量 JSON 重写和并发 save，而不是 ORM 本身。

推荐方案：

- Go 后端新增 SQLite storage service。
- 使用 `database/sql` + SQLite driver。
- 加 migrations，表包括：
  - `workspaces`
  - `lanes`
  - `components`
  - `component_tags`
  - `settings`
- 每个写操作使用事务。
- workspace/lane/component 改为增量 upsert。
- TS DTO 用 zod 做入口和出口校验。

备选方案：

- 如果未来确定改成 Bun/Electrobun 主进程，可重新评估 `Drizzle + bun:sqlite` 或 `Drizzle + better-sqlite3`。
- 如果要做浏览器纯 Web 版，可评估 `wa-sqlite` 或 SQLite WASM + OPFS，但这不是当前桌面最短路径。

### 5. IPC 从字符串调用收敛到类型安全 facade

当前问题：

- `src/backend/adapters/wails.ts` 使用 `runtime.Call.ByName(`${PKG}.${method}`)`。
- Go 方法名改动时，前端编译期无感知。
- `decodeBytes`/`encodeBytes` 在前端手动兼容多种返回形态。
- DTO 没有运行时校验。

推荐方案：

1. 首选 Wails 官方 bindings/codegen，如果 v3 alpha 当前能力满足项目需求。
2. 如果 codegen 不稳定，建立 `backend.schema.ts` 或 `service-manifest.ts`，由脚本生成 TS facade 和 Go 方法名常量。
3. 在 TS 侧对所有 IPC 出入口加 zod schema：
   - hydrate 出口
   - storage 读写
   - node runner result
   - file system stat/list
4. 禁止业务代码直接调用 `runtime.Call.ByName`。

不推荐现在引入本地 HTTP RPC。Hono RPC 或 tRPC 风格很漂亮，但会额外引入本地端口、生命周期、安全边界和打包复杂度。除非未来要支持 Web/远程同步，否则 Wails bindings 更贴合当前架构。

### 6. 模块注册改为代码生成

当前新增节点需要同步多个位置：

- 根 `package.json`
- `src/components/modules/registry.ts`
- `src/components/modules/ModuleRenderer.tsx`
- `packages/cli/package.json`
- `packages/cli/src/index.ts`

推荐方案：

- 新增 `scripts/generate-node-registry.ts`。
- 扫描 `packages/nodes/*/package.json` 和 `src/index.ts` 默认导出约定。
- 生成：
  - `src/components/modules/registry.generated.ts`
  - `src/components/modules/ModuleRenderer.generated.tsx` 或生成 map
  - `packages/cli/src/nodes.generated.ts`
- CI 或 `bun run build:packages` 前校验生成文件是否最新。

为什么不首选 `import.meta.glob`：

- Xiranite 的目标是可以消费外部 npm 节点包，不只是 `src` 内部文件。
- `import.meta.glob` 对 workspace 内源码很方便，但对包名、发布产物和 CLI 聚合不够完整。
- 代码生成可以同时服务前端 registry、CLI 聚合和依赖校验。

### 7. Node Runner 改成流式事件

当前问题：

- Go 端 `cmd.Run()` 阻塞到子进程结束。
- `desktop/nodeRunner.ts` 收集 `events: NodeRunEvent[]` 后一次性回放。
- 长任务无法实时显示进度，也不好取消。

推荐方案：

- Node run 时分配 `operationId`。
- TS bridge 订阅 `xiranite:node-run:<operationId>`。
- Go 端用 `StdoutPipe` 和 `StderrPipe` 读取 NDJSON 行。
- Go 端通过 Wails Events 实时 emit。
- 最终 `NodeRun` 返回 final result。
- 保持 `NodeHostApi.actions.run(input, onEvent)` 公共形态不变，先把实现改成真正流式。

后续可以评估 `AsyncIterable<NodeRunEvent>`，但这会改公共契约，应该等流式实现稳定后再做。

## P2: 体验和清理

### 8. 表单策略

短期推荐：

- 使用已安装的 `react-hook-form + zod + @hookform/resolvers`。
- 适用于 Settings、Deployment、导入导出配置、复杂节点参数表单。
- 与现有 shadcn `form.tsx` 最匹配。

暂不推荐立刻引入 TanStack Form：

- 它更新潮，类型体验也很好，但会和已安装 RHF/shadcn form 形成双体系。
- 当前项目真正的问题是业务表单未使用任何表单框架，不是 RHF 不够强。

长期判断：

- 如果后续大量表单需要字段级订阅、异步校验、复杂派生状态，可在新模块试点 TanStack Form。
- 一旦选 TanStack Form，应删除 RHF/shadcn form 依赖或限定 RHF 只服务 vendor，不要两套业务表单长期并存。

### 9. URL 状态和路由

当前只有 `App.tsx` 读取 `floatingComponent` query param，viewMode 等状态不进 URL。

推荐短期：

- 使用已安装 `nuqs` 管理：
  - `viewMode`
  - `activeWorkspaceId`
  - `floatingComponent`
  - overlay
  - DatabaseModule 视图过滤状态

暂不推荐立即上 TanStack Router：

- 当前是单窗口桌面工作台，不是多页面 Web 应用。
- 引入 Router 会改变应用入口和状态模型。

长期：

- 如果出现真实多页面结构，例如 workspace 列表页、设置页、插件市场页、日志页，再引入 TanStack Router。

### 10. 死代码和依赖清理

建议立即处理：

- 删除或归档 `src/components/niko-table`，除非明确准备重新接入。
- 从根依赖移除 `@xyflow/react`。
- 将 `tldraw` 显式加入根 `dependencies`。
- 审计 `ink`：如果 CLI 统一用 Clack 而不使用 Ink，就从 `cli-runtime` 移除；如果保留 Ink，则只用于真正需要常驻布局的 guided CLI。
- 审计 `package-lock.json`。项目声明 Bun workspace，根部 npm lockfile 容易误导依赖来源。

## P3: 长期方向

### 11. React Compiler

React 19 已经在用，但 React Compiler 不应早于 Zustand selector 和 DnD 收敛。

推荐条件：

- 状态订阅已细粒度化。
- 组件副作用清晰。
- 没有大量手写对象突变。
- 构建链支持明确，回归测试覆盖主要视图。

### 12. Effect-TS

不建议全项目引入 Effect-TS。它很强，但会显著提高团队理解成本。

适合试点的地方：

- 未来新增 `@xiranite/sync` 包。
- 云同步、多端协作、离线队列、重试、超时、取消和 schema 化 RPC。

不适合：

- 节点包公共契约。
- 简单 UI store。
- 现有 Wails storage 第一轮迁移。

## 推荐执行顺序

第一阶段：低风险高收益

1. Zustand 替换 workspace reducer，保留兼容 API。
2. React Query 接管 hydrate/list/save/scan。
3. 删除死代码和错误依赖，显式加入 `tldraw`。
4. 修复 `hostApi.env.theme`、`createdAt` 覆盖、`updateComponent` 多 dispatch。

第二阶段：交互可靠性

1. `@dnd-kit` 改造 lane 和 kanban。
2. `nuqs` 接管 viewMode、workspace、floating window 参数。
3. 复杂表单迁移到 RHF + zod。

第三阶段：后端正确性

1. Go SQLite storage service。
2. zod DTO 校验。
3. Wails typed facade/codegen。
4. 代码生成节点 registry。

第四阶段：长任务和插件化

1. Node Runner 流式事件和取消。
2. CLI 和节点迁移规则固化。
3. 外部节点包安装和发现流程。

## 验收门槛

每个阶段至少满足：

```powershell
bun run typecheck
bun run build
bun run test:packages
bun scripts/validate-node-architecture.ts
```

涉及 UI 的阶段还需要浏览器或 Wails 手动验证：

- 创建、删除、重命名 workspace。
- 多视图切换后组件数据不丢。
- card、dockview、flow、lane 四个视图均能显示同一组件。
- lane 跨列拖拽后刷新仍保持顺序。
- floating component query param 可恢复窗口。
- 长任务有实时进度，取消后不会留下僵尸进程。

## 明确不做

- 不因为依赖已经安装就强行使用。
- 不在 Wails WebView 里硬上 Node native sqlite。
- 不把节点包 `Component.tsx` 变成后端调用器。
- 不让 CLI 导入节点 React Component 或 Xiranite app 内部路径。
- 不让 `lata` 成为其他节点 guided CLI 的默认依赖。
- 不把所有状态都塞进 Query，也不把所有后端数据都塞进 Zustand。
