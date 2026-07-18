# Xiranite 现代化优化决策

## 实时状态

更新时间：2026-07-07

当前阶段：P4 Local Backend / NodeRunner operation / Wails 窗口与 dev proxy 主线已完成；CLI 与节点测试矩阵、operation UI、旧 EngineV facade 清理、节点 registry 代码生成、前端死代码清理、LaneView/Kanban `@dnd-kit` 迁移、view renderer lazy-load 拆包、FlowView 轻壳 + idle tldraw gate、OverlayHost 视图按需加载、FloatingComponentWindow 独立 chunk、workspace 动画运行时移除、DatabaseModule 轻壳 + ocean 实现拆分、BlockNoteModule 轻壳 + idle 重编辑器拆分、workspace Zustand selector/direct actions、内部 reducer 移除与 slice 拆分、UI 偏好 Zustand persist、nuqs URL 状态第一轮接入、Local Backend lifecycle TanStack Query 收口与运行时错误提示条均已收尾。验收标准维持为 Vitest + React Testing Library + happy-dom + MSW + Playwright，真实运行测试必须使用真实文件或真实本机能力，产物写入 `artifacts/`。

当前 ToDo：

- [x] `audit:node-runtime-risks` 当前为 24/24 clean：stale logs、缺少 `finally`、缺少 `host.actions.run` fallback、PowerShell 非交互与进度污染均已横向扫过。
- [x] `audit:node-architecture` 已接入根 package scripts，并纳入 `test:packages`；当前全量节点架构校验通过，覆盖 contract 不暴露 card/runner/CLI 字段、Component 无壳、CLI 不导入 React UI、core 不碰平台 API、demo shell 不出现在 exports。
- [x] Playwright 真实浏览器测试当前 32/32 passed，覆盖 24 个保留节点、DatabaseModule 真实渲染、FlowView 空画布/非空画布 lazy-load、LaneView/Kanban DnD 与 nuqs URL 状态；`recycleu` 已真实清理限定 C 盘回收站 fixture，未触碰既有 D/E 回收站内容。
- [x] `enginev` 已通过真实路径 `E:\SteamLibrary\steamapps\workshop\content\431960` 的本地预览图直通显示测试；后端 Vitest 已锁住 `/local-files` 未授权 401、授权后 `image/png` 与真实字节直通，Playwright 真实点击用例已断言 `<img>` 使用 token 保护的 backend `/local-files` URL，且 query path 落在真实 Workshop 根目录下，并会直接 GET `img.src` 验证返回 `image/*` 与非空字节，不走 `file://`、base64 或前端缓存替代。
- [x] 节点清单已改为代码生成：`scripts/generate-node-registries.ts` 生成 runtime `node-runner.generated.ts` 与前端 `packageModules.generated.ts`；`build:packages`、`test:packages`、`typecheck` 会先运行生成器，避免 runtime、registry、ModuleRenderer 三处手写同步。
- [x] 前端节点包入口已从静态 import 全量 `NodeEntry` 改为“静态 metadata + 动态 entry loader”：Registry 只读取生成的 `NodeDef` 字面量，`ModuleRenderer` 在实际渲染节点时才 lazy import 对应 `@xiranite/node-*`；生产构建主入口从约 1.09 MB 降到约 670 KB，24 个节点 UI 被拆为独立按需 chunk。
- [x] `OverlayHost` 已从静态导入四个 overlay 页面改为按需加载：ModuleRegistry、ThemeSettings、DeploymentHub、NodeOperationMonitor 只在对应 overlay 打开时请求；生产构建主入口从约 676 kB 进一步降到约 617 kB，四个 overlay 独立 chunk 约 5.5 kB / 6.0 kB / 34.2 kB / 6.1 kB。
- [x] `FloatingComponentWindow` 已从 `App.tsx` 静态导入改为 `React.lazy`，普通主窗口不再携带弹出卡片窗口 UI；当前生产构建主入口 `index-DeBfsXAJ.js` 为 614.22 kB，弹窗独立 chunk `FloatingComponentWindow-DgBboRYW.js` 为 3.24 kB。
- [x] workspace 主路径已移除 `motion/react`：`WorkspaceLayout`、`CardView`、`ComponentCard`、`OverlayHost` 的淡入、卡片位移和抽屉进入改用 CSS transform/transition/animate 类，根依赖 `motion` 已删除；生产构建主入口从 614.22 kB / gzip 196.82 kB 降到 `index-Bl_ViTJY.js` 487.05 kB / gzip 155.07 kB。
- [x] `DatabaseModule` 已进一步拆成约 1.98 kB 轻壳与约 637 kB `DatabaseDataView` ocean 实现 chunk；轻壳首帧只渲染稳定 skeleton，占位会在 browser idle 时自动加载数据视图，用户点击/聚焦可立即加载。此前 CSS/视图 JS 拆分仍保留，Table/List/Gallery/Board 视图继续用带 `dataViewType/defaultLimit` 静态标记的 `React.lazy` 子组件。新增 happy-dom 测试覆盖首帧不渲染重 ocean 实现与点击加载；Playwright 数据库用例通过真实 backend snapshot 验证表格行、标签与 Table/List 视图渲染。
- [x] CLI runtime 瘦身第一轮完成：删除与 `citty` 重叠的 `parseArgs/flag*`，新增 `renderCliEvent/writeCliEvent` 统一节点运行事件输出；22 个节点 CLI 显式命令进度输出已从手写 `[xx%]` 切到 runtime 进度条，`renderProgressBar` 修复纯文本比例不可见问题并补宽度/中文/event formatter Vitest。
- [x] CLI 真实 pseudo-tty 视觉验证已从 `repacku` 单测抽成 `scripts/cli-visual-testing.ts`，并新增 Node 父进程手动捕获脚本 `scripts/capture-cli-ui.ts`；截图工具已经可捕获 `repacku`、`linedup`、`rawfilter`、`marku` 与 `cleanf` guided 首屏。但这些截图不等于最终体验验收，后续 CLI 必须按原始 Python/Taskfile/Rich/Typer 源码体验复刻并优化，减少手动输入，不能套统一 `Entry / Run / Script` 模板。
- [x] 前端死代码清理已完成：删除未接入的 `src/components/niko-table`，移除根应用未使用的 `@xyflow/react` 与 `@tanstack/react-table` 直接依赖；`@tanstack/react-table` 仍可能作为 `vendor/ocean-dataview` 的内部依赖留在 lockfile。
- [x] LaneView 的 lane/card 跨容器拖拽已从 HTML5 `dataTransfer` + `dragState` 单例迁移到 `@dnd-kit`；`src/store/dragState.ts` 已删除，Playwright 真实浏览器测试会校验 DOM 位置与 backend snapshot 同步更新。
- [x] KanbanModule 的卡片跨列拖拽已从 HTML5 `draggable/onDrop/onDragOver` 迁移到 `@dnd-kit`，并补真实浏览器测试验证 backlog -> active 的 DOM 迁移。
- [x] `DockviewView`、`FlowView`、`LaneView` 已改为 lazy-loaded view renderer；`FlowView` 进一步拆成约 2.84 kB 轻壳与重型 `FlowCanvasView`，空 Flow 页不会请求 tldraw 画布 chunk，非空 Flow 首帧也只渲染稳定 skeleton，随后在 browser idle 或用户点击/聚焦时加载约 1.36 MB 的 tldraw 画布；Kanban 与 Lane 共享 dnd-kit sortable chunk，避免 cards-first 主 bundle 直接携带 tldraw、dockview 与重复拖拽实现。
- [x] `BlockNoteModule` 已拆成约 1.81 kB 轻壳与约 752 kB `BlockNoteEditor` 重编辑器 chunk；轻壳首帧只渲染稳定 skeleton，占位会在 browser idle 时自动加载编辑器，用户点击/聚焦可立即加载。新增 happy-dom 测试覆盖首帧不渲染重编辑器、idle/点击加载与 `setData({ doc })` 写回。
- [x] workspace Zustand selector 第一轮已完成：`useComponentData`、`ModuleRenderer`/`hostApi`、WorkspaceLayout、CardView、TopBar、LaneView、DockviewView、FlowView、OverlayHost、ModuleRegistry、ThemeSettings、DatabaseModule 均已移出全量 `useWorkspace()` 订阅；旧 `useWorkspace()` 全量订阅兼容 hook 已删除，避免新代码回退到全 store 订阅。
- [x] workspace store 调用侧已从 `useWSDispatch() + actions.*` 迁移到 `useWorkspaceActions()`；旧 `useWSDispatch` 与 `actions` 导出已删除，内部 `Action` union、`reducer()` 与 `run({ type })` 过渡层也已移除。当前 actions 已按 `uiSlice`、`workspaceSlice`、`componentSlice`、`laneSlice`、`backendSlice` 拆到 `src/store/workspace/`，`workspaceContext.tsx` 只保留 Provider、persist、DTO 转换与 selector hooks。
- [x] workspace UI 偏好已从手写 `localStorage` key 迁到 Zustand `persist` middleware：`theme`、`cardLayout`、grain/vignette/action/card elevation 与背景模式/图片/透明度/模糊统一写入 `xiranite-workspace-ui`，业务 workspace snapshot 仍只走 Local Backend/libSQL，不进浏览器 localStorage；新增 happy-dom 单测锁住 partialize 范围与旧 `xiranite-bg-*` key 不再写入。
- [x] URL 状态第一轮已接入 `nuqs`：主界面 `view` 与 `workspace` 参数可从 URL 恢复并随顶栏切换回写；弹出卡片窗口参数已从手写 `URLSearchParams` 改为 `useQueryStates`，并新增 Playwright 用例覆盖 hydration 时序与弹窗兼容。
- [x] 窗口控制异步调用第一轮已从组件内 `await getBackend().windows.*` 抽到 `useWindowControls()`，使用 TanStack Query mutation 管理主窗口控制、弹出组件窗口与关闭弹窗，`TopBar`、`ComponentCard`、`FloatingComponentWindow` 不再直接拼后端窗口调用。
- [x] Local Backend lifecycle 已纳入 TanStack Query：`WorkspaceProvider` 会先等 health ready 再加载 workspace snapshot，missing-config/unreachable 时停止 snapshot RPC 与 persist；workspace RPC client 会随 backend 配置变化重建，主界面新增轻量运行时错误提示条，可直接重试或打开运行时设置。
- [x] selector/direct actions、内部 reducer 移除、slice 拆分、UI 偏好 persist、URL 状态、窗口控制 mutation、节点 UI 动态 loader、FlowView idle tldraw gate、OverlayHost 视图按需加载、FloatingComponentWindow 拆包、workspace 动画运行时移除、DatabaseModule 轻壳化、BlockNoteEditor idle 拆包与 Local Backend lifecycle 收敛后已通过 `bun run typecheck`、`bun run test:unit`、`bun run build`、`bun run audit:node-architecture`、`bun run audit:node-tests -- --strict`、`bun run audit:node-runtime-risks` 与 `XIRANITE_ENGINEV_REAL_WORKSHOP_PATH='E:\SteamLibrary\steamapps\workshop\content\431960' bun run test:e2e -- --project=chromium-desktop`；Vitest 当前为 91/91 files、270/270 tests，真实浏览器为 32/32 passed，覆盖节点组件 host API 写回、EngineV 真图直通、backend `/local-files` 字节流响应、CLI runtime 富文本事件输出、repacku/linedup/rawfilter/marku/cleanf guided 真实 PTY 截图、Database 真实渲染、FlowView lazy-load、Lane/Kanban DnD、CSS transition 卡片布局与主界面/弹窗 URL 状态。
- [x] Playwright 真实能力套件默认改为 1 worker 串行执行，避免本地后端、真实文件、回收站和本地图片测试在 8 worker 并发下产生偶发点击/资源竞争；如需临时压测并发可设置 `XIRANITE_E2E_WORKERS`。
- [x] `audit:node-tests` 已识别 `tests/e2e` 的 real-run 标记；24/24 节点均已有真实运行证据。
- [x] `migratef` 已补齐 React Testing Library + happy-dom Component 测试，验证 `host.actions.run("migratef")`、plan 参数、进度日志、result 与复制日志写回。
- [x] `enginev` 已补齐 CLI + Component 测试：CLI 使用真实 `project.json + preview.png` fixture 跑 `scan --json`；Component 验证本地 preview 经 `host.localFiles.getUrl()` 转成图片 URL。
- [x] `encodeb` 已补齐 CLI + Component 测试，并修复 `--json` 模式进度文本污染 stdout 的问题；CLI 使用真实 suspicious 文件名 fixture。
- [x] `findz` 已补齐 CLI + Component 测试；CLI 使用真实 jpg/png/txt 文件夹搜索，Component 验证搜索参数、结果渲染与复制结果。
- [x] `formatv` 已补齐 CLI + Component 测试；CLI 使用真实 mp4/.nov/prefixed/txt 文件夹跑 `scan --json`，Component 验证扫描参数、日志、结果渲染与复制结果。
- [x] `bandia` 已补齐 CLI + Component 测试；CLI 用真实文件夹 dry-run 压缩与 EFU 导出，Component 锁住压缩模式普通源路径、结果目标显示与复制。
- [x] `dissolvef` 已补齐 CLI + Component 测试；CLI 用真实 nested 目录执行 dissolve 与 undo，Component 验证 plan 参数、进度日志与结果渲染。
- [x] `kavvka` 已补齐 CLI + Component 测试；CLI 用真实目录扫描关键词并移动 sibling 到 `#compare`，Component 锁住默认 dry-run 与结果复制。
- [x] `lata` 已补齐 CLI + Component 测试；CLI 用真实 `Taskfile.yml` 自动发现、执行 shell 命令并返回纯 JSON，Component 验证 plan 参数、日志与任务渲染。
- [x] `linku` 已补齐 CLI + Component 测试；CLI 用真实目录 symlink/junction 与 `linku.toml`，Component 验证 `move_link` 参数与 progress 日志。
- [x] `movea` 已补齐 CLI + Component 测试；CLI 用真实目录扫描并按 JSON plan 移动压缩包/散文件夹，Component 验证 scan 参数、日志与结果渲染。
- [x] `mvz` 已补齐 CLI + Component 测试；CLI 用真实 findz entry 文件与 archive 路径 dry-run extract/rename，Component 锁住默认 dry-run 与结果复制。
- [x] `owithu` 已补齐 CLI + Component 测试；CLI 用真实 TOML preview 不触碰注册表，Component 验证 register 参数与 progress 日志。
- [x] `scoolp` 已补齐 CLI + Component 测试；CLI 用真实 Scoop bucket/cache/TOML fixture 覆盖 list/info/sync/cache backup，Component 验证 cache 参数、progress 日志、结果渲染与复制日志。
- [x] `seriex` 已补齐 CLI + Component 测试；CLI 用真实 Alpha/Beta 文件生成 plan 并实际移动到系列目录，Component 验证 plan 参数、progress 日志、结果渲染与复制日志。
- [x] `trename` 已补齐 CLI + Component 测试；CLI 用真实目录扫描、真实文件重命名、undo store/history 与真实 undo 回滚，Component 验证 scan 参数、progress 日志、JSON 回填与复制。
- [x] 当前节点测试矩阵为 24/24 complete；`bun run audit:node-tests -- --strict`、`bun run audit:node-runtime-risks`、`bun run typecheck`、`bun run test:unit`、`bun run test:packages`、`bun run build`、`bun run test:e2e -- --project=chromium-desktop` 均已通过，当前 Playwright 为 32/32 passed。

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
- [x] NodeRunner operation 已增加前端运行监控面板：`host.actions.run` 会同步写入 Zustand operation store，顶栏提供节点运行入口，面板显示 active/recent/finished、进度、最近事件、取消与清理入口。
- [x] 节点 registry 已从手写同步改为代码生成：runtime NodeRunner、前端模块 metadata 与 ModuleRenderer package map 统一来自 `packages/nodes/*/package.json` 扫描结果；`enginev` 和 `linedup` 的运行时命名例外由生成器 override 管理。
- [x] 前端节点包 registry 已进一步拆成 metadata 与 lazy loader：生成器从各节点 `src/index.ts` 的 `def` 字面量提取 `NodeDef`，避免 registry import 节点组件；`ModuleRenderer` 使用动态 import 加载实际节点 UI。
- [x] 删除未接入的 `src/components/niko-table` 死代码目录，并移除根依赖中的 `@xyflow/react` 与 `@tanstack/react-table`；FlowView 已不再使用 React Flow，表格组件当前走现有模块实现。
- [x] 已删除旧 `src/backend/services/enginevService.ts` 与未注册的旧 `EngineVModule.tsx`，`enginev` 只保留节点包 `@xiranite/node-enginev` + Local Backend NodeRunner 路线；前端 `getBackend()` 目前只剩窗口控制/弹窗打开这些桌面壳边界调用。
- [x] backend JS bundle smoke 已验证系统 Bun 启动、`--data-dir` 持久化、operation stream 与 cleanup。
- [x] `build:packages`/`test:packages` 已改为基础包 -> 节点包 -> runtime/backend 的显式顺序，避免 fresh build 依赖旧 dist。
- [x] `@xiranite/services` 单测通过。
- [x] `@xiranite/backend` Elysia app 与 token 保护单测通过。
- [x] `@xiranite/backend` 的 local server 启动层从 `Bun.serve` 改为 Node `http` 适配 Fetch `Request/Response`，后端 JS 可在 Node/Bun 环境下测试和运行。
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
- [x] 新增 `dev:desktop:attach`，用于在已运行 `bun run dev` 时只启动桌面壳并附着到现有 Vite/Elysia 端口。
- [x] 设置页新增开发运行时面板，顶栏新增轻量 dev 状态入口；运行时切换遵守 Wails `FRONTEND_DEVSERVER_URL` 启动时生效的限制。
- [x] 按使用价值裁剪 `reinstallp` 与 `weibospider`，从模块注册、Renderer、Local Backend NodeRunner、聚合 CLI、依赖清单和 i18n 中移除。
- [x] 明确节点验收不再接受手动命令 smoke 作为通过标准；CLI、core、Component 必须使用测试框架覆盖，真实文件测试只能写入已忽略目录。
- [x] 测试栈决策：Vitest 统一执行 unit/core/CLI/Component 测试；React Testing Library + happy-dom 测 Component；MSW 用于 HTTP/RPC mock；Playwright 用于真实浏览器 E2E、截图和视觉验证。
- [x] 新增 `test:unit`、`test:e2e`、Playwright 配置与 MSW 测试工具入口；Playwright 产物写入 `artifacts/playwright*`。
- [x] 全仓测试从 `bun:test` 迁到 `vitest`；节点包 `test` 脚本统一限定到 `src`，避免历史 `dist/*.test.js` 污染测试。
- [x] `scripts/audit-node-tests.ts` 已改为检查 core / CLI / Component / 真实运行标记 / Vitest script / 禁止 `bun:test`。
- [x] `repacku` 已补 Vitest CLI 测试与 React Testing Library + happy-dom Component 测试，真实文件 fixture 位于 `artifacts/test-runs` 并在测试后清理。
- [x] `repacku` platform 去掉 `Bun.file/Bun.write`，改用 Node `fs/promises`，保证独立 npm 包不强依赖 Bun 全局。
- [x] `linedup` 已补 Vitest CLI 测试与 React Testing Library + happy-dom Component 测试，覆盖非交互引导拒绝、JSON 脚本模式、真实文件输入输出、剪贴板、过滤、复制和下载。
- [x] `rawfilter` 已补 Vitest CLI 测试与 React Testing Library + happy-dom Component 测试，覆盖非交互引导拒绝、中文路径 fixture、JSON plan、`host.actions.run` 调用、日志/result 写回和复制计划。
- [x] `rawfilter` Component 修复为通过 `host.actions?.run` 请求宿主执行，不再固定走 unavailable native action。
- [x] `marku` 已补 Vitest CLI 测试与 React Testing Library + happy-dom Component 测试，覆盖非交互引导拒绝、inline JSON、真实文件输入输出、`host.actions.run` 调用、日志/result 写回和复制输出。
- [x] `marku` Component 修复为通过 `host.actions?.run` 请求宿主执行，不再固定走 unavailable native action；旧 `xiranite-marku` 文案已移除。
- [x] `sleept` 已补 Vitest CLI 测试与 React Testing Library + happy-dom Component 测试，覆盖非交互引导拒绝、status JSON、countdown dry-run JSON、宿主执行、stats 刷新和 live/dry 参数传递。
- [x] `sleept` Component 修复为宿主优先执行；无宿主时才退回浏览器 dry-run。`sleept --json` 修复为纯 JSON，不再混入进度文本。
- [x] 横向修复仍使用 `createUnavailableNativeAction` 的节点 Component：统一改为 `host.actions?.run ?? unavailable fallback`，避免 Xiranite 集成时按钮固定无效；节点构建与根级 Vitest 已通过。
- [x] `cleanf` 已补 Vitest CLI 测试与 React Testing Library + happy-dom Component 测试，覆盖非交互引导拒绝、中文路径 preview JSON、纯 JSON 输出、宿主执行、预览结果和日志复制。
- [x] `cleanf --json` 修复为纯 JSON，不再混入进度文本。
- [x] 默认 backend node runner 已从“节点结束后回放事件”改为执行时实时转发事件，前端 `host.actions.run` 的 operation stream 不再等任务结束才更新。
- [x] 新增 backend 真实节点集成测试：通过本地 HTTP backend + Eden node client + operation stream，用真实中文/空格路径与真实 fixture 文件验证 `cleanf`、`rawfilter`、`marku`、`repacku`、`sleept`。
- [x] `linedup` 已用真实文本文件输入输出测试标记为 real-run；平台节点 real-run 由 backend 集成测试标记。
- [x] `crashu` 已补 CLI、Component 与 backend real-run 测试，真实中文/空格路径下可经 operation stream 生成迁移计划。
- [x] `recycleu` 已补 CLI、Component 与 backend real-run 测试；Component progress 事件现在会同步倒计时与日志，异常不会让卡片卡在 running。
- [x] 当前节点测试矩阵已扩展为 24/24 complete，所有保留节点均按 core / CLI / Component / real-run 口径通过。
- [x] `bun run test:unit` 已明确排除 `tests/e2e`，避免 Vitest 误跑 Playwright spec；当前通过 86 个测试文件、261 个测试，新增覆盖 Local Backend lifecycle gating、missing/unreachable 不触发 workspace RPC、ready 后 hydrate、运行时错误提示条、FlowView 空画布不加载 tldraw 与非空 idle/点击加载、OverlayHost 关闭时不加载 overlay 页面、DatabaseModule 轻壳 idle/点击加载，以及 BlockNote 轻壳 idle 加载与文档写回。
- [x] `bun run test:e2e -- --project=chromium-desktop` 通过 32/32 真实浏览器测试，包含 24 个保留节点、EngineV 真实 Workshop 本地图片直通显示、DatabaseModule 真实渲染、FlowView 空/非空 lazy-load、LaneView/Kanban DnD 和 nuqs URL 状态。
- [x] LaneView 的 lane/card 跨容器拖拽已迁移到 `@dnd-kit`，并删除旧 `src/store/dragState.ts`；新增 Playwright 用例验证跨 lane 移动卡片、lane 重排、DOM 顺序与 backend snapshot 一致。
- [x] KanbanModule 已迁移到 `@dnd-kit`，删除手写 HTML5 `draggable/onDrop/onDragOver`，并新增 Playwright 用例验证卡片跨列移动。
- [x] 主 view renderer 已拆为 lazy chunk：CardView 仍静态优先，DockviewView/FlowView/LaneView 延迟加载；FlowView 轻壳不会在空画布时加载 tldraw，非空画布也改为 idle/点击触发；dnd-kit sortable 被抽成共享 chunk，避免 Lane/Kanban 重复打包。
- [x] 前端节点包入口已从全量静态 import 改为按需动态加载，避免主 bundle 为 registry 预加载 24 个节点 Component。
- [x] workspace selector 第一轮已完成：新增 `useWorkspaceSelector`、`useWorkspaceShallowSelector`、`useWorkspaceVisibleComponents`、`useWorkspaceComponent`、`useWorkspaceComponentData` 与 `getWorkspaceState`；节点 host API 不再订阅全量 components，而是在调用时读取最新 store snapshot。
- [x] workspace UI 偏好已改由 Zustand `persist` partialize 管理，移除 reducer 内手写 `localStorage.setItem` 副作用和模块初始化时手写 `localStorage.getItem`。
- [x] workspace store 已完成 slice 拆分：`workspaceContext.tsx` 从约 900 行降为 Provider/hooks 入口，状态转换函数进入 `src/store/workspace/{ui,workspace,component,lane,backend}Slice.ts`，共享初始状态、类型和 id counter 分离管理。

