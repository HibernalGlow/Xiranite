# Xiranite 现代化优化决策

## 实时状态

更新时间：2026-07-07

当前阶段：P4 NodeRunner operation 管理、后端 JS bundle 分发、Wails 窗口 resize/弹窗交互修复与桌面 dev proxy 入口已完成；当前恢复 CLI 现代化主线。

已完成：

- [x] 架构主线改为 Local-First + Service-Oriented。
- [x] 明确节点包 CLI 仍然独立运行，不依赖 Xiranite Local Backend。
- [x] RPC 框架决策从 Hono 改为 Elysia + Eden Treaty。
- [x] 新增 `@xiranite/shared`，放置 workspace/lane/component DTO 与 zod schema。
- [x] 新增 `@xiranite/repository`，放置 WorkspaceRepository interface 与 memory adapter。
- [x] 新增 `@xiranite/services`，放置 WorkspaceService 最小业务闭环。
- [x] 新增 `@xiranite/api`，放置 Elysia app 与 Eden client helper。
- [x] 新增 `@xiranite/backend`，放置 Bun local backend server 入口。
- [x] workspace snapshot DTO、Elysia route 与 Eden client 已建立。
- [x] 根应用 workspace hydrate/persist 已从内嵌 backend façade 切到 Elysia RPC client。
- [x] Elysia 写入路由改为 zod body schema 驱动，Eden client 不再需要手动 body cast。
- [x] `bun run dev` 通过 `scripts/dev-with-backend.ts` 启动 Elysia backend，并向 Vite 注入 `VITE_XIRANITE_BACKEND_URL/TOKEN`。
- [x] Wails 壳通过 `StartLocalBackend()` 启动 local backend，并用 Asset Middleware 注入 `window.__XIRANITE_BACKEND__`。
- [x] 后端分发策略改为 `build:backend:js` 输出 `build/wails/xiranite-backend.js`，桌面壳用系统 Bun 启动，不再默认生成大体积 backend exe。
- [x] `wails:build` 已切到 `build:backend:js`，分发产物验证为 `Xiranite.exe` + `xiranite-backend.js`，没有 `xiranite-backend.exe`。
- [x] 新增 `@xiranite/repository/libsql`，使用 `@libsql/client` + Drizzle schema 作为 workspace 主存储 adapter。
- [x] `@xiranite/backend` 默认从 libSQL 文件数据库启动，不再用 memory adapter 作为桌面主存储。
- [x] 数据库默认位置使用系统标准应用数据目录，并支持 `XIRANITE_DATABASE_URL`、`XIRANITE_DATABASE_PATH`、`XIRANITE_DATA_DIR`、`XIRANITE_DATABASE_AUTH_TOKEN` 覆盖。
- [x] 后端 JS bundle 支持 `--database-url`、`--database-path`、`--data-dir`、`--database-auth-token` 参数；相对本地路径按启动工作目录解析为绝对路径。
- [x] libSQL 文件持久化、backend dataDir 持久化、编译后 backend bundle 的 `--data-dir` 重启持久化 smoke 均已验证。
- [x] 新增 `@xiranite/runtime`，先抽离 node runner 清单与 core/platform 调用逻辑。
- [x] 新增 `/nodes/:id/run` Elysia RPC，React `host.actions.run` 已从 `getBackend().nodes.runNode` 切到 Local Backend RPC。
- [x] NodeRunner 已支持 `POST /nodes/:id/operations`、`GET /node-operations/:operationId` 与 `GET /node-operations/:operationId/stream`，通过 operationId 管理运行状态。
- [x] React `host.actions.run` 默认走 operation stream，使用 NDJSON 实时回放事件；旧 `/nodes/:id/run` 仍保留兼容。
- [x] 节点包 CLI 仍然独立运行，不依赖 Local Backend。
- [x] 节点包新增 `./platform` 子路径给 host runtime 使用；`src/index.ts` 仍只导出无壳 Component 与 core。
- [x] backend JS bundle 已验证可直接运行 `/nodes/linedup/run` 与 operation stream，节点 core/platform 已被 Bun bundle 打入分发文件。
- [x] NodeRunner operation 已支持取消、日志分页/查询和过期清理；API/client 已暴露对应契约。
- [x] backend JS bundle smoke 已验证系统 Bun 启动、`--data-dir` 持久化、operation stream 与 cleanup。
- [x] `build:packages`/`test:packages` 已改为基础包 -> 节点包 -> runtime/backend 的显式顺序，避免 fresh build 依赖旧 dist。
- [x] `@xiranite/services` 单测通过。
- [x] `@xiranite/backend` Elysia app 与 token 保护单测通过。
- [x] Go 壳注入逻辑单测通过。
- [x] `bun run typecheck` 通过。
- [x] `bun run test:packages` 通过。
- [x] `bun run build:packages` 通过。
- [x] `bun run build` 通过。
- [x] Wails 主窗口 resize 改为即时 WebView resize，React 卡片布局改为 requestAnimationFrame 合并更新，窗口拖大时不再通过高 debounce 造成新区域黑块。
- [x] 卡片 resize 期间暂停卡片 spring 尺寸动画、backdrop blur 与背景图片 blur，降低拖动/缩放时的 WebView2 合成压力。
- [x] 弹出卡片窗口恢复 frameless；补齐最小化、最大化、关闭按钮，并把弹窗 drag/no-drag CSS 隔离为标题栏可拖、内容区可交互。
- [x] 弹出卡片窗口在独立 WebView store 内确保存在对应 `ComponentInstance`，避免只靠 `moduleIdFallback` 渲染导致模块输入/按钮没有状态写入落点。
- [x] 新增 `dev:desktop`，使用 Wails v3 官方 `FRONTEND_DEVSERVER_URL` dev proxy 让桌面壳连接 Vite dev 端口，同时复用外部 Elysia backend，不再由桌面壳重复启动 backend。
- [x] `backendConfigMiddleware` 在 `FRONTEND_DEVSERVER_URL` 存在时让出 `/`，避免嵌入式 index 注入逻辑抢掉 Wails dev proxy。

