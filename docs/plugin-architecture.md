# Xiranite Plugin Architecture：Module Federation 2.0 前端运行时 + Extism 后端运行时

- Status: proposed（第一阶段产物：现状盘点 + 目标架构 + POC 边界。实现顺序见文末）
- Date: 2026-10-04
- Related: `docs/adr/0063-rewrite-backend-in-rust-with-tauri2-axum-extism.md`、
  `docs/adr/0065-serve-webview-over-loopback-bearer-channel.md`、
  `docs/adr/0068-keep-the-plugin-api-wit-migratable-with-extism-as-adapter.md`、
  `docs/adr/0069-keep-node-cli-tui-gui-triad-with-clap-ratatui-react.md`、
  `docs/adr/0067-use-ast-inventories-as-migration-source-of-truth.md`
- 证据口径（ADR-0067）：本文所有「今天是什么样」的断言都指向符号名与一条可现读命令，不写行号；
  行号会随改动腐烂。文中「未实测」的项目在实现阶段必须先用实机证据替换掉。

## 0. 一句话结论

Module Federation 2.0 是 **前端 runtime adapter**，不是 Xiranite 的插件协议。Xiranite 自己拥有
Plugin Manifest（`manifest.toml`）与 Plugin API；`module-federation` 负责 frontend module 的解析与
加载，`extism` 负责 `plugin.wasm` 的执行，二者互不渗透，且都允许缺位——这就是三种插件形态
（frontend-only / backend-only / full）的基础。

```
                        Xiranite Plugin
                              │
                        manifest.toml            ← 唯一真源（Xiranite 拥有）
                              │
             ┌────────────────┼────────────────┐
             │                │                │
         [frontend]        [backend]      [[contributions]]
             │                │                │
     runtime =          runtime =         route / panel /
     "module-            "extism"         tab / command / widget
     federation"            │
             │                ▼
             ▼           plugin.wasm
   mf-manifest.json          ▲
   remoteEntry.js            │
   (MF runtime 自有)     Rust Host ──── Xiranite Plugin API（能力词表 + operation 生命周期）
                              ▲
                              │ HTTP /operations 族 + 受限 Frontend Host API
                        Frontend Plugin
```

未来 backend 还可以挂 `runtime = "native-process"` 之类的 adapter；本文件不为它预留抽象，只保证
`[backend] runtime` 是一个可扩展的判别字段，而不是「backend 必然等于 wasm」的硬编码。

## 1. 现状架构（已实测）

### 1.1 Node 契约与加载链

- 契约全部集中在 `packages/contract/src/index.ts`：零框架依赖，只有 `@xiranite/shared`。关键类型
  `NodeDef`、`NodeEntry = AppNodeEntry`、`HeadlessNodePackage`、`NodeComponent`、
  `NodeComponentProps{compId,host}`、`NodeHostApi`、`NodeHostCapabilities`、`NodeHostRequirements`、
  `NodeSchemas`、`NodeWindowPreferences`、`NodeTrayDeclaration`、`NodeCapabilityId`（9 项闭集）。
- **NodeEntry 的两半分居两处**：`def`/`core` 属于 `packages/nodes/<id>/src/index.ts`（导出
  `satisfies HeadlessNodePackage`），`Component`/`host`/`schemas`/`window`/`tray` 属于宿主树
  `src/nodes/<id>/entry.ts`。现读：

  ```sh
  ls src/nodes/*/entry.ts | wc -l        # 与 Component.tsx 同数
  ls src/nodes/*/Component.tsx | wc -l
  ls packages/nodes/*/src/Component.tsx 2>/dev/null | wc -l   # 0：组件不在 node 包里
  ```

- 前端 loader 由生成物驱动：`scripts/generate-node-registries.ts` → `packageModules.generated.ts`
  里的 `PACKAGE_MODULES`（元数据）、`packageModuleLoaders`（每条是**字面量** `import("@/nodes/<id>/entry")`，
  Vite 才能切 chunk）、`nodeHelpLoaders`。唯一取 loader 的地方是
  `src/components/modules/ModuleRenderer.tsx` 的 `packageNodeEntryLoaders[moduleId]`
  与 `PackageNodeRenderer` 里的同一次下标；缓存与失败重试在 `packageNodeEntryLoads`。
  → **「NodeEntry 从哪里来」有且仅有一个切点**，这是本方案能不动 43 个节点的前提。
- `import.meta.glob` 全仓零命中；清单 100% 编译期写死，只有「何时 load 哪个 key」是运行时。

### 1.2 宿主能力注入（现状是真话还是假话）

- 唯一构造点 `useNodeHostApi(compId, nodeId, schemas)`（`src/components/modules/hostApi.ts`），唯一
  生产调用点在 `ModuleRenderer`。九个能力域 `contract/state/workspace/runner/clipboard/downloads/
  localFiles/config/env` 由模块级常量 `injectedCapabilities` 一次性全量注入。
- **`contract.supportedCapabilities` 声称「宿主只注入这些」，实现却是恒定全量**；
  `hasCapability()` 只查那张常量表。所以第三方接入之前，这个接口是不成立的陈述。
- `NodeHostRequirements` 的唯一消费者是 `diagnoseHostRequirements`：缺能力时**硬拒渲染**出一张诊断卡，
  既不降级也不裁剪；43 个 entry 里只有 4 个声明了 `host`，其余走 `null` 短路，等于默认全信任。
- 版本协商 `isContractVersionCompatible` 只接受「精确相等」和 `^x.y.z`：`">=1.0.0"`、`"~1"`、`"1.x"`
  一律判 false 并挡死渲染。`manifest.toml` 的版本语法必须与之对齐或把它改成真正的 semver-range。
- `NodeIsolationMode`（`trusted|contained|iframe|worker`）全仓**零消费者**。

### 1.3 构建与运行管线

- 前端产物一条路：`bun run build` → `generate:node-registries` → turbo → `tsc --noEmit` →
  `vite build` → `audit:build-chunks`。Vite 8 已是 rolldown 形态（`@rolldown/plugin-babel`、
  `build.rollupOptions.output.codeSplitting.groups`、`optimizeDeps.noDiscovery`）；React 单例目前靠
  `resolve.dedupe` + `codeSplitting.groups` 的 `vendor-react` 两条一起保证。
