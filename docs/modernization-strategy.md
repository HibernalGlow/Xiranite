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
| 本地持久化 | Dexie.js (IndexedDB) + zod DTO 校验 | 中期做 | TS 直接用、零 IPC、不走 WASM；与 React Query 分工清晰 |
| Runtime 抽象 | `RuntimeInterface` + NodeRuntime + 显式注入 | 中期做 | dev 摆脱 Wails、core 可单测、切换桌面壳零成本 |
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

不推荐第一阶段启用 `persist` 保存 workspace 数据。原因是当前 Wails 后端已有存储源，Zustand `persist` 默认走 localStorage，会造成双写和恢复顺序不确定。`persist` 只用于纯 UI 偏好（theme/viewMode/cardLayout），业务数据持久化交给 Dexie（见 P1 第 4 节）。

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

### 4. 存储层迁移到 Dexie.js (IndexedDB)

原清单提到 `Drizzle ORM + better-sqlite3`，后又评估过 Go 层 SQLite。在当前 Wails WebView 架构下，二者都有明显代价：

- `better-sqlite3` / `bun:sqlite` / `node:sqlite` 是 native binding，WebView 加载不了。
- Go 层 SQLite 需要走 IPC 往返，且切换桌面架构时要重写 adapter。
- WASM SQLite (`wa-sqlite` / `sql.js`) 性能比 native 慢 2-5 倍，OPFS 兼容性参差不齐。

推荐方案：**Dexie.js（IndexedDB 封装）**。IndexedDB 在 WebView2 中是 native 实现（不走 WASM），TS 直接用、零 IPC、切换桌面壳时零成本。

核心策略：**Dexie 只当持久层，不接触 React。响应式由 React Query 接管，UI 状态由 Zustand 管理。三个库分工清晰，零角色重叠。**

```
┌─────────────────────────────────────────────────────┐
│  Zustand — client state                              │
│  viewMode / theme / focusedId / overlay / 临时编辑态 │
│  persist 只存 UI 偏好到 localStorage                │
├─────────────────────────────────────────────────────┤
│  React Query — server state 缓存层                   │
│  useQuery({ queryKey: ['components'],               │
│             queryFn: () => db.components.toArray() })│
│  useMutation + invalidateQueries 触发刷新           │
├─────────────────────────────────────────────────────┤
│  Dexie — 持久层（IndexedDB CRUD）                    │
│  替代 storage.json / WorkspaceService 全量重写      │
│  不用 useLiveQuery，不接触 React                     │
└─────────────────────────────────────────────────────┘
```

为什么不用 `dexie-react-hooks` 的 `useLiveQuery`：

- 它与 React Query 在职责上重叠（都做"订阅数据变化 + 自动刷新 UI"）。
- 同时用会出现两套缓存、两套 loading/error 状态机、invalidation 时序混乱。
- 原则：响应式 UI 只能有一个真相源。既然选了 RQ，就让 Dexie 退居幕后当数据库。

Schema 定义：

```ts
// src/db/index.ts
import Dexie, { Table } from 'dexie'

class XiraniteDB extends Dexie {
  workspaces!: Table<WorkspaceRow, string>
  components!: Table<ComponentRow, string>
  lanes!: Table<LaneRow, string>

  constructor() {
    super('xiranite')
    this.version(1).stores({
      workspaces: 'id, createdAt',
      components: 'id, workspaceId, moduleId, *tags, updatedAt',
      //                                              ^^^ * 前缀 = MultiEntry 索引，按 tag 查询
      lanes: 'id, workspaceId, order',
    })
  }
}

export const db = new XiraniteDB()
```

React Query 在中间做缓存：

```ts
// src/hooks/queries/useComponents.ts
export function useComponents(workspaceId: string) {
  return useQuery({
    queryKey: ['components', workspaceId],
    queryFn: () => db.components.where('workspaceId').equals(workspaceId).toArray(),
  })
}

// src/hooks/mutations/usePatchComponent.ts
export function usePatchComponent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ComponentRow> }) =>
      db.components.update(id, { ...patch, updatedAt: Date.now() }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['components'] })
      qc.invalidateQueries({ queryKey: ['component', id] })
    },
  })
}
```

这个组合修复的问题：

