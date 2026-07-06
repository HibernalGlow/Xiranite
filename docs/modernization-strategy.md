# Xiranite 现代化优化决策

本文定义 Xiranite 的长期技术路线。新的核心判断是：Xiranite 不应继续按传统“桌面壳 + 框架专属 IPC + 前端直连存储”的模式演进，而应转向 **Local-First + Service-Oriented**。

目标是把产品当成一个本地运行的 TypeScript 服务平台：

```text
                    Backend Service (TypeScript)
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
      React Web          React Native            CLI
          │                   │                   │
          └──────────────┬────┴───────────────────┘
                         │
        Electron / Wails / Tauri 只负责窗口、托盘、菜单、启动器
```

这样业务只写一次。桌面、Web、CLI、Mobile、VS Code 扩展都只是不同客户端。

## 不变边界

### 节点包仍然独立

Local Backend Service 不会替代节点包 CLI。每个节点包仍必须可以作为独立 npm 包安装并独立运行：

```text
packages/nodes/repacku
  core.ts        纯逻辑
  platform.ts    Node/Bun 本地能力
  cli.ts         xrepacku 独立命令行
  Component.tsx  Xiranite UI 内容
```

正确关系：

```text
@xiranite/node-repacku
  ├─ CLI 独立运行：cli.ts -> core.ts + platform.ts
  ├─ Xiranite 集成：Component.tsx -> host.actions.run("repacku")
  └─ 平台服务调用：NodeRunnerService -> import/run 或 spawn
```

禁止关系：

```text
xrepacku
  ↓
必须启动 Xiranite backend
  ↓
才能运行
```

节点包 CLI 是包自己的入口。Local Service 是 Xiranite 平台的业务后端。两者共享 `core.ts` 逻辑，但互不强制依赖。

### Component 仍然无壳

节点 `Component.tsx` 仍是 Xiranite 集成时的唯一 UI 内容入口：

- 不渲染 CardShell、Panel 外壳、shadcn Card 包装器。
- 不导入 `platform.ts`、`cli.ts`、Node/Bun API、Xiranite app 内部路径。
- 只通过 `NodeHostApi` 请求宿主能力。

### core.ts 仍然纯逻辑

节点 `core.ts` 不 import React、Ink、DOM、Bun、`process`、`node:*`、文件系统、shell 或网络 API。所有原生能力通过节点自己的 runtime 切片显式注入。

## 当前事实

- 当前主应用仍在仓库根目录，桌面壳是 Wails v3 alpha。
- 当前 `src/backend/*` 其实已经是前端工程里的 service façade，但运行在 WebView 侧，底层再通过 Wails IPC/Mock runtime 调能力。
- `RuntimeInterface` 已存在，包含 fs、subprocess、storage、events、nodeRunner、windows，但 `kind` 还没有 `node`，也没有真正的 Bun/Node local service。
- Workspace 状态已经开始从 `useReducer + Context` 收敛到 Zustand。
- TanStack Query 已在主入口存在，workspace hydrate/persist 已开始改为 Query/Mutation。
- 节点包结构已经基本正确：`core.ts` 注入 runtime，`cli.ts` 直接调用本包 `core + platform`，`Component.tsx` 作为无壳内容。
- CLI 后续计划单独见 [cli-modernization-plan.md](cli-modernization-plan.md)。

## 总体结论

| 领域 | 推荐方案 | 现在是否做 | 原因 |
| --- | --- | --- | --- |
| 平台架构 | Bun/Node Local Backend Service + 多客户端 | 立即确立 | 避免业务绑定 Wails/Electron/Tauri，长期可迁移到 Web/Mobile/CLI |
| 类型安全 RPC | Elysia + Eden Treaty + zod | 第一阶段做骨架 | Bun-first、高性能、类型推导舒服，RPC contract 可复用到 React、RN、CLI |
| 业务服务 | `@xiranite/services` | 第一阶段做 | WorkspaceService、PluginService、WorkflowService 只写一遍 |
| Repository | 接口优先，SQLite/JSON/Dexie/memory adapter | 第一阶段做接口，第二阶段做 SQLite | service 不关心存储实现，方便本地、Web、测试和云同步切换 |
| 本地主存储 | SQLite/libSQL + Drizzle | 第二阶段做 | 本地服务运行在 Bun/Node，native SQLite 比 WebView IndexedDB 更适合主数据 |
| 浏览器离线存储 | Dexie.js (IndexedDB) adapter | 需要纯 Web/离线时做 | Dexie 是 browser repository adapter，不是桌面主存储 |
| 客户端状态 | Zustand v5 + selector + devtools | 继续做 | 管纯 UI 状态，不保存业务真相源 |
| 异步服务状态 | TanStack Query v5 | 继续做 | React/RN 统一调用 RPC，自动缓存、loading、error、mutation |
| 拖拽排序 | @dnd-kit | 近期做 | 替换手写 HTML5 DnD，解决跨容器、键盘和触摸问题 |
| URL 状态 | nuqs 优先 | 近期做 | 管 viewMode、floatingComponent、activeWorkspace 等可分享状态 |
| 桌面壳 | Wails/Electron/Tauri 只负责窗口层 | 中期做 | 窗口、菜单、托盘、启动 local service，不放业务 |
| Node Runner | Local Service 内流式事件 + operationId | 中期做 | 长任务实时进度、取消、日志聚合 |
| 模块注册 | 代码生成 registry | 中期做 | 支持 workspace 与外部 npm 节点包 |