- **成品里 Bun 没退役**：`wails:build` → `fetch:bun-runtime` → Go `//go:embed` 把 Bun 二进制、
  Bun 打出的 backend JS、`build/wails/node_modules` 原生绑定一并塞进 exe。这就是「运行时无
  Node/Bun」这条硬约束目前唯一真正的违反点，且属于 ADR-0063 的待删旧层。
- Rust/Tauri 宿主已存在且已在跑（`crates/xiranite-desktop`，`cargo build -p xiranite-desktop` 绿），
  但它的 `frontendDist` 指向 crate 内一个**纯 HTML 自检页**，没有任何脚本把 `dist/` 接进去——即
  「Rust 宿主 + 产品 React bundle」这条线还没连。
- 现采版本（npm registry 直读，`https://registry.npmjs.org/@module-federation/<pkg>/latest`）：
  `runtime`/`enhanced`/`manifest` = 2.9.2，`@module-federation/vite` = 1.23.1（peer `vite ^5||^6||^7||^8`），
  **`@module-federation/rolldown` 不存在（404）**。

### 1.4 后端（wasm）侧已完成到什么程度

一条已跑通的链，现读命令：`bun run build:node-wasm dissolvef` 与
`cargo test -j 1 -p xiranite-node-runtime`。

- `crates/xiranite-plugin-api/src/host_function_names.rs`：20 个定版能力名 + `HOST_FUNCTION_SYMBOLS`
  （点→下划线的 Extism 符号展开表）。
- `crates/xiranite-extism-adapter`：唯一可引用 Extism 机制的 crate；入口约定是**零参数、返回 i32**
  的导出（官方 `extism` Rust 宿主以零实参调用导出，`function_exists` 只认 `(0)->i32`，见
  `CompiledNode::compile` 文档注释），能力调用为 `(handle)->handle`，`operation.checkpoint` 例外
  回标量码（`CapabilityAnswer::{Document, Code}`）。
- `crates/xiranite-node-runtime`：`PluginManifest::read`（TOML，含 `backend_api` major 门禁与
  `[backend] runtime` 拒绝）、`NodeRegistry::load`（staged 布局 `<root>/<id>/{manifest.toml,<id>.wasm}`）、`OperationCapabilities`
  （`xiranite.fs.*` / `operation.*` / `now`，逐次校验 `operationId`，未服务的能力回
  `not_implemented`）、`NodeRuntime: OperationLauncher`。
- `crates/xiranite-core/src/filesystem.rs`：授权根 + `..` 逃逸拒绝 + `move` 的 cp+rm 回退 + 文本上限。
- 桌面宿主 `main.rs::launcher()` 从 `XIRANITE_PLUGIN_DIR` / `XIRANITE_ALLOWED_DIRS` /
  `XIRANITE_DATA_DIR` 装配；缺产物带指引 `exit(78)`。

尚未闭合的后端事实（决定 backend-only 形态的真实成本）：

- `plugins/*/manifest.toml`（logx/snf/nameu/timeu/transq，已随 TOML 迁移机械改写）全部缺
  `[backend] entry_point`，且入口是单参数导出 → 今天的宿主**装不上它们**；只有 `dissolvef` 真正可跑。
- `backend.allowed_paths` / `backend.allowed_hosts` 被解析但**无人消费**：授权根实际来自环境变量。
- `xiranite-api` 只实现 `/health` + `/node-operations` 族，TS 侧声明的 config / workspace /
  runtime-history / local-files / system 路由一条都没有 → full 形态的前端插件一接产品 GUI 就 404。
- 协议差集门禁 `packages/tauri-migrate/src/http-surface.ts` 的 Rust 默认扫描根仍写着已消失的
  `crates/xiranite-plugins/src`，且已提交的 `artifacts/rust-http-surface.json` 是 `routes=0`
  → ADR-0067 的「协议不缩水」目前**没有证据在背书**，属必须修的门禁完整性。

### 1.5 本轮后端实测补记（2026-10-04 夜）

三条在真链路里量出来的事实，都已在代码里修掉，留在这里免得被当成「以后再看」：

1. **`xiranite.operation.emit` 曾把每条事件发两遍**。`OperationState::push_event` 既写保留窗口又
   向活监听者 fan-out，而 `OperationCapabilities::emit` 之后又调了一次
   `OperationManager::publish` ⇒ 先订阅的客户端拿到 `[0,0,1,1,…]`（实测：浏览器里 7 条进度显示成 14
   条）。**原来所有判据都看不见这个 bug**：`/node-operations/:id/events`、保留窗口、终态结果读的都是
   保留缓冲，重复投递在那里天然不可见；只有活订阅看得见，而所有浏览器面都是活订阅。修法=删掉那次
   `publish`；尺=`crates/xiranite-node-runtime/tests/event_stream.rs`（含阳性对照：把缺陷改回去它红成
   `[0,0,1,1,2,2]`，而「迟到订阅」那条仍绿，正好证明旧读法看不见它）。
2. **`XIRANITE_ALLOWED_DIRS` 曾按 `:`+`;` 双分隔切**。Windows 盘符表 `C:\Library;D:\Downloads` 会被
   切成 `C`、`\Library`、`D`、`\Downloads`——四个都不是开发者授权的根，而这是安全边界（ADR-0068 的
   授权根）。改为跟随各平台 PATH 约定（`std::env::split_paths`，Windows 侧带 unquote）。这条是
   `xiranite-desktop::launcher` 的测试逼出来的（跨平台是硬要求，不是本轮临时约束）。
3. **浏览器面接 Rust 后端此前没有入口**：旧路 `scripts/dev-desktop.ts` 起的是正在被删的 Bun/Elysia
   后端，而跑 Tauri 宿主只为拿一个端口又要有窗口服务。新增 `xiranite-dev-host`
   （`crates/xiranite-desktop/src/bin/dev_host.rs`）：debug-only、打印通道 JSON、`--ttl-seconds` 有限
   寿命、发布即打印。`plugin-host.html` 相应接受
   `&backend=&token=&instance=`（**只接受 http loopback**，ADR-0065），生产路径仍是
   `xiranite_bootstrap`。

## 2. 目标架构（要新增的东西，按层）

### 2.1 Plugin Manifest：`manifest.toml`（Xiranite 拥有）

单一真源，frontend/backend/contributions 三段都可缺位；`mf-manifest.json` 只描述 MF runtime
自己的 metadata，**不得**被 Xiranite 当作插件清单读取。