| 原问题 | 新方案如何修复 |
| --- | --- |
| `storage.json` 全量重写 | Dexie `update(id, patch)` 增量 |
| `createdAt: Date.now()` 覆盖 bug | `update` 只改指定字段，不动 `createdAt` |
| 并发 save 丢更新 | Dexie 事务 + React Query 串行 mutation |
| 全员重渲染 | RQ 选择性订阅 `useQuery(['components', wsId])` |
| 无缓存去重 | RQ 默认 staleTime 去重 |
| 持久化无 invalidation | mutation `onSuccess` 主动 invalidate |

跨窗口同步：Dexie 跨 origin 不共享，但通过 `BroadcastChannel` 通知 + RQ `invalidateQueries` 可解决（10 行代码）。

切换架构时的迁移路径：

| 目标架构 | Dexie 是否可用 | 说明 |
| --- | --- | --- |
| Bun / Electrobun | ✅ | WebView 仍有 IndexedDB |
| Tauri | ✅ | WebView 仍有 IndexedDB |
| Electron | ✅ | WebView 仍有 IndexedDB |
| 纯 Web | ✅ | IndexedDB 是浏览器标准 API |

何时回头选 Go SQLite：只有当 Go 后端需要直接读业务数据（如 NodeRunner 根据 components 配置决定执行策略）时才考虑。当前架构无此需求。

### 5. Runtime 抽象：补齐 NodeRuntime + 显式注入

当前 `src/backend/runtime/runtime.ts` 已定义 `RuntimeInterface`（fs / subprocess / storage / events / nodeRunner / windows），并有 `WailsRuntime` 和 `WebRuntime` 两个实现。这已经是 Port & Adapter 模式，但有两个缺口：

1. **缺 NodeRuntime**：`vite dev` 时只能用 `WebRuntime`（假 fs + NoSubprocess），开发体验差。
2. **core 函数隐式依赖**：节点包 `platform.ts` 是模块级单例，core 函数无法独立测试。

补齐方案：

**缺口 1：新增 NodeRuntime adapter**

```ts
// src/backend/adapters/node.ts
export function createNodeRuntime(): RuntimeInterface {
  return {
    kind: 'node',
    fs: createNodeFS(),              // node:fs/promises 包装
    subprocess: createNodeSubprocess(),  // node:child_process 包装
    storage: createNodeStorage(),    // Dexie（通过 fake-indexeddb）或 node:sqlite
    events: new MemoryEventBus(),
    nodeRunner: createLocalNodeRunner(),  // 直接 import 节点 core，不走 bun 子进程
    windows: createNoopWindows(),
  }
}

// client.ts 注册
const RUNTIME_FACTORIES: RuntimeAdapterRegistration[] = [
  { kind: 'wails', detect: detectWails, factory: createWailsRuntime },
  { kind: 'node',  detect: detectNode,  factory: createNodeRuntime },  // 新增
  { kind: 'web',   detect: () => true,  factory: createWebRuntime },
]
```

收益：

- `vite dev` 直接用真实 fs + 真实 subprocess，不再需要 `wails dev` 起两层。
- 节点包开发时可以单步调试 core.ts（不用启动整个 Wails）。
- CI 测试可在纯 Node 环境跑。

**缺口 2：core 函数显式接收 runtime 参数**

改造前（隐式）：

```ts
// packages/nodes/repacku/src/platform.ts
import { createNodeRepackuRuntime } from './runtime'
const runtime = createNodeRepackuRuntime()  // 模块级单例，硬绑定

// packages/nodes/repacku/src/core.ts
import { runtime } from './platform'  // 隐式依赖
export async function compress(input) {
  return runtime.fs.readFile(input.path)
}
```

改造后（显式注入）：

```ts
// packages/nodes/repacku/src/core.ts
export interface RepackuRuntime {
  fs: { readFile: (p: string) => Promise<Buffer> }
  shell: { exec: (cmd: string) => Promise<string> }
}

export async function compress(input: CompressInput, rt: RepackuRuntime) {
  const buf = await rt.fs.readFile(input.path)
  // 业务逻辑纯函数，rt 是参数
}

// packages/nodes/repacku/src/platform.ts
import type { RuntimeInterface } from '@xiranite/contract'
import { compress } from './core'

export function createRepackuPlatform(runtime: RuntimeInterface) {
  return {
    compress: (input: CompressInput) => compress(input, {
      fs: { readFile: (p) => runtime.fs.readFile(p) },
      shell: { exec: (cmd) => runtime.subprocess.spawn('sh', ['-c', cmd]) },
    }),
  }
}
```

收益：