## 目标架构

```text
apps/
  web/                  React + Vite
  desktop/              Wails/Electron/Tauri shell
  cli/                  平台 CLI，可走 RPC 或直接复用 services
  backend/              Bun + Elysia local service

packages/
  api/                  Elysia app type、Eden client、zod contract
  services/             WorkspaceService / PluginService / WorkflowService
  repository/           Repository interface + SQLite/JSON/Dexie/memory adapters
  runtime/              fs / shell / git / clipboard / node-runner
  shared/               DTO、zod schema、通用工具
  nodes/                独立节点包
```

当前仓库可以渐进迁移，不要求一次性移动到 `apps/*`。第一阶段先在 `packages/*` 建立可编译的服务骨架，再逐步把根应用迁到 `apps/web`。

## 服务分层

### 1. API 层

API 层只描述可远程调用的业务入口：

```ts
const app = new Elysia()
  .get("/workspace", ...)
  .post("/workspace/:id/rename", ...)

export type XiraniteApp = typeof app
```

React、React Native、CLI 都使用同一个 typed client：

```ts
const api = treaty<XiraniteApp>(baseUrl)
const workspaces = await api.workspace.get()
```

### 2. Service 层

Service 是真正业务中心：

```ts
class WorkspaceService {
  constructor(private repo: WorkspaceRepository) {}

  async rename(id: string, label: string) {
    return this.repo.renameWorkspace(id, label)
  }
}
```

Service 不 import React，不 import Wails，不 import Elysia，不 import desktop runtime。

### 3. Repository 层

Repository 是持久化接口：

```ts
interface WorkspaceRepository {
  listWorkspaces(): Promise<WorkspaceDTO[]>
  renameWorkspace(id: string, label: string): Promise<WorkspaceDTO>
}
```

实现可以替换：

| 场景 | Repository adapter |
| --- | --- |
| 桌面默认 | SQLite/libSQL + Drizzle |
| 纯 Web 离线 | Dexie.js |
| 测试 | Memory |
| 过渡期 | JSON storage |
| 云同步 | HTTP/Postgres/libSQL remote |

### 4. Runtime 层

Runtime 管原生能力，不管业务：

- fs
- subprocess
- clipboard
- shell/git
- node runner
- window controls
- event bus

节点包 `core.ts` 只声明自己需要的 runtime 切片，不 import 平台级 `RuntimeInterface`。

## P0: 立即止损

### 1. Zustand 收敛 workspace UI 状态

状态：

- 已开始把 `workspaceContext.tsx` 从 `useReducer + Context` 改到 Zustand。
- 仍需继续拆 slice 和 selector，移除兼容层。

原则：

- Zustand 只管客户端 UI 状态和当前交互状态。
- 不用 Zustand `persist` 保存业务真相源。
- theme/viewMode/cardLayout 这类纯 UI 偏好可以后续单独 persist。

验收：

- 创建、重命名、删除 workspace 正常。
- 部署、隐藏、移动、全屏、lane 移动组件正常。
- `hostApi.env.theme` 跟随真实主题。
- `updateComponent` 单次 mutation，不多次 dispatch。

### 2. TanStack Query 接管服务状态

状态：

- 已开始把 workspace hydrate/persist 改为 query/mutation。
- `useBackend` 应统一由 `useQuery(["backend"])` 管初始化。

原则：

- React Query 管服务数据、RPC 请求、loading/error/mutation。
- Zustand 不直接承担远端数据缓存。
- 后续 RPC client 接入后，Query 的 `queryFn` 从 `getBackend()` 改为 typed RPC client。

### 3. 删除手写基础设施

优先替换：

- 手写 HTML5 DnD -> @dnd-kit
- 裸 `useEffect + useState` 后端请求 -> TanStack Query
- 裸业务表单 -> React Hook Form + zod
- 手写 CLI prompt/progress -> Clack/citty/consola/成熟包

## P1: Local Service 骨架

第一阶段不是立刻替换整个应用，而是先让服务层可以独立编译、测试和运行。

新增包：

```text
packages/shared
packages/repository
packages/services
packages/api
packages/backend
```

第一步只做 workspace 最小闭环：

```text
Elysia route
  ↓
WorkspaceService
  ↓
WorkspaceRepository
  ↓
Memory/JSON adapter
```

验收：

- `bun --filter @xiranite/shared build`
- `bun --filter @xiranite/repository build`
- `bun --filter @xiranite/services build`
- `bun --filter @xiranite/api build`
- `bun --filter @xiranite/backend build`
- `bun --filter @xiranite/backend test`
- 本地 service 能返回 workspace list。

## P2: SQLite 主存储

Local Service 稳定后，把 workspace repository 改为 SQLite/libSQL + Drizzle。