```toml
id = "com.example.foo"
name = "Foo Tools"
description = "Example Xiranite plugin"
version = "1.3.0"            # 插件自己的发布版本

# 两个 API 面独立协商（第 16 条）：前端与后端可以不同步升级。
# 今天的取值是 `major.minor[.patch]` 裸数字：`audit:plugin-manifests` 的 VERSION_PATTERN 拒掉
# `^1.0` 这类 range 写法，semver range 比较属于未落地项（§14），别在清单里先写出来骗实现。
frontend_api = "1.0"
backend_api = "1.0"

[frontend]
runtime = "module-federation"
# 这三条字段名要对齐 runtime 的 RemoteInfo：entry / alias / type；`protocol`、`isolated`
# 在 2.9.2 的导出里不存在，不许出现在词表里（写了就是骗实现）。
manifest = "frontend/mf-manifest.json"   # 相对路径或绝对 URL → RemoteInfo.entry
alias = "foo"                            # → RemoteInfo.alias，loadRemote 的前缀词表
entry_type = "var"                       # "var" | "module" → RemoteInfo.type
share_scope = "default"
required_api = "^1.0"
# Xiranite 自加、MF 不提供（见 §6 第 4/5 条）：
source_allow_list = ["https://plugins.example.com"]
integrity = "sha384-…"                   # 由 Xiranite 在 fetch/createScript 钩子里自验

[[frontend.exposes]]
id = "foo.panel"
module = "./FooPanel"                    # → 宿主 workspace 组件（MODULE_REGISTRY / ModuleRenderer 有消费者）

# 注意：`type = "route"` 现在**没有消费者** —— 全仓没有 URL 路由
# （无 `@/router` 模块、无 hash/history 路由、入口是 createRoot(...).render(App)；
#  `audit-node-ui-independence.ts` 的 COUPLING_PREFIXES 里那个 `@/router` 是死前缀）。
# 要做 route 贡献，前提是宿主先有路由层；在那之前 route 不进贡献词表。

[backend]
runtime = "extism"                       # 今天只认这一个值，其余直接拒绝而不是当成 extism
entry = "backend/plugin.wasm"            # wasm 文件（相对清单解析）；与 entry_point 是两件事
entry_point = "foo_run"                  # 该文件里的零参数 i32 导出名（见 §1.4）
runtime_version = "1.30.0"               # ADR-0068 第三个版本事实：测量时的 Extism 版本
memory_max_pages = 256
allowed_paths = []                       # 解析已就位，消费点尚未接进 FileCapability
allowed_hosts = []
host_functions = [                       # 定版能力名；宿主按这份表注册 Extism user function
  "xiranite.fs.stat",
  "xiranite.operation.checkpoint",
  "xiranite.now",
]

[permissions]                            # 未声明即无
filesystem = ["read"]                  # 细化到 xiranite.fs.* 动词
network = ["https://api.example.com"]
clipboard = true
backend = true                         # 允许经 Plugin API 调自己的 backend

[[contributions]]
type = "component"                        # 今天真有消费者的类型
id = "foo.panel"
module = "./FooPanel"

[[contributions]]
type = "command"
id = "foo.run"
```

迁移是**替换不是并存**（不留 JSON 垫层），本轮已按此落地：`crates/xiranite-node-runtime/src/manifest.rs`
（`toml = "1.1"`，与 `xiranite-core` 同一条版本线）、`scripts/build-node-wasm.ts`（staged 布局写
`manifest.toml`，并按 `backend.entry` 落 wasm 文件名）、`scripts/audit-plugin-manifests.ts`（用
`Bun.TOML.parse` 读同一份文档）以及全部现存清单（`crates/nodes/dissolvef/manifest.toml` 与
`plugins/*` 的五份遗留移植）一处都不再认 JSON。
证据命令：`bun run audit:plugin-manifests`、`bun test scripts/audit-plugin-manifests.test.ts`、
`bun run build:node-wasm dissolvef`、`cargo test -j 1 -p xiranite-node-runtime`。
`[frontend]`/`[permissions]`/`[[contributions]]` 由将来的 Plugin Manager（TS）读；Rust 侧读取器**容忍**
它们但**不校验**，因为 `[backend]` 缺失的清单本来就不该进 `NodeRegistry`（frontend-only 形态没有后端）。

### 2.2 Frontend Runtime = MF2 Adapter

- **Host 不挂 bundler 插件**：本仓是 Vite 8/rolldown，而 `@module-federation/rolldown` 不存在（registry
  404，实测）；host 只用 `@module-federation/runtime`，且用 `createInstance(options)` 而不是 `init()`
  —— `init` 带「Use with caution」，同名同版本会复用并合并实例，纯运行时场景官方指向 `createInstance`。
  API 面以 2.9.2 的导出为准：`createInstance / registerRemotes / registerShared / loadRemote /
  preloadRemote / loadShare / satisfy`（没有 `prefetch`，没有 `unloadRemote`）。
  这满足「不自造加载器」——用的是官方 runtime，而不是自己写 `import(url)` 拼装。
- **动态注册**：remote 清单来自 `PluginManager` 解析出的 manifest，**不进构建配置**，因此
  装新插件不需要重新构建 Xiranite（验收 6）。`registerRemotes` 本身惰性——只写进 `options.remotes`
  不发请求，首次 `loadRemote` 才抓 `mf-manifest.json` 并生成 snapshot；同名重复注册需要 `force: true`。
- **共享依赖**：`shared` 是**对象映射**（值要 `lib: () => React` 或 `get: () => import(...)`），不是数组；
  host 注入自己已有的 React，插件侧对 react/react-dom 写 `{ singleton: true, import: false }`
  （`import:false` = 不打包本地副本、只用宿主提供的那份）。
  **React 19 的坑实测在官方 troubleshooting 里**：只声明 `'react-dom'` 拦不住 `react-dom/client`、
  `react/jsx-runtime`、`react/jsx-dev-runtime` 这些**子路径**，会各自打包 → 双份 React DOM、invalid
  hook call。因此必须加**前缀项** `'react/'`、`'react-dom/'`（以 `/` 结尾表示前缀匹配）。
  host 侧还要与既有 `resolve.dedupe`、`optimizeDeps.include`、`codeSplitting.groups` 的 `vendor-react`
  同时成立——shared 落不进 `vendor-react` 就会把 `audit:build-chunks` 的首屏禁令跑红。