进行中：

- [x] 按 `docs/cli-modernization-plan.md` 完成保留节点 CLI/Component 测试矩阵收尾。
- [x] 逐个节点补齐 core / CLI / Component / real-run 测试矩阵，按 `docs/aestivus.md` 的保留节点功能范围验收；当前 `audit:node-tests -- --strict` 为 24/24 complete。
- [x] 为 NodeRunner operation 增加 UI 侧 operation 可视化。
- [x] 将旧 fs/EngineV 业务 facade 从前端 `getBackend()` 路径移除；保留的 `getBackend().windows.*` 属于桌面壳边界。
- [x] 将 LaneView 的手写 HTML5 DnD 迁移到 `@dnd-kit`，并补真实浏览器跨 lane/card 拖拽测试。
- [x] 将 KanbanModule 的手写 HTML5 DnD 迁移到 `@dnd-kit`，并补真实浏览器跨列拖拽测试。
- [x] 完成 workspace Zustand selector/direct actions 第一轮收敛，移除应用层全量 `useWorkspace()` 订阅点与旧 `useWSDispatch()/actions` 导出，将 UI 偏好持久化迁到 Zustand `persist` middleware，并拆成 workspace/component/lane/ui/backend slices。
- [x] 完成主界面与弹窗的 nuqs URL 状态第一轮接入，覆盖 `view`、`workspace`、`floatingComponent`、`moduleId`、`windowId` 与 `title`。
- [x] 完成窗口控制异步状态第一轮收敛，窗口控制/弹窗打开/弹窗关闭统一走 TanStack Query mutation hook。
- [x] 完成前端节点包 registry 懒加载改造，Registry metadata 与 Component entry 分离。
- [x] 完成 backend 初始化、错误提示与 dev backend lifecycle 的 TanStack Query 收口，workspace hydrate/persist 由 Local Backend health 状态驱动。
- [x] 完成 `BlockNoteModule` 轻壳化，重型 BlockNote 编辑器拆到 idle/click 触发的独立 chunk。
- [x] 完成 `DatabaseModule` 轻壳化，重型 ocean-dataview 实现拆到 idle/click 触发的独立 chunk，入口 chunk 从约 637 kB 降到约 1.98 kB。
- [x] 完成 `FlowView` 轻壳化第二轮，非空 Flow 首帧不再立刻解析 tldraw，重型 `FlowCanvasView` 改为 idle/click/focus 触发。
- [x] 完成 `OverlayHost` 视图按需加载，默认关闭状态不再静态拉入模块库、设置、部署中心和节点运行面板。
- [x] 完成节点架构扫描常态化：新增 `audit:node-architecture`，并接入 `test:packages`。