推荐：

- `drizzle-orm`
- Bun runtime 可用 `bun:sqlite`
- 如果需要 Node 兼容，再评估 `better-sqlite3` 或 `@libsql/client`

Schema：

```text
workspaces
lanes
components
component_tags
settings
operation_log
```

原则：

- 每个写操作是事务。
- DTO 用 zod 校验。
- service 不知道底层是 SQLite、Dexie 还是 remote。
- 允许破坏性迁移；当前没有正式用户数据，不为旧 `storage.json` 做复杂兼容。

## P3: 桌面壳瘦身

Wails/Electron/Tauri 不再承载业务：

```text
Desktop shell
  ├─ 启动/停止 local backend
  ├─ 注入 baseUrl + auth token
  ├─ 窗口、菜单、托盘、系统集成
  └─ 加载 React UI
```

本地服务安全要求：

- 默认监听 `127.0.0.1`。
- 默认随机端口。
- 启动时生成 session token。
- React 客户端请求必须带 token。
- 只有用户显式开启局域网访问时才绑定 `0.0.0.0`。

## P4: 节点运行与插件化

NodeRunnerService 属于平台服务层，但不能污染节点包：

```text
NodeRunnerService
  ├─ import @xiranite/node-<id>/core
  ├─ 为节点创建平台 runtime 切片
  ├─ 执行 run<NodeId>(input, runtime, onEvent)
  └─ 通过 RPC/EventStream 推送进度
```

节点包仍然：

- `cli.ts` 独立运行。
- `core.ts` 纯逻辑。
- `platform.ts` 是包内 CLI 的 Node/Bun runtime。
- `Component.tsx` 不导入 backend service。

后续可做：

- 自动发现 workspace 节点包。
- 外部 npm 节点包安装。
- 运行时插件 registry。
- 长任务取消和日志回放。

## P5: UI 与交互清理

继续推进：

- @dnd-kit 替换 lane/kanban 手写 DnD。
- nuqs 管 URL/search 状态。
- React Hook Form + zod 管复杂表单。
- 删除 `niko-table` 等未接入代码。
- 移除错误依赖，显式声明真实依赖。
- 评估 React Compiler，但不早于状态和 DnD 收敛。

## 推荐执行顺序

第一阶段：当前应用止损

1. Zustand 收敛 workspace store。
2. TanStack Query 接管 workspace hydrate/persist 和 backend 初始化。
3. 修复 `createdAt`、`hostApi.env.theme`、`updateComponent` 多 dispatch。
4. 清理明显死代码和错误依赖。

第二阶段：Local Service 最小闭环

1. 建立 `packages/shared` 的 zod DTO。
2. 建立 `packages/repository` 的 workspace repository interface + memory adapter。
3. 建立 `packages/services` 的 WorkspaceService。
4. 建立 `packages/api` 的 Elysia app + typed app export。
5. 建立 `packages/backend` 的 Bun server entry。
6. 加测试验证 service 不依赖 React/Wails。

第三阶段：前端改走 RPC

1. 建立 typed RPC client。
2. React Query queryFn 从 `getBackend()` 切到 RPC client。
3. 保留 Wails runtime 只处理窗口和启动器。
4. 移除前端内嵌 business service。

第四阶段：SQLite 与运行时

1. Drizzle + SQLite/libSQL repository。
2. Runtime package 抽离 fs/subprocess/clipboard/node-runner。
3. NodeRunnerService 流式事件 + operationId。
4. Desktop shell 启动 local backend。

第五阶段：多客户端

1. CLI 可选择直连 local service 或直接复用 services。
2. React Native 使用同一 RPC client。
3. Web 版使用 remote/local backend。
4. 纯 Web 离线模式再引入 Dexie repository adapter。

## 验收门槛

每个阶段至少运行：

```powershell
bun run typecheck
bun run build
bun run test:packages
```

涉及节点包时继续运行：

```powershell
bun --filter @xiranite/node-<id> test
bun --filter @xiranite/node-<id> build
bun scripts/validate-node-architecture.ts --node <id>
```

新增 service 包必须满足：

- 不 import React。
- 不 import Wails runtime。
- 不 import 节点 `Component.tsx`。
- repository 可用 memory adapter 单测。
- API contract 可被前端和 CLI 共同导入。

## 明确不做

- 不让节点 CLI 依赖 Xiranite Local Backend 才能运行。
- 不把业务逻辑继续绑定到 Wails `Call.ByName`。
- 不把桌面壳当业务后端。
- 不在 WebView 里跑 WASM SQLite 作为主存储。
- 不把 Dexie 当桌面主数据源；Dexie 是 browser/offline repository adapter。
- 不用 `dexie-react-hooks` 的 `useLiveQuery` 做主响应式层；React/RN 客户端统一用 TanStack Query。
- 不在节点包 `core.ts` 里 import 平台级 `RuntimeInterface`。
- 不让 `platform.ts` 做不可替换的模块级单例；运行时能力应可工厂化或显式注入。
- 不因为某个库“新潮”就强行引入；优先选能减少手写基础设施、提升类型安全和迁移能力的方案。