- **懒加载**：启动只读 manifest 元数据（`PACKAGE_MODULES` 那条链已经证明「不 load 组件也能拿到
  NodeDef」），进入 `/foo` 才 `loadRemote`；`preloadRemote` 只作为 hover/idle 的可选优化。
  Backstage 的做法**只借清单结构与 shared 协商**：它的 dynamic feature loader 是启动时
  `Promise.all` 遍历所有 remote 的所有 exposes，那条 eager 行为不照搬。
- 作者侧工具链不绑定，但按成熟度排序：首选 **Rspack + `@module-federation/rspack`**（与 runtime 同仓
  同版本线 2.9.2，第一方）；`@module-federation/vite` 是独立仓库、独立版本（1.23.1），它的 remote 侧
  dev HMR 在官方文档里仍列 roadmap 而源码已有 `pluginDevRemoteHmr` —— **必须先实测再写进模板**，
  且 ESM remote 需要远端 CORS 与 `script-src` 放行，`var` 型 script 标签不受这条限制。

### 2.3 Frontend 与现有 Node Contract 的关系（第 4 条）

不重写节点。`AppNodeEntry`/`NodeComponentProps`/`NodeHostApi`/`NodeHostRequirements`/`NodeSchemas`
继续存在，MF2 只改变 **entry 从哪里加载**：

```
resolveEntryLoader(nodeId) → loader        ← 唯一分派点
   ├── 动态：mf.loadRemote("<id>/entry")   ← 已绑定的远端优先（= 装了插件就是它）
   └── 静态：packageModuleLoaders[nodeId]  ← 未被绑定的 id 照旧走构建产物
```

**优先级是语义不是实现细节**（`src/plugins/dynamicEntries.ts`）：`moduleId` 同时是
`ModuleRenderer` 交给 `useNodeHostApi` 的 nodeId（`ModuleRenderer.tsx:100`），所以「装了 dissolvef 的
插件」必须既决定 entry 从哪加载、也决定操作打哪个后端。静态表优先会让插件静默失效（实测：本地面
chunk 全下载、remote 零字节），因此未绑定的 id 才回落到静态表。

`diagnoseHostRequirements` 继续做版本与能力协商（语义不变），`ModuleRenderer` 的 loader 缓存/失败
重试/chunk 语义全部保留。

**能跨 MF 边界的只有纯数据**：`compId: string`、`NodeDef`、help 数据。宿主侧对象**不能**整体跨：
`host`（闭包 + 同步读写 zustand）、`schemas`（zod 实例）、`runner.run(…, onEvent)` 的回调、
`localFiles.subscribeDrops()` 返回的 unsubscribe、`tray.onAction`。因此 remote 暴露的 `entry.ts`
必须运行在**同 realm、同 React 实例、同共享模块作用域**里——这是「MF2 remote」而不是「web worker/
iframe」的根本理由，也是必须显式声明为 shared 的东西（`@/components/ui`、`@/nodes/shared`、
`@/lib/utils`、`lucide-react`、`@/i18n` 单例）比 react 更细的原因：漏一个就是静默双实例。

**`@/i18n` 这条已实测到代价**（2026-10-04 夜）：内部节点当 remote 时，remote 打包的是自己那份 i18n，
未初始化则节点标题是空串（i18next 同时警告 "you will need to pass in an i18next instance"）；用顶层
`await initI18n()` 又会让 entry 变异步模块、在后台标签页里永远不落定，宿主停在 Suspense 骨架。宿主
把 `@/i18n` 放进 shared 提供实例之前，示范工程的临时解是 `void initI18n()`（不阻塞求值）。

### 2.4 XiraniteFrontendHost（第 5、17 条）

- 内部 trusted Node 继续拿 `NodeHostApi`（现状行为不变，不做一次性改造）。
- 第三方 frontend plugin 拿 `XiraniteFrontendHost`：由 manifest `[permissions]` ∩ 宿主授权策略
  构造的**投影对象**，`contract.supportedCapabilities` 与 `hasCapability()` 必须如实反映投影结果
  （修掉 §1.2 那句假话）。投影的底层实现与 `useNodeHostApi` 共享同一批能力工厂，不复制第二套。
- 前端 → 后端只走 Xiranite Plugin API（今天即 `/operations` 族 + `@xiranite/api` 客户端），
  **不允许前端直接依赖 Extism**，也不给第三方插件暴露 Tauri command。
- 待补：插件级作用域凭证。今天一个宿主 bearer token 打通全部路由且可落 query；第三方插件必须拿
  按 manifest 能力裁剪的派生 token，否则权限过滤形同虚设。

### 2.5 Plugin Manager（第 6、7 条）

新增一层，明确职责：`discover / install / uninstall / enable / disable / update / validate /
resolve dependencies / check API compatibility / check capabilities / load frontend / load backend /
lifecycle`。MF runtime 只做 frontend module 加载，Extism 只做 wasm 执行，**安装/卸载/权限/版本管理
归 Manager**。分发来源抽象：Local File、URL、GitHub Release、Plugin Registry、Built-in、
Development。

## 3. 三种形态与各自缺什么

| 形态 | 现在能不能跑 | 缺什么 |
| --- | --- | --- |
| frontend-only | **能**（`examples/plugins/frontend-only`，2026-10-04 真 Chrome 实测） | `manifest.toml` 的 `[frontend]` 解析、PluginManager 的注册表读取。`AppNodeEntry.core` 已改可选（`HeadlessNodePackage.core` 仍必填），纯前端插件不再需要伪造 core |
| backend-only | **能**（dissolvef 端到端跑通并动盘） | manifest 迁 TOML（已完成）、`[backend] entry_point` 补齐旧 5 个插件、入口签名改零参数、`allowed_paths` 真接进 `FileCapability`、缺能力（`fs.open/close/copy/set_times`、`operation.update`、`log`、`process.run`、`scheduler.*`、`path_token.resolve`） |
| full | **能（本轮实测）**，两档 | 最小第三方形态：`examples/plugins/dissolvef-full` 端到端跑通（plan 6 行 / 真实执行 6 success / undo 还原，全部按磁盘状态验证）。内部节点形态：`examples/plugins/dissolvef-product` 把仓库自己的 `entry.ts` 当 remote，节点原界面照常渲染。缺的是产品级外壳：`xiranite-api` 只实现 9 条路由、插件级受限凭证、受限 host 投影、PluginManager |