进行中：

- [ ] 按 `docs/cli-modernization-plan.md` 继续完善所有 CLI。
- [ ] 将 window/fs 等剩余 `getBackend()` 能力迁到 Local Service 或桌面壳边界。

待办：

- [ ] 为桌面 dev proxy 增加顶栏或设置入口，用于显示当前 UI 来源并重载到 dev 端口；运行时切换需遵守 Wails `FRONTEND_DEVSERVER_URL` 启动时生效的限制。
- [ ] 为 NodeRunner operation 增加 UI 侧 operation 可视化。
- [ ] 把 `@xiranite/runtime/node-runner` 的节点清单改为自动生成或插件 registry，避免长期手写同步。
- [ ] 保持节点包架构扫描，确保 CLI 独立入口不被平台 backend 污染。

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
- `RuntimeInterface` 已存在，包含 fs、subprocess、storage、events、nodeRunner、windows，但 `kind` 还没有 `node`；`packages/backend` 已有 Bun/Elysia 最小服务，且已由 dev/Wails 启动链托管。
- Workspace 状态已经开始从 `useReducer + Context` 收敛到 Zustand。
- TanStack Query 已在主入口存在，workspace hydrate/persist 已切到 Elysia RPC client；dev/Wails 默认会注入 local backend 配置，手动绕开启动器时仍需要显式提供 backend URL/token。
- 节点包结构已经基本正确：`core.ts` 注入 runtime，`cli.ts` 直接调用本包 `core + platform`，`Component.tsx` 作为无壳内容。
- CLI 后续计划单独见 [cli-modernization-plan.md](cli-modernization-plan.md)。

## 总体结论

| 领域 | 推荐方案 | 现在是否做 | 原因 |
| --- | --- | --- | --- |
| 平台架构 | Bun/Node Local Backend Service + 多客户端 | 立即确立 | 避免业务绑定 Wails/Electron/Tauri，长期可迁移到 Web/Mobile/CLI |
| 类型安全 RPC | Elysia + Eden Treaty + zod | 第一阶段做骨架 | Bun-first、高性能、类型推导舒服，RPC contract 可复用到 React、RN、CLI |
| 业务服务 | `@xiranite/services` | 第一阶段做 | WorkspaceService、PluginService、WorkflowService 只写一遍 |
| Repository | 接口优先，libSQL/Dexie/memory adapter | 第一阶段做接口，第二阶段接入 libSQL | service 不关心存储实现，方便本地、Web、测试和云同步切换 |
| 本地主存储 | libSQL + Drizzle | 已接入 | 本地文件数据库，未来也能接 Turso/libSQL remote；不使用 `bun:sqlite` 锁死 Bun runtime |
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
  repository/           Repository interface + libSQL/Dexie/memory adapters
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
| 桌面默认 | libSQL + Drizzle |
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

- workspace hydrate/persist 已由 TanStack Query/Mutation 调用 `@xiranite/api/client`。
- 下一步是把 backend 初始化、错误提示、重试和 dev backend lifecycle 纳入 Query。

原则：

- React Query 管服务数据、RPC 请求、loading/error/mutation。
- Zustand 不直接承担远端数据缓存。
- Query 的 `queryFn`/`mutationFn` 默认调用 typed RPC client；禁止新代码回到 `getBackend().workspace.*`。

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

当前状态：

- 上述 package build/test 已通过。
- 根应用 `bun run typecheck`、`bun run test:packages`、`bun run build` 已通过。
- 当前 repository 默认已从 memory adapter 切到 libSQL + Drizzle；memory adapter 只保留给单测和极小闭环。

## P2: libSQL 主存储

Local Service 稳定后，把 workspace repository 改为 libSQL + Drizzle。当前已完成第一版。

选择：