- `compress(input, mockRuntime)` 可单测，不需要起 Wails/Node。
- core.ts 真正变成纯函数，符合 hexagonal architecture 的 domain 层。
- 每个节点包声明自己需要的 runtime 切片（`RepackuRuntime`），不依赖整个 `RuntimeInterface`。

与存储层的关系：storage 是 `RuntimeInterface` 的一个字段，正交决策。不同 adapter 可以用不同实现：

| Adapter | storage 实现 |
| --- | --- |
| WailsRuntime | Dexie (IndexedDB) 或 Go SQLite |
| NodeRuntime | Dexie + fake-indexeddb 或 node:sqlite |
| BrowserRuntime | Dexie (IndexedDB) |

所以存储方案不需要在 Runtime 抽象之前敲定——先把 Runtime Provider 跑起来，storage 字段先用现有 `storage.json` 兼容，后续按 adapter 逐个优化。

### 6. IPC 从字符串调用收敛到类型安全 facade

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

### 7. 模块注册改为代码生成

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

### 8. Node Runner 改成流式事件

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

### 9. 表单策略

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

### 10. URL 状态和路由

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

### 11. 死代码和依赖清理

建议立即处理：

- 删除或归档 `src/components/niko-table`，除非明确准备重新接入。
- 从根依赖移除 `@xyflow/react`。
- 将 `tldraw` 显式加入根 `dependencies`。
- 审计 `ink`：如果 CLI 统一用 Clack 而不使用 Ink，就从 `cli-runtime` 移除；如果保留 Ink，则只用于真正需要常驻布局的 guided CLI。
- 审计 `package-lock.json`。项目声明 Bun workspace，根部 npm lockfile 容易误导依赖来源。

## P3: 长期方向

### 12. React Compiler

React 19 已经在用，但 React Compiler 不应早于 Zustand selector 和 DnD 收敛。

推荐条件：

- 状态订阅已细粒度化。
- 组件副作用清晰。
- 没有大量手写对象突变。
- 构建链支持明确，回归测试覆盖主要视图。

### 13. Effect-TS

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

第三阶段：存储层与 Runtime 抽象

1. 引入 Dexie.js (IndexedDB) 替代 `storage.json` + `WorkspaceService` 全量重写。
2. React Query 作为 Dexie 与 React 之间的唯一响应式层（不用 `useLiveQuery`）。
3. 新增 `NodeRuntime` adapter，让 `vite dev` 摆脱 Wails 依赖。
4. 选 1-2 个节点包（repacku / encodeb）试点 core 函数显式 runtime 注入。
5. zod DTO 校验接入 IPC 出入口。

第四阶段：IPC 类型化与模块注册

1. Wails typed facade / codegen。
2. 代码生成节点 registry（替代 5 处手动同步）。
3. NodeRunner 流式事件和取消（基于 `operationId` + Wails Events）。
4. 逐步推广显式 runtime 注入到全部 26 个节点包。

第五阶段：长任务和插件化

1. CLI 和节点迁移规则固化。
2. 外部节点包安装和发现流程。
3. 多窗口 BroadcastChannel 同步 Dexie 数据。

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
- `vite dev` 纯浏览器模式下 fs/subprocess 可用（NodeRuntime 生效）。
- 节点包 core.ts 可在纯 Node 环境 `bun test` 单测，不需要起 Wails。

## 明确不做

- 不因为依赖已经安装就强行使用。
- 不在 Wails WebView 里硬上 Node native sqlite（`better-sqlite3` / `bun:sqlite` / `node:sqlite`）。
- 不在 WebView 里跑 WASM SQLite（`wa-sqlite` / `sql.js`）——性能不如 IndexedDB，OPFS 兼容性差。
- 不用 `dexie-react-hooks` 的 `useLiveQuery`——与 React Query 职责重叠，会造成双缓存。
- 不把节点包 `Component.tsx` 变成后端调用器。
- 不让 CLI 导入节点 React Component 或 Xiranite app 内部路径。
- 不让 `lata` 成为其他节点 guided CLI 的默认依赖。
- 不把所有状态都塞进 Query，也不把所有后端数据都塞进 Zustand。
- 不在节点包 core.ts 里 import 整个 `RuntimeInterface`——只声明自己需要的 runtime 切片（如 `RepackuRuntime`）。
- 不让 `platform.ts` 继续做模块级单例——改为 `createRepackuPlatform(runtime)` 工厂函数，由调用方注入。