**阶段二实测（2026-10-04 夜，`examples/plugins/dissolvef-product`）**——「现有 AppNodeEntry 当 MF2
remote、Component.tsx 零改」这条能成立，但有四个必须写下来的边界：

1. **动态绑定必须盖过静态表**：`moduleId` 同时也是 `ModuleRenderer` 交给 `useNodeHostApi` 的
   nodeId（`ModuleRenderer.tsx:100`），所以装了插件的 `dissolvef` 必须就是 `dissolvef`——entry 从
   remote 加载、操作也打 remote 声明的那个后端。`resolveEntryLoader` 因此改成「绑定的 remote 优先，
   静态表兜底」；不这样改，页面会静默走本地 chunk，插件根本没被用过（实测：静态表先命中时
   network 里全是 5173 的本地组件，4175 一个字节都没下载）。
2. **宿主页必须给出确定高度**：节点用 `useNodeSurface` 量自己的容器（`rAF` + `ResizeObserver`），
   `mode` 由尺寸推导；无高度 ⇒ `collapsed`。**隐藏标签页里 rAF 不跑**，量到 0×0，节点永远画折叠态
   ——这是本轮所有「节点没渲染出来」假象的来源，不是节点的问题。
3. **remote 的 i18n 是它自己那份**：节点文案走 `tNode`/`useNodeI18n` → `@/i18n` 单例，remote 打包
   的是独立副本。不初始化 ⇒ 标题空串 + i18next 警告；用顶层 `await initI18n()` 初始化又把 entry 变
   成异步模块，后台标签页里 `initI18n` 不落定 ⇒ 宿主永远停在 Suspense 骨架（实测）。当前做法是
   `void initI18n()`（不阻塞求值，实例就绪后 `useTranslation` 自然重渲）。**长期解在 §2.3 的 shared
   单例清单里加 `@/i18n`**，由宿主提供实例。
4. **样式来自宿主页**：remote 不带样式表，靠 `plugin-host.html` 引入的应用 CSS（Tailwind 扫描
   `src/**`，节点用的类已在其中）。这是「内部节点当 remote」才有的便宜，第三方插件没有——§12 的
   `@xiranite/ui` 正是为此。

## 4. 生命周期（第 14 条）

不把 `import` 当 lifecycle：

```
discover → validate(manifest + api compat + capabilities) → resolve → load(frontend|backend)
        → activate(register contributions) → mount
deactivate(unregister contributions) → unmount → unload
```

`unload` 的现实边界（已对着 `@module-federation/runtime@2.9.2` 的导出实测）：runtime **没有**
`unloadRemote`，也没有 `prefetch`/`getShareScopeMap`/`isolated`。唯一的清理路径是
`registerRemotes([...], { force: true })` 触发的内部 `removeRemote()`，它删的是全局变量、
manifest 缓存、该 remote 的实例与 shared 贡献和 `moduleCache`；**不会**移除已插入的 `<script>` /
`<link>` DOM 节点，也无法撤销已求值的模块——`type: "module"` 走原生 `import(url)`，同一 URL 的
ESM 记录按引擎规则永久驻留，只能靠 URL 加 hash 破缓存。

所以本项目的 `unload` 定义是：**贡献面注销 + React 树卸载 + 后续 `loadRemote` 拒绝**，换版本时才用
`force:true` 重注册。文档、UI、验收口径都不承诺「内存已释放」——写做不到的话比不做更糟。

## 5. 版本与兼容（第 16 条）

- `frontend_api` / `backend_api` 独立 range；`api_version` 语义分裂成两条会消除今天「一个版本号同时
  表示前端契约和 wasm 契约」的错误。
- 版本比较必须换成真 semver range 实现（现有 `isContractVersionCompatible` 只认精确与 caret，见
  §1.2），否则 `"^1"`、`"1.x"` 这类合法写法会挡死插件。选定：TS 侧用现成 range 库、Rust 侧用
  `xiranite-plugin-api::protocol_version` 同一套规则，两侧一致由门禁证明。

## 6. 安全模型（第 17 条）

1. 默认无权限：`[permissions]` 未声明即拿不到。
2. 双层强制：manifest 声明 ∩ 宿主授权（后端已有 `allowed_paths`/授权根这条，前端要新建投影层）。
3. 前端不接触 Extism，不接触 Tauri command；只经 HTTP Plugin API + 受限 host。
4. **MF2 不提供沙箱**：runtime 的导出与文档里没有 `isolated`/window isolation/sandbox（实测 2.9.2 命中
   0 处），`createInstance` 只隔离实例与 shareScope，插件与 host **同一个 JS realm**。因此
   「按 manifest 授权过滤 host API」**只能由 Xiranite 自己实现**，不能指望 MF 挡；MF 提供的是钩子面：
   `beforeRegisterRemote`/`registerRemote`（来源校验落这里）、`beforeRequest`、`afterResolve`、
   `onLoad`（可改 exposeModule）、`errorLoadRemote`、`createScript`/`createLink`（可加 attrs）、
   `fetch`（可整体接管请求）。
5. **完整性/签名也没有官方支持**：`mf-manifest.json` 只有 `shared[].hash` 与
   `metaData.buildInfo.hash?`，`remoteEntry` 没有 SRI 字段，runtime 加载路径里 `integrity`/
   `crossorigin` 零命中。要做就只能自己做：在 `fetch` 钩子里取字节自算 hash，或经
   `createScript.attrs` 把 `integrity` 交给 WebView。manifest 里对应字段由 Xiranite 定义，不冒充
   MF 能力。
6. 运行时形状漂移要禁止：今天 `clipboard.readFiles/writeFiles` 与 `localFiles.subscribeDrops` 是按
   平台条件注入的，同一 key 在不同机器存在性不同——对第三方必须改为「能力声明 + 协商」而不是
   运行时猜形状。

## 7. Dev / Production 模式（第 19 条）

- Dev：`xiranite plugin dev` 把 remote 指到 `http://localhost:3000/mf-manifest.json`；backend 可以
  单指 `local plugin.wasm`。开发环境允许 Vite/Rspack dev server（**开发机**装 Node/Bun 是允许的）。