- `drizzle-orm`
- `@libsql/client`
- 本地默认是 `file://.../xiranite.db`
- 后续可切到 Turso/libSQL remote，不改 Service 层

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
- service 不知道底层是 libSQL、Dexie 还是 remote。
- 允许破坏性迁移；当前没有正式用户数据，不为旧 `storage.json` 做复杂兼容。

数据库位置：

1. `XIRANITE_DATABASE_URL`：完整 libSQL URL，最高优先级，支持本地 `file:` 或远程 libSQL。
2. `XIRANITE_DATABASE_PATH`：指定本地数据库文件。
3. `XIRANITE_DATA_DIR`：指定应用数据目录，数据库文件名固定为 `xiranite.db`。
4. 默认系统标准目录：
   - Windows：`%LOCALAPPDATA%/Xiranite/xiranite.db`
   - macOS：`~/Library/Application Support/Xiranite/xiranite.db`
   - Linux：`${XDG_DATA_HOME:-~/.local/share}/xiranite/xiranite.db`

后端 JS bundle 同时支持命令行参数，便于便携版或脚本启动：

```bash
bun xiranite-backend.js --data-dir ./data
bun xiranite-backend.js --database-path ./data/xiranite.db
bun xiranite-backend.js --database-url libsql://example.turso.io --database-auth-token <token>
```

本地相对路径会按后端启动工作目录解析成绝对路径。自用/当前分发只携带一个 `xiranite-backend.js`，运行时使用系统安装的 Bun；持久化数据落在 JS 外部，默认用系统标准目录，便携版用 `--data-dir ./data` 或 `XIRANITE_DATA_DIR=./data` 固定到随包目录。

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

当前状态：

- `bun run dev` 不再裸跑 Vite，而是先启动 Bun/Elysia backend，再把 URL/token 作为 Vite env 注入 React。
- Wails 壳启动时优先运行 `XIRANITE_BACKEND_URL` 指定的外部服务，其次运行 `XIRANITE_BACKEND_BIN`，再用系统 Bun 启动 `XIRANITE_BACKEND_JS` 或同目录/`build/wails` 下的 `xiranite-backend.js`，最后在开发仓库里回退到 `bun packages/backend/src/index.ts`。
- Wails Asset Middleware 会在 `index.html` 的 `<head>` 内注入 `window.__XIRANITE_BACKEND__`，React RPC client 无需再猜测配置。
- 当前 backend 默认使用 libSQL 文件数据库；memory repository 只用于测试或显式注入。
- React `host.actions.run` 已切到 Local Backend operation stream，不再通过前端 `getBackend().nodes.runNode` 调 Wails/Go。

## P4: 节点运行与插件化

NodeRunnerService 属于平台服务层，但不能污染节点包：

```text
NodeRunnerService
  ├─ 通过 @xiranite/runtime/node-runner 定位节点 core/platform
  ├─ 为节点创建平台 runtime 切片或复用包内 platform runtime
  ├─ 执行 run<NodeId>(input, runtime, onEvent)
  └─ 通过 RPC/EventStream 推送进度
```

节点包仍然：

- `cli.ts` 独立运行。
- `core.ts` 纯逻辑。
- `platform.ts` 是包内 CLI 的 Node/Bun runtime。
- `Component.tsx` 不导入 backend service。

当前状态：

- 已完成 operationId + NDJSON stream：`POST /nodes/:id/operations` 启动任务，`GET /node-operations/:operationId/stream` 实时推送 `operation/event/result` 消息。
- 旧 request/response RPC 仍保留：`POST /nodes/:id/run` 返回 `{ result, events }`，供兼容和简单调用使用。
- 已新增 `@xiranite/runtime`，避免 `desktop/nodeRunner.ts` 与 Local Backend 各维护一份节点清单。
- runtime 通过节点包 `./core` 与 `./platform` 子路径加载，不再使用源码相对路径；backend JS bundle 已 smoke 验证 `linedup` 节点可运行。
- 已增加取消、日志分页/查询、operation 过期清理；仍需 UI 侧可视化。

后续可做：

- 自动发现 workspace 节点包。
- 外部 npm 节点包安装。
- 运行时插件 registry。
- 长任务硬取消：当前 cancellation 是服务层终止语义，未来可在 runtime/节点签名里引入 AbortSignal 后接入真实进程级取消。

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

1. 建立 typed RPC client。已完成 workspace snapshot。
2. React Query queryFn 从 `getBackend()` 切到 RPC client。已完成 workspace hydrate/persist。
3. 保留 Wails runtime 只处理窗口和启动器。已完成 local backend 启动/注入；NodeRunner 已完成 request/response RPC 第一版，剩余 window/fs 仍待收敛边界。
4. 移除前端内嵌 business service。

第四阶段：libSQL 与运行时

1. Drizzle + libSQL repository。已完成第一版。
2. Runtime package 抽离 fs/subprocess/clipboard/node-runner。已完成 node-runner 第一版。
3. NodeRunnerService 流式事件 + operationId。已完成取消、日志查询/分页和过期清理第一版。
4. Desktop shell 启动 local backend。已完成第一版；后续随 NodeRunner 继续瘦身。

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