待办：

- [ ] 继续前端 UI/性能与状态管理优化主线，结合真实交互继续观察 `FlowCanvasView`/tldraw、`DatabaseDataView`/ocean 与 `BlockNoteEditor` 这些重型延迟 chunk 是否还需要 manualChunks、预取策略或更细加载边界。

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
- Workspace 状态已经从 `useReducer + Context` 收敛到 Zustand，并完成 selector/direct actions、内部 reducer 移除与 slice 拆分。
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
| 客户端状态 | Zustand v5 + selector + devtools | selector/direct actions、内部 reducer 移除与 slice 拆分已做 | 管纯 UI 状态，不保存业务真相源 |
| 异步服务状态 | TanStack Query v5 | 继续做 | React/RN 统一调用 RPC，自动缓存、loading、error、mutation |
| 拖拽排序 | @dnd-kit | Lane/Kanban 已做，继续横扫残留 | 替换手写 HTML5 DnD，解决跨容器、键盘和触摸问题 |
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

- 已把 `workspaceContext.tsx` 从 `useReducer + Context` 收敛到 Zustand store。
- selector 第一轮已完成：应用层调用已从全量 `useWorkspace()` 改为字段级 selector，旧 `useWorkspace()` 全量订阅兼容 hook 已删除。
- direct actions 已完成：旧 `useWSDispatch`、`actions` 导出、内部 `Action` union、`reducer()` 与 `run({ type })` 过渡层已删除。
- slice 拆分已完成：UI 偏好、workspace 列表、component 状态、lane/cardOrder、backend hydrate 分别放入 `src/store/workspace/*Slice.ts`。

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
- backend 初始化、错误提示和 dev backend lifecycle 已纳入 Query：Local Backend health query 先判断 `ready/missing-config/unreachable`，workspace snapshot query 只在 ready 后启用，persist 也要求 backend 仍然 ready。
- 主界面新增运行时错误提示条，missing-config/unreachable 时可直接重试或打开运行时设置；对应 happy-dom 单测覆盖 missing/unreachable 不触发 workspace RPC、ready 后 hydrate。

原则：

- React Query 管服务数据、RPC 请求、loading/error/mutation。
- Zustand 不直接承担远端数据缓存。
- Query 的 `queryFn`/`mutationFn` 默认调用 typed RPC client；禁止新代码回到 `getBackend().workspace.*`。
- 前端显示 backend 状态时不得泄露 token；Query key 只区分 backend URL 和 token 是否存在，实际 token 只交给 RPC client。

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
- 已增加取消、日志分页/查询、operation 过期清理与 UI 侧运行监控面板。

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
3. 保留 Wails runtime 只处理窗口和启动器。已完成 local backend 启动/注入；NodeRunner 已完成 request/response 与 operation stream；旧 fs/EngineV 业务 facade 已删除，当前 `getBackend().windows.*` 仅作为桌面壳边界保留。
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