- Prod：WebView 里只有 JS runtime + MF runtime + Extism。运行时无 Node/Bun/npm/pnpm 的证据链要靠
  两条门禁：`crates/xiranite-desktop` 不引 Go/Bun，`audit:build-chunks`/新检查确认打包资源里没有
  `node:` import；当前唯一的真实违反点是 §1.3 的 Wails+Bun embed 链，它必须退役而不是绕过。
- **CSP 与混合内容（已回读 Tauri 源码定案）**：`crates/xiranite-desktop/tauri.conf.json` 现在
  `security.csp = null`，即完全不注入 CSP。`WindowConfig::use_https_scheme` 的 `Default` 是 `false`，
  源码注释写明：设成 https 会 **NOT allow mixed content** 去抓 http 端点，并且**不再与 macOS/Linux 的
  `<scheme>://localhost` 行为一致**。结论：macOS 上 `tauri://localhost` 页面加载 `http://127.0.0.1:PORT`
  不是混合内容问题；Windows 只要**不**开 `useHttpsScheme` 就同样放行，开了就会拒载 http 插件——
  这一条要写进实现约束，别有人为「更安全」顺手打开它。
- 生产收紧方向（未落地，按此写）：`csp` 用对象，`script-src` = `'self'` + 插件源白名单；
  `connect-src` 必须保留 `ipc: http://ipc.localhost`（否则 Tauri `invoke` 全断）并按需加 axum 的
  `http://127.0.0.1:<port>`；`img-src`/`style-src` 补 `asset: http://asset.localhost data: blob:`；
  `assetProtocol.enable = true` 且 scope 收窄（注意 Unix 下 `requireLiteralLeadingDot` 默认 true，
  `**/*` 会漏掉点开头目录）；dev 用 `devCsp` 放开 localhost；插件走 HTTP 而非 Tauri invoke，因此
  capability 只需 `core:default`，不必每装一个插件就扩一次 capabilities。
- 仍未实测、必须在 POC 里用实机证据替换的点（本机资料判不了）：① WKWebView 下从 `tauri://localhost`
  注 `<script src="http://127.0.0.1:PORT/remoteEntry.js">` 是否被 ITP/scheme 白名单额外拦；
  ② WebView2 上 `http://tauri.localhost` origin 发 `import()` 时的 CORS 表现；③ `asset:` 能否作
  `import()`/`script src` 的源；④ 自加 URL 与 Tauri 注入的 nonce/hash 是否冲突；
  ⑤ `@module-federation/vite` 的 remote 侧 dev HMR；⑥ Rspack 产物在 `type:"var"` +
  `entryGlobalName` 下 React 19 **子路径前缀项**是否真命中（要看 network 面板）；⑦ 冷启动
  `registerRemotes` 后立刻 `loadRemote` 的 `<script>` 竞态。

## 8. `.xplugin`（第 18 条）

`.xplugin` = 发行容器（zip），里面是 `manifest.toml` + `frontend/` + `backend/`。它**不是运行时
格式**：解包后落到 `artifacts/plugins/<id>/`，前端交 MF runtime、后端交 Extism。允许三种发行：
`foo.frontend`、`foo.backend`、`foo.xplugin`（组合）。纯前端插件不该被迫带一个空 wasm。

## 9. 实施顺序（本文件只承诺第一步）

1. 现状盘点（已完成，见 §1，四路只读 + 我本人回验）
2. `docs/plugin-architecture.md`（本文）
3. **POC：frontend-only**——host `init` + `registerRemotes` + `loadRemote`，`route` 贡献，
   受限 `XiraniteFrontendHost`，装插件不重编宿主，macOS WebView 实机验证
4. 阶段二：现有 `AppNodeEntry` 作为 MF2 remote（`Component.tsx` 零改）
5. 阶段三：full（MF2 frontend → Plugin API → Extism backend）+ `examples/plugins/{frontend-only,
   backend-only,full}` 三个可运行示例
6. PluginManager / Registry / `.xplugin` / 插件级凭证 / CSP，按验收项逐条补
7. 不做的事：不同时改 Node、Rust、Extism、Manager、Registry、UI；不把 `host` 整体跨 realm 传；
   不为「未来可能是 WIT/Component Model」提前堆抽象

## 10. 架构评审：打分、与现有 UI 的冲突、前后端协同契约

### 10.1 判断

骨架是对的，且比「把 MF 当插件协议」的常见做法便宜得多：真正的接入面只有
`ModuleRenderer` 取 loader 的那一处下标，所以「MF2 只改变 NodeEntry 从哪里加载」是可实现的，
不是口号。需要收口的有三处：

1. **`[[contributions]]` 是本方案里最大的一块新发明**。今天有真实消费面的只有 workspace 组件
   （`MODULE_REGISTRY`/`PackageVisibilityMode`）、tray（`trayCoordinator`）、window 偏好
   （`nodeWindowPreferences`）和宿主路由。一次性开 `route/panel/tab/command/widget` 六类，就会
   复制我今天刚抓到的那个病：`allowedPaths` 被解析却没人消费。**只开有消费者的三类**
   （`component`、`tray`、`window`）。实测 `route` 也不能开——宿主今天没有 URL 路由（见 §2.1 的
   注释），把它写进词表就会立刻变成第二个 `allowed_paths`。其余按需再加，且加一类必须同时加
   「声明即有消费者」的门禁。
2. **PluginManager + Registry + `.xplugin` 安装链是一个产品量级**，不该进第一阶段。验收 6
   （装插件不重编宿主）用 `artifacts/plugins/<id>/` 这个 staged 目录 + `discover/enable/disable`
   就能证明——wasm 侧今天已经是这么跑的。install/update/依赖解析推迟，`discover` 已是接口，
   架构不因推迟而改变。
3. **安全模型缺「谁批准」**。manifest 的 `[permissions]` 只是自我声明；没有安装期用户确认或
   内置白名单，就等于自动全给。定成三层：**声明 → 授权（内置全信 / 第三方需确认或策略）→
   运行期投影**，并让 `contract.supportedCapabilities` 只反映第三层的结果。

### 10.2 与现有前端 UI 的冲突（按痛度排序）

| # | 冲突 | 依据 | 处置 |
| --- | --- | --- | --- |
| 1 | **共享 UI 面被隐式变成 API**：`@/components/ui`、`@/nodes/shared`、`@/lib/utils`、`lucide-react`、`@/i18n` 单例是节点组件的既有依赖 | 静态计数（现读：`rg -o "from \"@/components/ui\"" src/nodes -c`） | 不把内部目录当 shared。收窄出一个公开 `@xiranite/ui`（设计 token + 无状态原语）作为 shared 契约；`@/i18n` 必须共享否则双实例双状态 |
| 2 | **`host` 是 130 方法闭包对象，且大量调用仍走 deprecated 别名**：内部节点用 `actions/getNodeConfig/openConfigFile`，新节点用命名空间 | 现读：`rg -o "host\.(actions\|getNodeConfig\|saveNodeConfig\|getNodeUiConfig\|saveNodeUiConfig\|openConfigFile\|downloadText)\b" src/nodes --no-filename \| wc -l`（2026-10-04 实测 190 处） | 投影只按 9 个 `NodeCapabilityId` 命名空间做；别名冻结为「仅内部 trusted 节点」，文档写明不再增长 |
| 3 | **主题切换会换 `host` 对象身份**（`useMemo` deps 含 `hostTheme`），节点在 `useEffect(…, [host])` 上依赖它 | `useNodeHostApi` 的 deps | 投影层必须保持同一等价语义（同一实例 + 同一次主题变更才换），否则第三方插件表现为谜样不重渲染 |
| 4 | **React Compiler 只作用在宿主**：组件里的 `"use memo"`/`"use no memo"` 依赖宿主 babel 配置 | `reactCompilerPlugins` 与 `vite.config.ts` | 插件模板强制带同一 `compilationMode`；文档说明差异会体现在 memo 语义而不是崩溃 |
| 5 | **两个 React Provider 的模块标识**（runtime context、local-files）跨 bundle 不收敛就 `useContext` 拿到 undefined | `ModuleRenderer` 挂载处 | 这两个 context 模块列入 shared 清单，或改由宿主把值以 props 传入 |
| 6 | **失败/重试语义不同**：现有 loader 缓存失败后删缓存以支持 Vite HMR 重试；MF 是 script 注入 + `globalLoading` 复用 | `ModuleRenderer` 的 loader 缓存 | 动态来源走独立分支，不假定 `import()` 的 reject 行为 |
| 7 | **`StandaloneNodeApp` 从不做 host 需求校验**，独立窗口绕过 `diagnoseHostRequirements` | 该文件的装配路径 | 插件化前先补统一校验，否则插件的 `host` 声明在独立窗口里形同注释 |
| 8 | **`XIRANITE_NODE_APP_ID` 多入口 + Wails/Bun embed 链**与 MF remote 并存时会出现两条前端装配路径 | `vite.config.ts` 的 input 切换、`wails:build` | 旧链按 ADR-0063 退役，不与之并存 |
| 9 | **CSP 收紧会打到宿主自己的内联资源**（今天 `csp = null`） | `tauri.conf.json` | 先实测收紧后的表现，再决定生产 CSP；未实测不写结论 |

### 10.3 前后端协同：这是当前最薄的一节，必须补三条契约

今天实测到的现实是：`xiranite-api` 只实现 `/health` + `/node-operations` 族，bearer token 是**整个宿主
一个**，因此任何前端（含第三方）都能对任何已装后端发起操作——而 dissolvef 的 `dissolve` 是真动盘的。
所以协同不是优化，是补安全边界：

1. **Plugin-scoped RPC（必做）**：宿主为每个 frontend plugin 派生受限凭证 + 一个窄 client，只允许打它
   manifest 里声明的后端 plugin id。落点：`crates/xiranite-api` 的 authorize 中间件按调用者身份收窄；
   前端侧 `@xiranite/api` 客户端按能力投影。
2. **定义与校验协同（必做）**：`NodeSchemas` 是 zod 实例，**不能跨 realm 传**。正确形态是后端发布
   数据化的定义文档（ADR-0069 已把 `interaction.ts` 的闭包改成数据契约，`node_definition.rs` 已落地
   类型），前端按同一份定义渲染表单与校验；这也顺带实现「一份词表」——内部 React 节点与 MF 插件
   消费同一个 descriptor，而不是各自再抄一遍。
3. **协商实现单一真源**：`isContractVersionCompatible` 只认精确与 `^x.y.z`，而 manifest 要用
   `frontend_api`/`backend_api` 真 range。TS 与 Rust 各写一份 semver 必然腐烂——定成一份规则、
   生成物或门禁证明两侧一致（ADR-0067 的既有做法）。

再加一条小的：`contribution.module = "./FooPanel"`（异步模块 id）与 `[backend].entry_point`（导出符号）
是两种生命周期的语言，Manager 对外应统一成一个 descriptor（「这个插件可以被调用的东西」），否则每个
消费者都要自己解析两套形状。



## 11. 已确认需要修的既有缺陷（不是新功能，属正确性）

- `contract.supportedCapabilities` 与注释不一致（声称裁剪、实际全给）。
- `isContractVersionCompatible` 拒绝合法 range 写法。
- `http-surface` 的 Rust 扫描根指向已消失的 crate，parity 门禁空转。
- `backend.allowed_paths`/`allowed_hosts` 解析后无消费者。
- `node-contract.md` 把 `Component.tsx` 的位置与必填性写错，并教 `runner.runNode` 这种会被门禁
  判红的写法；`validate-node-architecture.ts` 的 Component 分支因此是死码。
- 39/43 节点不声明 `host` 要求，remote 化后等于默认全信任。
- `StandaloneNodeApp` 路径从不做 host 需求校验。

## 12. 前端 SDK 契约：让「仓库外编译」真正成立的那一件东西

外部构建的代价不是分发，而是**耦合换了形态**：从「同一棵源码树一起编译」变成「一份必须版本化的
ABI」。共享面实测（现读，含子路径，`src/nodes` 非测试文件）：

```sh
python3 - <<'PY'   # 内部依赖面计数
import subprocess, re, collections
out = subprocess.run(["rg","-o","--no-filename",'from "[^"]*"',"src/nodes",
                      "--glob","!*.test.*","--glob","!__screenshots__"],capture_output=True,text=True).stdout
c = collections.Counter(re.findall(r'from "([^"]+)"', out))
for k in ["@/components/ui","@/nodes/shared","@/lib/utils","lucide-react","react","@xiranite/contract"]:
    print(k, sum(v for key,v in c.items() if key==k or key.startswith(k+"/")))
PY
```

数量级结论：内部 `@/components/ui` 是**绝对主导依赖**（数百处），`react` 与 `@xiranite/contract` 反而是小头。
于是外部插件只有两条坏路：共享宿主内部目录（`@/components/ui` 立刻变成公开 API，改一次炸一片插件），
或者自带一份（视觉分叉 + 体积翻倍）。**两条都不走**，改为显式抽两层公开契约：

- `@xiranite/plugin-sdk`：`NodeContract` 的类型 + 能力投影接口（只 9 个命名空间，别名不进）+
  contributions descriptor 类型 + 窄 RPC client（打到 `/operations` 族）。这是插件唯一允许 import 的东西。
- `@xiranite/ui`：设计 token + 少数无状态原语，进 MF `shared`。`@/components/ui` **不晋升**为 API。

内部 trusted 节点继续用 `@/components/ui` 与 `NodeHostApi` 全集（现状不变，不做一次性改造）；
第三方走上面两层。这条边界不写清楚，「外部编译」只是看起来成立。

## 13. 一手来源（本文的事实出处）

- Module Federation runtime：`https://module-federation.io/guide/runtime/runtime-api/`、
  `.../runtime-hooks/`、`https://module-federation.io/configure/shared/`、`.../configure/remotetype/`、
  `https://module-federation.io/guide/advanced/manifest-fields/`、
  `.../guide/troubleshooting/runtime/`（React 19 子路径双实例的官方说明）。源码
  `https://github.com/module-federation/core/blob/main/packages/runtime-core/src/`
  （`remote/index.ts` 的 `removeRemote`、`utils/load.ts` 的加载路径）。
- 版本实测：`https://registry.npmjs.org/@module-federation/runtime/latest` = 2.9.2、
  `@module-federation/vite/latest` = 1.23.1（peer `vite ^5||^6||^7||^8`）、
  `@module-federation/rolldown` = **404 不存在**。
- Tauri：`https://v2.tauri.app/security/csp/`、`.../security/asset-protocol/`、`.../reference/config/`；
  源码 `tauri-utils/src/config.rs` 的 `use_https_scheme`（`Default` 为 `false`，注释写明 https 方案
  会禁止 mixed content 抓取 http 端点且与 macOS/Linux 行为不一致）。
- Vite dev server 的 CORS/allowedHosts 默认：`https://vitejs.dev/config/server-options`。
- Backstage：`.../docs/frontend-system/building-frontend-apps/07-module-federation.md`、
  `packages/frontend-dynamic-feature-loader/src/loader.ts`（启动期 `Promise.all` 全量 eager，
  只借它的清单结构与 shared 协商，不借加载时机）、BEP-0002。

## 14. 未实测清单（POC 必须用实机证据替换，不许当结论用）

**已实测（2026-10-04 第二轮，同一套真 Chrome + dev server + 外部 `vite preview`，后端换成
`xiranite-dev-host` 起的 Rust/Axum + Extism）**：full 形态端到端跑通——仓库外构建的 remote 用
`host.runner.run("dissolvef", …)` 起操作，Axum → NodeRuntime → Extism → `dissolvef.wasm` →
`xiranite.fs.*`，plan 回 6 行、真实执行 6 success/0 failed（磁盘状态逐条核对）、undo 全量还原；
内部节点形态（`examples/plugins/dissolvef-product`）把仓库自己的 `entry.ts` 当 remote，节点的
`dissolvef-surface`/折叠/完整视图分支照常工作。判据口径：**磁盘状态 + 宿主 `/node-operations` 记录是
事实源**，页面文字只是辅助。

**已实测（2026-10-04，真 Chrome + 宿主 dev server + 外部插件 `vite preview`）**：外部构建的
remote 能在宿主 realm 里加载并渲染；`__FEDERATION__.__INSTANCES__` 同时列出
`xiranite-host` 与 `poc_frontend`，双方 `shared` 协商到 `react`/`react-dom`/`react-dom/client`/
`react/jsx-runtime` 四项，插件的 `useState` 跨边界可用（两份 React 会直接 `Invalid hook call`），
且 `host.contract.supportedCapabilities` 如实暴露出「9 项全给」——§1.2 那句假话在浏览器里可读。
注意判据口径：`performance.getEntriesByType('resource')` 缓冲区会满，不能用它的「没有 :4173 条目」
来证明没下载第二份 react；有效证据是 shared 协商记录 + react 模块全部来自宿主 origin。

**已实测（2026-10-04 夜，真 WKWebView）**：`crates/xiranite-desktop/frontend/mf-probe.html` 在
`tauri://localhost` 里跑三个判据，把结论用 GET 打给 4179 上的日志服务（访问日志即证据，不靠截图），
台账在 `/tmp/probe-result.log`：`fetch_manifest?ok=1&origin=tauri%3A%2F%2Flocalhost` 取到
`name=poc_frontend exposes=1`，`import_remote_entry?ok=1` 拿到 `keys=get,init`（ESM remote 在 WKWebView
里可 import），对照项 `fetch_blocked_style_cors_none` 回 `type=opaque status=0` 证明「被拦」长什么样。
**这只证了原语**（跨源 fetch + 动态 import 通），没证宿主那套 `createInstance`/`loadRemote` 在 WebView
里渲染出 React——探针页不是产品 bundle。

仍未实测（WebView 与生产形态，不许当结论用）：

1. 宿主 MF runtime 实例（不是裸 `import()`）在 WKWebView 里加载 remote 并渲染产品组件；产品 bundle
   在 WebView 里的 CSP/`script-src` 是否放行外部 origin。
2. WebView2 上 `http://tauri.localhost` 作为 origin 发 `import()` 时 dev server 的 CORS 表现。
3. `asset:` 协议能否作 `import()` / `<script src>` 的源（官方只演示 `img-src`/`convertFileSrc`）。
4. 收紧 CSP 后，Tauri 注入的 nonce/hash 与自加插件源是否冲突
   （`dangerousDisableAssetCspModification` 指定指令的实际后果）。
5. `@module-federation/vite` 的 remote 侧 dev HMR（文档列 roadmap、源码已有 `pluginDevRemoteHmr`）。
6. Rspack 产物在 `type:"var"` + `entryGlobalName` 下，React 19 **子路径前缀项**是否真命中
   （要盯 network 面板，不能只看没报错）。
7. 冷启动 `registerRemotes` 后立刻 `loadRemote` 是否存在 `<script>` 竞态（`globalLoading` 复用行为）。
