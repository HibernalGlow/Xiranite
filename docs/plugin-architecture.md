# Xiranite Plugin Architecture：Module Federation 2.0 前端运行时 + QuickJS 后端运行时

- Status: proposed（第一阶段产物：现状盘点 + 目标架构 + POC 边界。实现顺序见文末）
- Date: 2026-10-04；**后端半于 2026-10-05 按 ADR-0073/0074 重新锚定**（见下一条）
- Related: `docs/adr/0073-retire-wasm-and-register-native-nodes-through-inventory.md`、
  `docs/adr/0074-keep-runtime-boundaries-with-quickjs-as-one-node-executor.md`、
  `docs/adr/0063-rewrite-backend-in-rust-with-tauri2-axum-extism.md`（其 Extism 条款已被 0073 作废）、
  `docs/adr/0065-serve-webview-over-loopback-bearer-channel.md`、
  `docs/adr/0068-keep-the-plugin-api-wit-migratable-with-extism-as-adapter.md`（wasm 侧条款作废）、
  `docs/adr/0069-keep-node-cli-tui-gui-triad-with-clap-ratatui-react.md`（其「唯一实现是 Rust crate」与
  「CLI=clap、TUI=ratatui」条款由 0074 作废）、
  `docs/adr/0067-use-ast-inventories-as-migration-source-of-truth.md`
- **重锚说明（2026-10-05）**：本文 10-04 成稿时后端那一半写的是 Extism 与 `plugin.wasm`。ADR-0073
  作废了它：wasm 与 Extism 退役，一个节点只有一份实现，稳定的是**节点协议**
  （`xiranite_node_registry::BuiltInNode` + `NodeHost`），协议背后的执行器才是可选项，今天落地的
  执行器是宿主内 QuickJS 跑的 TS core bundle（`crates/xiranite-quickjs-executor`）。因此凡是
  「`extism`」「`plugin.wasm`」「零参数导出」「`xiranite.*` 能力词表」「`allowed_paths`」的句子都已
  就地改写；带日期的实测记录（§1.5、§14）保留为历史，并注明当时跑的是哪条链。
  **前端半不受影响**：插件前端只经 HTTP `/operations` 族打宿主，后端换哪个执行器都一样。
- 证据口径（ADR-0067）：本文所有「今天是什么样」的断言都指向符号名与一条可现读命令，不写行号；
  行号会随改动腐烂。文中「未实测」的项目在实现阶段必须先用实机证据替换掉。

## 0. 一句话结论

Module Federation 2.0 是 **前端 runtime adapter**，不是 Xiranite 的插件协议。Xiranite 自己拥有
Plugin Manifest（`manifest.toml`）与 Plugin API；`module-federation` 负责 frontend module 的解析与
加载，`quickjs` 负责节点 TS bundle 的执行，二者互不渗透，且都允许缺位——这就是三种插件形态
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
     runtime =          runtime =         component / tray /
     "module-            "quickjs"        window
     federation"            │
             │                ▼
             ▼        backend/<id>.js     ← esbuild 出的 ESM bundle，导出 run / createRuntime
   mf-manifest.json          ▲
   remoteEntry.js            │
   (MF runtime 自有)   Rust Host ──── 节点协议（BuiltInNode + NodeHost）+ operation 生命周期
                              ▲
                              │ HTTP /operations 族 + 受限 Frontend Host API
                        Frontend Plugin
```

`[backend] runtime` 是一个可扩展的判别字段，而不是「backend 必然等于 QuickJS」的硬编码：原生 Rust
节点与 QuickJS 脚本共用同一条 `BuiltInNode` 缝（ADR-0074 §1/§4），所以后端这一侧真正稳定的是**协议**
而不是引擎。今天宿主实际装载的执行器是 `crates/xiranite-quickjs-executor`；Extism 与 `plugin.wasm`
只剩没删干净的残留，逐条见 §1.4 末尾。

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
  → **「NodeEntry 从哪里来」有且仅有一个切点**，这是本方案能不动 30 份 GUI entry 的前提（现读
  `ls src/nodes/*/entry.ts | wc -l` = 30；`docs/xiranite-target-node-manifest.json` 里 `retain-rewrite` = 28，
  两个数不同源，别混用）。
  **这句当时不完整**：2026-10-05 现读到第二个直接下标者——`src/components/modules/nodeWindowPreferences.ts`
  的 `loadNodeMaximizeAction` 也自己索引了 `packageModuleLoaders`。后果是插件（以及阶段二那种「内置节点
  当 remote」）的 `window.maximizeBehavior` 被忽略：内容从 remote 取，窗口行为从构建表取，而且**不报错**。
  已改成走 `resolveEntryLoader`，并留了 `nodeWindowPreferences.remote.test.ts` 三条断言；其中
  「remote 声明 fullscreen」那条在旧写法下实测变红（1 failed / 2 passed），改回即绿——这条尺看得见缺陷。
- `import.meta.glob` 全仓零命中；清单 100% 编译期写死，只有「何时 load 哪个 key」是运行时。

### 1.2 宿主能力注入（现状是真话还是假话）

- 唯一构造点 `useNodeHostApi(compId, nodeId, schemas)`（`src/components/modules/hostApi.ts`），唯一
  生产调用点在 `ModuleRenderer`。九个能力域 `contract/state/workspace/runner/clipboard/downloads/
  localFiles/config/env` 由模块级常量 `injectedCapabilities` 一次性全量注入。
- **`contract.supportedCapabilities` 声称「宿主只注入这些」，实现却是恒定全量**；
  `hasCapability()` 只查那张常量表。所以第三方接入之前，这个接口是不成立的陈述。
- `NodeHostRequirements` 的唯一消费者是 `diagnoseHostRequirements`：缺能力时**硬拒渲染**出一张诊断卡，
  既不降级也不裁剪；30 个 entry 里只有 3 个声明了 `host`（现读：enginev / kisaki / findz），其余走 `null`
  短路，等于默认全信任。
- 版本协商 `isContractVersionCompatible` 只接受「精确相等」和 `^x.y.z`：`">=1.0.0"`、`"~1"`、`"1.x"`
  一律判 false 并挡死渲染。`manifest.toml` 的版本语法必须与之对齐或把它改成真正的 semver-range。
- `NodeIsolationMode`（`trusted|contained|iframe|worker`）全仓**零消费者**。

### 1.3 构建与运行管线

- 前端产物一条路：`bun run build` → `generate:node-registries` → turbo → `tsc --noEmit` →
  `vite build` → `audit:build-chunks`。Vite 8 已是 rolldown 形态（`@rolldown/plugin-babel`、
  `build.rollupOptions.output.codeSplitting.groups`、`optimizeDeps.noDiscovery`）；React 单例目前靠
  `resolve.dedupe` + `codeSplitting.groups` 的 `vendor-react` 两条一起保证。
- **Wails+Go+Bun embed 那条成品链已经删掉了**（2026-10-05）：根目录那 73 个 `package main` Go 文件、
  `wails:*`/`fetch:bun-runtime`/`build:backend:js`/`package:node-app` 脚本与 CI 的 Go 门禁一起出局，
  前端 transport 只剩 `tauri` channel + `web`。「运行时无 Node/Bun」这条硬约束从此不再有真实违反点；
  剩下的纪律换成 ADR-0075（`bun` 只作 runner，代码不得用 Bun 专有 API），尺是 `audit-no-bun-apis`。
- **Rust/Tauri 宿主已在跑，dev 形态已经连上产品 bundle**：`bun run dev:desktop` = Vite 钉在
  `127.0.0.1:1420`（与 `crates/xiranite-desktop/tauri.conf.json` 的 `build.devUrl` 一致）+
  `cargo build -p xiranite-desktop` + 直接跑那个 debug 二进制；宿主自己绑 `127.0.0.1:0`，经
  `xiranite_bootstrap` 交出 channel，脚本不再传 token/backend URL。`build.frontendDist` 仍指 crate 内
  那份 `frontend/`（现在住着 MF 的 WebView 探针页），**生产形态把 `dist/` 接进 bundle 这一步还没做**
  ——这条仍欠着，只是不再阻塞 dev 与 POC。
- 现采版本（npm registry 直读，`https://registry.npmjs.org/@module-federation/<pkg>/latest`）：
  `runtime`/`enhanced`/`manifest` = 2.9.2，`@module-federation/vite` = 1.23.1（peer `vite ^5||^6||^7||^8`），
  **`@module-federation/rolldown` 不存在（404）**。

### 1.4 后端（QuickJS）侧已完成到什么程度

现读命令：`bun run build:node-bundles`、`bun run audit:node-bundles`、
`cargo test -j 1 -p xiranite-quickjs-executor`。

- **bundle 形状**：`scripts/build-node-bundles.ts` 每节点往 `artifacts/node-bundles/` 写
  `<id>.core.js`、`<id>.platform.js`（只有存在 `platform.ts` 时），以及执行器真正链接的
  `<id>.js`（ESM，由合成 host entry 重导出 `run` 与 `createRuntime`），外加一份 `manifest.json`。
  esbuild 参数是 `--bundle --platform=node --format=esm --metafile`，每个 shim 说明符一条
  `--alias`，platform/host 两次 `--inject packages/quickjs-shims/src/index.ts`。
  产物里 `node:` import 零命中（现读：`rg 'from "node:' artifacts/node-bundles/*.js`）。
- **执行器**：`crates/xiranite-quickjs-executor` 对外是 `Executor` / `EntryPlan` / `EngineLimits` /
  `JsNode` / `JsNodeSpec` / `RunSignals`，协议代号 `PROTOCOL_VERSION = "xrh-v1"`。一次运行 = 一个
  Runtime + 一个新 Context：装 shim → `bundle::resolve`（ESM `Module::declare`+`eval`，否则退回
  global script）→ 按**导出名字**取 entry（`EntryPlan`，namespace 找不到再看 `globalThis`）→
  平台型节点调 `run(input, runtime, onEvent)`、纯逻辑只给一个参数 → 从 `globalThis.__xrOutcome`
  读结果；JS 抛错会变成一条 `success:false` 的结果加一条 `log` 事件（错误是数据，不是 panic）。
- **JS 侧看到的宿主只有一个全局**：`globalThis.__xrh = { call, callBytes, sendBytes, callAsync,
  now, platform }`，宿主操作是点号串 `fs.*` / `proc.*` / `clock.now` / `crypto.*` / `os.*` /
  `service.invoke`——**不是**旧的 `xiranite.fs.stat` 那套能力名。节点专有引擎不走通用 op 表，
  而是一个 `service.invoke` + 注册白名单，今天注册着的服务只有一个：`czkawka`
  （方法 `info`/`scan.duplicates`/`scan.progress`/`scan.cancel`）。
- **引擎原语回来了**（ADR-0073 记为「放弃」的那三条）：`set_memory_limit`、`set_max_stack_size`
  （上限来自 `NodeRequirements.max_live_bytes`，栈按 1/8 夹在 256 KiB–1 MiB）、
  `set_interrupt_handler`（负责取消与 120 s deadline，poll 50 ms）。实测边界照 ADR-0074：
  interrupt 只在 JS 执行时触发，parked await 要由宿主放行，pause 不经 interrupt 实现。
- **策略是数据**：`crates/xiranite-node-registry` 的 `NodeRequirements{roots, processes, services,
  network, enumerates_recursively, max_live_bytes, max_concurrent_items}` 与
  `NodeDescriptor{id, node_version, api_version, requirements}` 就是 ADR-0073 说的那份替代
  （授权根角色 + 外部程序白名单 + 网络主机 + 递归遍历标记 + 字节/并发预算）。
  `crates/xiranite-core/src/filesystem.rs` 继续做授权根与 `..` 逃逸拒绝。
- **HTTP 面只有 9 条**：`GET /health` + `/node-operations` 族（`POST /nodes/{id}/operations`、列表、
  详情、`events`、`stream`、`cancel`、`pause`、`resume`）。TS 客户端声明的 `/config*`、
  `/workspace/*`、`/runtime-history`、`/local-files/*`、`/system/*`、`/file-deletions/*`、
  `/nodes/:id/runtime-info` 在 Rust 侧一条都没有 → full 形态的第三方前端一接产品 GUI 就 404。

尚未闭合的后端事实（决定 backend-only 形态的真实成本）：

- **运行时装载后端插件这条路今天是断的**：Extism 那套 staged 目录装载
  （`<root>/<id>/{manifest.toml,<id>.wasm}`）随 ADR-0073 退役，替它的「清单驱动注册」还没落地。
  今天的表是编译期的：inventory + `register_node!`/`link_nodes!`，宿主实际那张表是
  `crates/xiranite-builtin-host/src/lib.rs` 里两条显式 static（dissolvef + kisaki，bundle 由该 crate 的
  `build.rs` 从 `artifacts/node-bundles/` stage 进来）。**backend-only 形态必须先把注册换成
  `docs/xiranite-target-node-manifest.json` 驱动**，否则第三方后端插件只能靠重新编译宿主。
- wasm 残留未删：`crates/xiranite-extism-adapter` 与 `crates/xiranite-node-runtime` 仍在根
  `[workspace]` 成员里，但没有任何 crate path-depends 于它们（即产品链路走不到），
  `xiranite-node-runtime` 甚至编不过（`E0080` at `capabilities.rs:508`），`manifest.rs` 里还留着
  `BACKEND_RUNTIME = "extism"` 那份 TOML 结构；`scripts/build-node-wasm.ts`、
  `bun run audit:plugin-manifests` 与 `plugins/*/manifest.toml` 说的都是已作废口径。
  删除进度以 `docs/migration/extism-retirement-checklist.md` 为准，本文不再把这套当真源。
- bundle 侧实测缺口：`artifacts/node-bundles/manifest.json` 记 30 条节点记录、28 条 registered、
  只有 24 份 host bundle；bandia/cleanf/enginev/smartzip 四个 core 因
  `packages/quickjs-shims/src/czkawka-service.ts` 缺 `getTrashCapabilities` 导出而构建失败。
- 执行器的**授权**还没接：`Executor::with_files` 至今没有生产调用方（只有
  `src/bin/quickjs-run.rs` 和 `tests/` 在用），所以 `JsNode::run` 一律拿
  `MachineAccess::seam_only()`，`fs.copy`/`mkdtemp`/link 家族/字节通道/子进程表都按名字拒绝。
  插件的 `[permissions]` 声明要有真消费者，得先补这条缝。
- 协议差集门禁 `packages/tauri-migrate/src/http-surface.ts` 的 Rust 默认扫描根仍写着已消失的
  `crates/xiranite-plugins/src`，且已提交的 `artifacts/rust-http-surface.json` 是 `routes=0`
  → ADR-0067 的「协议不缩水」目前**没有证据在背书**，属必须修的门禁完整性。

### 1.5 本轮后端实测补记（2026-10-04 夜，当时跑的是 Extism 链）

三条在真链路里量出来的事实，都已在代码里修掉，留在这里免得被当成「以后再看」。它们修的是
宿主侧（事件流、授权根解析、浏览器接宿主的路径），与执行器是 wasm 还是 QuickJS 无关，所以重锚后
继续有效；引用时注意两条现状变化：`XIRANITE_PLUGIN_DIR` 已随 Extism 退役（见
`crates/xiranite-loopback-host/src/launcher.rs` 的模块注释），`XIRANITE_ALLOWED_DIRS` 仍然是授权根的入口；
`xiranite-dev-host`（`crates/xiranite-loopback-host/src/bin/dev_host.rs`）继续是浏览器面接 Rust 宿主的 debug 入口。

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
   （`crates/xiranite-loopback-host/src/bin/dev_host.rs`）：debug-only、打印通道 JSON、`--ttl-seconds` 有限
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
# 今天的取值是 `major.minor[.patch]` 裸数字：待退役的 `scripts/audit-plugin-manifests.ts` 里那份
# VERSION_PATTERN 拒掉 `^1.0` 这类 range 写法，Rust 侧 `NodeDescriptor.api_version` 也只按裸数字比对，
# semver range 比较属于未落地项（§14），别在清单里先写出来骗实现。
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
integrity = "sha384-…"                   # 由 Xiranite 在 fetch 钩子里自验（§6 第 5 条已落地：
                                         # 键是绝对 URL → SRI，见 src/plugins/frontendIntegrity.ts；
                                         # 今天由 `bun scripts/plugin-integrity.ts <url>` 生成）

[[frontend.exposes]]
id = "foo.panel"
module = "./FooPanel"                    # → 宿主 workspace 组件（MODULE_REGISTRY / ModuleRenderer 有消费者）

# 注意：`type = "route"` 现在**没有消费者** —— 全仓没有 URL 路由
# （无 `@/router` 模块、无 hash/history 路由、入口是 createRoot(...).render(App)；
#  `audit-node-ui-independence.ts` 的 COUPLING_PREFIXES 里那个 `@/router` 是死前缀）。
# 要做 route 贡献，前提是宿主先有路由层；在那之前 route 不进贡献词表。

[backend]
runtime = "quickjs"                      # 今天宿主实际跑的执行器；其余值直接拒绝，而不是当成 quickjs
entry = "backend/foo.js"                 # esbuild 出的 ESM bundle（相对清单解析），不是 wasm
run_export = "runFoo"                    # 执行器按导出**名字**取 entry（EntryPlan）；没有「零参数导出」约定
create_runtime_export = "createNodeFooRuntime"   # 平台型节点才有；纯逻辑节点两条都不需要
node_version = "1.3.0"                   # 节点自己的版本，与 backend_api / 宿主协议代号分离
max_live_bytes = 16777216                # EngineLimits::from_descriptor 的来源；0 会被直接拒绝
max_concurrent_items = 64
roots = [{ role = "workspace", access = "read-write" }]       # NodeRequirements 的授权根
processes = [{ program = "ffmpeg", confirm_before_run = true }]  # DangerGate 挂在注册点上
services = ["czkawka"]                   # 一个 service.invoke + 注册白名单；方法表由宿主侧声明
network = []                             # 空 = NetworkAccess::Disabled
enumerates_recursively = false           # 递归遍历要显式授权（ADR-0072）
# 作废、不得出现在清单里：entry_point（零参数 i32 导出）、runtime_version（Extism 版本事实）、
# memory_max_pages（线性内存页）、host_functions（9 条 `xiranite.*` 能力词表）。
# `allowed_paths`/`allowed_hosts` 换成上面的 `roots`/`network`：旧那两条本来就解析后无人消费，
# 新那两条落在 `NodeRequirements` 这个已经有消费者的结构上。
# JS 侧实际看到的宿主操作名由 `packages/quickjs-shims` 与 `globalThis.__xrh` 那六个成员决定
# （`fs.*`/`proc.*`/`clock.now`/`crypto.*`/`os.*`/`service.invoke`），清单里不许写 `xiranite.fs.stat`。

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

迁移是**替换不是并存**（不留 JSON 垫层）：清单格式在 2026-10-04 已一次性落到 TOML，读取器
`crates/xiranite-node-runtime/src/manifest.rs`（`toml = "1.1"`，与 `xiranite-core` 同一条版本线）、
`scripts/build-node-wasm.ts`、`scripts/audit-plugin-manifests.ts`（当时用 `Bun.TOML.parse` 读，按
ADR-0075 这条也得换成标准 TOML 库）与全部现存清单都不再认 JSON。**但那份 TOML 结构描述的是作废的
wasm 字段**，所以这次重锚不只是改文档：`[backend]` 的解析要按上面的 QuickJS 字段重写，而它所属的
`xiranite-node-runtime` 目前连编译都不过（`E0080` at `capabilities.rs:508`）。真源随之改成
`docs/xiranite-target-node-manifest.json` + `bun run audit:node-registry` / `audit:node-bundles`，
`bun run audit:plugin-manifests` 与 `plugins/` 一起退役（AGENTS 已定）。
`[frontend]`/`[permissions]`/`[[contributions]]` 由将来的 Plugin Manager（TS）读；Rust 侧读取器**容忍**
它们但**不校验**，因为 `[backend]` 缺失的清单本来就不该进节点表（frontend-only 形态没有后端）。
**2026-10-05 状态与一条卡点**：记录层已经能承载这三段（`pluginRegistry.ts` 的
`capabilities`/`integrity`/`allowedOrigins`/`contributions`），但**把 TOML 文本读成这份记录的那一步还没做**。
原因不是设计而是依赖声明：仓里唯一的通用 TOML 解析是 `packages/config` 导出的 `parseToml`
（`smol-toml` 声明在**那个包**里），而根 `package.json` 既没有 `@xiranite/config` 也没有 `smol-toml`，
`src/` 现在 import 它就等于加一条未声明依赖；根 `package.json` 此刻正被另一条泳道的未提交 hunk 占着，
`but commit` 按整文件收会把别人的改动一起吃进去。所以这一步等 `package.json` 空出来再补，
**不手写一个 TOML 解析器顶上**（AGENTS：优先复用成熟依赖，别重写基础设施）。

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
- **已落地（2026-10-05 实测）**：`src/plugins/frontendHost.ts` 是那份投影，`ModuleRenderer` 在把 host
  交给组件之前调它（`projectHostForModule`），判定依据就是「这个 moduleId 有没有被绑到某个 remote」
  （`dynamicEntries.frontendPluginForModule`）。三层按 §10.1 第 3 条成立：声明 =
  `FrontendPluginSpec.capabilities`（今天来自安装方，dev 页用 `&capabilities=`），授权 = 声明 ∩
  `GRANTABLE_FRONTEND_CAPABILITIES`，投影 = 只带授权到的命名空间 + 如实的 `contract`。
  **默认拒绝**：没声明就只拿到 `contract`。
  天花板今天排除 `runner`/`clipboard`/`downloads`/`localFiles`，理由不是保守而是这三条宿主还兜不住：
  `runner` 按任意 nodeId 打后端而整个宿主只有一个 bearer token（§10.3 第 1 条没做），
  `clipboard`/`localFiles` 是 OS 面且形状已按平台漂移（§6 第 6 条）。**要放开就得先补那两条**。
  `trust: "internal"` 是 §2.4 那句「内部 trusted Node 保持现状」的落点（阶段二把仓库自己的
  `entry.ts` 当 remote 就属于这类），它返回**同一个 host 对象**，因此 §10.2 第 3 条要的实例等价语义
  没有被投影层改动。
- 前端 → 后端只走 Xiranite Plugin API（今天即 `/operations` 族 + `@xiranite/api` 客户端），
  **不允许前端直接依赖后端执行器**（QuickJS 实例、宿主服务、`NodeHost` 都不是前端能拿的东西），
  也不给第三方插件暴露 Tauri command。
- 待补：插件级作用域凭证。今天一个宿主 bearer token 打通全部路由且可落 query；第三方插件必须拿
  按 manifest 能力裁剪的派生 token，否则权限过滤形同虚设。

### 2.5 Plugin Manager（第 6、7 条）

新增一层，明确职责：`discover / install / uninstall / enable / disable / update / validate /
resolve dependencies / check API compatibility / check capabilities / load frontend / load backend /
lifecycle`。MF runtime 只做 frontend module 加载，宿主内的执行器只做节点逻辑（今天是 QuickJS 跑
TS bundle），**安装/卸载/权限/版本管理
归 Manager**。分发来源抽象：Local File、URL、GitHub Release、Plugin Registry、Built-in、
Development。

**前端这一半已经起头（2026-10-05，`src/plugins/pluginRegistry.ts`）**：`discover / install /
uninstall / enable / disable / validate` 六条是实函数，`validate` 把错误**当数据返回**（一次报全，
不抛），`install` 落记录并在同一步激活；记录里的 `contributions` 同步进 §10.1 那份贡献表，
`disable`/`uninstall` 会把它撤掉（撤的是「贡献注销 + 拒绝再加载」，§4 的口径，不宣称释放内存）。记录今天存在 `localStorage`（key
`xiranite.frontendPlugins`）——**理由与代价都记在这**：`xiranite-api` 那 9 条路由里没有 `/config`
（§1.4），宿主侧那份带锁 + 原子写的配置服务还没有 HTTP 面可写，而成品 WebView 除 `localStorage`
之外没有别的持久化；这与 `src/store/workspaceStore.ts` 已有的分工一致（UI 偏好留本地、业务数据给
后端），插件安装记录属前者。**`/config` 一落地，这个模块的存储层就是要搬走的那一块**，读写已经各自
收在一个函数里。`update / resolve dependencies / check API compatibility` 与分发来源抽象仍未做。

## 3. 三种形态与各自缺什么

| 形态 | 现在能不能跑 | 缺什么 |
| --- | --- | --- |
| frontend-only | **能**（`examples/plugins/frontend-only`，2026-10-04 真 Chrome 实测） | `manifest.toml` 的 `[frontend]` 解析、PluginManager 的注册表读取。`AppNodeEntry.core` 已改可选（`HeadlessNodePackage.core` 仍必填），纯前端插件不再需要伪造 core |
| backend-only | **不能**（10-04 当时能，靠的是 Extism 的 staged 目录装载；那条链已作废） | 缺的是**运行时注册**：`NodeRequirements` 已经能表达策略，但注册仍是编译期的 inventory + `crates/xiranite-builtin-host` 里两条显式 static。要做成两件事——清单驱动注册（AGENTS/ADR-0073 已定，替掉逐节点仪式）与执行器授权接线（`Executor::with_files` 至今无生产调用方）。旧字段那批补齐项（`entry_point`、零参数导出、`host_functions`）不再需要，它们随 ADR-0073 一起作废 |
| full | **能（本轮实测）**，两档 | 最小第三方形态：`examples/plugins/dissolvef-full` 端到端跑通（plan 6 行 / 真实执行 6 success / undo 还原，全部按磁盘状态验证）。口径要写清：当时那条链是 Axum → NodeRuntime → Extism，同一节点今天的实现是 QuickJS bundle（`crates/xiranite-builtin-host/src/dissolvef.rs` 以 `JsNodeSpec::platform("runDissolvef", "createNodeDissolvefRuntime")` 注册）。内部节点形态：`examples/plugins/dissolvef-product` 把仓库自己的 `entry.ts` 当 remote，节点原界面照常渲染。缺的产品级外壳不变：`xiranite-api` 只实现 9 条路由、插件级受限凭证、受限 host 投影、PluginManager |

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

**这三条现在都真的存在了（2026-10-05）**。第二条以前缺：注销绑定之后，已经挂在屏幕上的 remote 组件
不会重渲染，看起来像「卸载了」其实还在。现在 `dynamicEntries` 的绑定表带一个变更计数器
（`subscribeEntryBindings` / `getEntryBindingsVersion`），`PackageNodeRenderer` 用
`useSyncExternalStore` 订阅它，并且 loader 缓存的 key 里带上这个版本号——所以解绑会让该模块重新解析
（解析不到就落到「failed to load」卡），重新绑定会真的再取一次而不是回放旧缓存。
判据：`ModuleRenderer.plugin.test.tsx` 三条（绑定→渲染 `REMOTE V1`；解绑→组件被换下；重绑并换内容→
`REMOTE V2`），并把 `bindingsVersion` 从 effect deps 里摘掉做对照，实测恰好那两条变红
（`2 failed | 1 passed`），装回去即全绿。

## 5. 版本与兼容（第 16 条）

- `frontend_api` / `backend_api` 独立 range；`api_version` 语义分裂成两条会消除今天「一个版本号同时
  表示前端契约和后端契约」的错误。后端这一侧今天有三个互不相干的版本事实，别混：清单的
  `backend_api`、`NodeDescriptor.api_version`、执行器与 shim 约定的协议代号
  `PROTOCOL_VERSION = "xrh-v1"`。最后那条是 JS↔宿主调用的代际，不是插件发布版本，不该写进清单。
- 版本比较必须换成真 semver range 实现（现有 `isContractVersionCompatible` 只认精确与 caret，见
  §1.2），否则 `"^1"`、`"1.x"` 这类合法写法会挡死插件。选定：TS 侧用现成 range 库、Rust 侧按
  `NodeDescriptor.api_version` 走同一套规则，两侧一致由门禁证明。
  `xiranite-plugin-api::protocol_version` 的 `PLUGIN_ABI_VERSION_MAJOR` 按 ADR-0073 属删除项，
  不能再当 Rust 侧真源引用。
  **2026-10-05 进度（TS 侧）**：那条规则已经从 `ModuleRenderer` 里搬进
  `packages/contract/src/versionRange.ts`（`@xiranite/contract` 导出
  `checkContractVersion` / `isContractVersionCompatible`），终端面要用就是同一条实现。实现的是一个
  **点名过的子集**：精确 `X.Y.Z`、`^`（1–3 段，含 npm 的 `0.x` 钉 minor 规则）、`~`（同前缀 + 下界）；
  `>=`、`1.x`、`||`、prerelease/build 一律返回 `unsupported-range`，诊断卡因此说「这个 range 语法没实现」
  而不是「你的宿主版本不对」。顺带修掉一个 under-reject：旧的 caret 分支只比 major、不看下界，
  `^1.5.0` 会放宿主 `1.0.0` 过去。**仍欠两条**：真正的 range 库（根 `package.json` 现在被别的泳道占着，
  加不了依赖声明），以及 Rust 侧对齐 + 「两侧一致」的门禁（§10.3 第 3 条）。

## 6. 安全模型（第 17 条）

1. 默认无权限：`[permissions]` 未声明即拿不到。
2. 双层强制：manifest 声明 ∩ 宿主授权。后端这条今天**有结构、没有闭环**：`NodeRequirements` 就是
   那份授权数据，但执行器的授权入口 `Executor::with_files` 没有生产调用方，实际每次运行都是
   `MachineAccess::seam_only()`（copy/mkdtemp/link/字节通道/子进程表按名字拒绝）；前端要新建投影层。
3. 前端不接触执行器（QuickJS 与宿主服务都不是插件能直接拿的东西），不接触 Tauri command；
   只经 HTTP Plugin API + 受限 host。
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
   **已按第一条落地（2026-10-05，`src/plugins/frontendIntegrity.ts`）**：安装方声明 `pin`（绝对 URL →
   `sha384-…`）与 `allowedOrigins`，宿主把它们写进 runtime 的 `fetch` 钩子。选钩子而不是「校验完再放行」
   的理由在源码里：`loaderHook.lifecycle.fetch.emit(...)` 的结果**会被原样采用**
   （`if (!res || !(res instanceof Response)) res = await fetch(...)`），所以「检查过的字节」与
   「被求值的字节」是同一份，换包窗口被关掉；`runtime-core@2.9.2` 实测这一行成立。
   **边界要说清**：只有被 pin 的 URL 受保护，remote 的异步 chunk 不在内（MF 不给 hash 清单，逐文件
   pin 才是全覆盖）；未声明 pin 的插件是透传，不是「已验证」。
6. 运行时形状漂移要禁止：今天 `clipboard.readFiles/writeFiles` 与 `localFiles.subscribeDrops` 是按
   平台条件注入的，同一 key 在不同机器存在性不同——对第三方必须改为「能力声明 + 协商」而不是
   运行时猜形状。
7. **安装入口自己也在授权面内**（2026-10-05 落地）：`src/entrypoints/plugin-host.html` 是
   `vite.config.ts` 生产 `input` 表里的一条，若它接受 query 直接注册 remote，就等于「任何能打开这个
   地址的人都能把代码塞进宿主 realm」。§10.1 第 3 条的「授权」还没有 UI，所以先把这条路关到 dev 构建：
   `pluginRegistry.ts::urlInstallAllowed(env)` 只在 `env.DEV === true` 时放行（缺标记按生产处理），
   生产构建里这个页面只加载**已安装**的插件（`?module=<id>`），不装新的。
   三条断言在 `pluginInstallPolicy.test.ts`（含「没有 DEV 字段必须拒」这条默认拒绝的控）。
   **验证口径说清楚**：我一开始想「跑生产构建看那条分支有没有被消掉」，这个判据是错的——生产里
   `urlInstallAllowed()` 恒为 `false`，所以**被留下的正是那句拒绝提示**，安装代码只是运行时不可达，
   打包器不会删它。真正成立的是两件事：产物里 `import.meta.env` 已全部内联（现读
   `dist/assets/plugin-host-*.js` 对 `import.meta.env` 零命中，没有运行期可读的 env 面），
   以及三个 env 分支的语义由上面那三条断言覆盖。

## 7. Dev / Production 模式（第 19 条）

- Dev：`xiranite plugin dev` 把 remote 指到 `http://localhost:3000/mf-manifest.json`；backend 单指
  `artifacts/node-bundles/<id>.js` 那份 TS bundle（宿主内 QuickJS 装载，不重新编译）。开发环境允许
  Vite/Rspack dev server（**开发机**装 Node/Bun 是允许的；`bun` 只作 runner，代码不得用 Bun 专有
  API——ADR-0075）。
- Prod：WebView 里只有 JS runtime + MF runtime，节点逻辑在 Rust 宿主内的 QuickJS 里跑。运行时无
  Node/Bun/npm/pnpm 的证据链靠三条门禁：`crates/xiranite-desktop` 不引 Go/Bun、
  `audit:build-chunks` 确认打包资源里没有 `node:` import、`audit-no-bun-apis` 保证脚本与终端面不用
  Bun 专有 API。§1.3 那条真实违反点（Wails+Bun embed 链）已在 2026-10-05 删掉，不是绕过。
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
  `entryGlobalName` 下 React 19 **子路径前缀项**是否真命中（要看 network 面板）；⑦ ~~冷启动
  `registerRemotes` 后立刻 `loadRemote` 的 `<script>` 竞态~~ **已实测无竞态，见 §14 第 7 条**。

## 8. `.xplugin`（第 18 条）

`.xplugin` = 发行容器（zip），里面是 `manifest.toml` + `frontend/` + `backend/`。它**不是运行时
格式**：解包后落到宿主的插件目录，前端交 MF runtime、后端交宿主内的 QuickJS 执行器（装载点就是
§1.4 说的那条「清单驱动注册」，它今天还是断的）。允许三种发行：`foo.frontend`、`foo.backend`、
`foo.xplugin`（组合）。纯前端插件不该被迫带一个空 bundle。

## 9. 实施顺序（本文件只承诺第一步）

1. 现状盘点（已完成，见 §1，四路只读 + 我本人回验）
2. `docs/plugin-architecture.md`（本文）
3. **POC：frontend-only**——host `createInstance` + `registerRemotes` + `loadRemote`，受限
   `XiraniteFrontendHost`，装插件不重编宿主，macOS WebView 实机验证。
   **完成度（2026-10-05 现读代码）**：`src/plugins/{frontendRuntime,dynamicEntries}.ts` +
   `src/plugin-host-main.tsx` 已就位（remote 走 query 参数、`ModuleRenderer` 只经
   `resolveEntryLoader` 取 loader）；`route` 贡献已从本阶段**删掉**——宿主没有 URL 路由（§2.1 注释）；
   **受限 `XiraniteFrontendHost` 已落地（2026-10-05，`src/plugins/frontendHost.ts` + `ModuleRenderer`
   接线，四条真浏览器实测见 §14）**。本阶段剩下的只有「macOS WebView 里用宿主 MF runtime 实例渲染产品
   组件」那一条（§14 第 1 项）。
4. 阶段二：现有 `AppNodeEntry` 作为 MF2 remote（`Component.tsx` 零改）——已完成
   （`examples/plugins/dissolvef-product`，四条边界见 §3）
5. 阶段三：full（MF2 frontend → Plugin API → **宿主内 QuickJS 节点**）+ `examples/plugins/` 三个
   可运行示例——frontend 侧已实测；后端那一半在 10-04 走的是 Extism 链，要按 QuickJS 重跑一遍
6. PluginManager / Registry / `.xplugin` / 插件级凭证 / CSP，按验收项逐条补。
   后端插件的装载前提排在前面：**注册必须先变成清单驱动**，否则 6 里的 install 链没有落点。
   已在这一格里完成的：**资源 pin + 来源白名单**（§6 第 5 条，`src/plugins/frontendIntegrity.ts`）、
   **能力投影**（§2.4，`src/plugins/frontendHost.ts`）、**安装记录与启动激活**（§2.5，
   `src/plugins/pluginRegistry.ts` + `src/main.tsx`）。剩下的：PluginManager 的
   `update`/依赖解析/分发来源、`[frontend]` 的 TOML 解析（今天记录来自 query 而不是清单文件）、
   插件级派生 token（做完才谈得上把 `runner` 放进天花板）、生产 CSP 收紧（§7）。
7. 不做的事：不同时改 Node、Rust、执行器、Manager、Registry、UI；不把 `host` 整体跨 realm 传；
   不为「未来可能是 WIT/Component Model」提前堆抽象；不为已经作废的 Extism 口径保留兼容字段。

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
   注释），把它写进词表就会立刻变成第二个「声明了没人服务」的字段。其余按需再加，且加一类必须同时加
   「声明即有消费者」的门禁。
   **`component` 这一类已经有消费者了（2026-10-05）**：`src/plugins/contributions.ts` 是那份运行期
   贡献表，模块库（`views/ModuleRegistry.tsx`）、A–Z 部署栏（`workspace/AlphabetNodeRail.tsx`）与
   `modules/registry.ts::getModule` 三处都从它读；`tray`/`window` 仍**不接**——`registerModuleContributions`
   对没消费者的 kind 直接记一条 note 并忽略，安装期的 kind 词表也在 `pluginRegistry` 里闭合到这三条。
   与内置 id 撞车的贡献**不会变成第二行**（阶段二那种「用 remote 顶替内置节点」走的是 loader 的绑定，
   不是列表）。
2. **PluginManager + Registry + `.xplugin` 安装链是一个产品量级**，不该进第一阶段。验收 6
   （装插件不重编宿主）**只在前端这一半还成立**：MF 的 `registerRemotes` 是运行时的，所以装一个
   frontend 插件确实不用重建宿主。后端那一半的对应物随 Extism 退役了——今天节点表是编译期的
   （§1.4），所以「装后端插件不重编」要等清单驱动注册落地才可能成立，不能拿旧 wasm 的 staged
   目录当证据。install/update/依赖解析推迟，`discover` 已是接口，架构不因推迟而改变。
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
| 8 | ~~两条前端装配路径并存~~ **已收敛**（2026-10-05 现读）：Wails+Bun embed 链与 `wails:build` 删除，`XIRANITE_NODE_APP_ID` 那份多入口分支连同独立壳一起出局，`vite.config.ts` 的 `build.rolldownOptions.input` 现在只剩 `{ index, "plugin-host" }` | 现读：`rg XIRANITE_NODE_APP_ID vite.config.ts scripts src` 零命中 | 不再列为冲突；每节点独立 GUI 走 ADR-0069 §Standalone 的 route A/B，与本文件无关。**注意另一面**：`plugin-host.html` 已进入生产 input 表，POC 页就此变成产品的一部分，§7 的 CSP 收紧要先按这个事实评估 |
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

再加一条小的：`contribution.module = "./FooPanel"`（异步模块 id）与 `[backend].run_export`（bundle 里的
导出符号）是两种生命周期的语言，Manager 对外应统一成一个 descriptor（「这个插件可以被调用的东西」），否则每个
消费者都要自己解析两套形状。



## 11. 已确认需要修的既有缺陷（不是新功能，属正确性）

- ~~`contract.supportedCapabilities` 与注释不一致（声称裁剪、实际全给）~~ **已修**（2026-10-05）：
  投影层落地后该字段只报授权结果，实测见 §14。
- **`src/**` 的 Vitest 管路此前对每个文件都在收集期红**：Vitest 4.1.10 交给测试的 `window` 没有
  `localStorage`，而 `src/i18n` 的 `languageChanged` 监听器要写它 ⇒ setup 抛错、整个套件「1 failed /
  no tests」。已在 `src/test/setup-i18n.ts` 补上浏览器本来就有的 Storage（实测 `ModuleRenderer.test.tsx`
  从「收集不到」变成 21 条跑完）。
- 管路修好后露出的**旧红（与插件无关，未修）**：`ModuleRenderer.test.tsx` 的
  「retries a package entry…」断言 `console.error` 收到
  `"[module-renderer] failed to load entry for retry-node"`，而源码自 2026-07-23（`b57bfe2c`
  结构化日志）起发的是 `logger.error("Failed to load module entry", …)`，且该 logger 走
  `loglevel.withTag("xiranite:module.renderer")`、测试里 `console.error` 调用数为 **0**。
  要么断言按现在的日志形状重写，要么查测试环境下日志级别——属日志面自己的账。
- ~~`isContractVersionCompatible` 拒绝合法 range 写法~~ **TS 侧已修**（2026-10-05）：实现搬进
  `@xiranite/contract`，`^`/`~` 支持 1–3 段并补上下界判断（旧实现 `^1.5.0` 会放过宿主 `1.0.0`），
  没实现的语法改成显式 `unsupported-range`。Rust 侧对齐与 range 库仍欠，见 §5。
- `http-surface` 的 Rust 扫描根指向已消失的 crate，parity 门禁空转。
- （原「`backend.allowed_paths`/`allowed_hosts` 解析后无消费者」随 wasm 清单作废。）替代它的两条现在
  成立：`NodeRequirements` 有结构但执行器的授权入口 `Executor::with_files` 无生产调用方，运行期一律
  `seam_only()`；`docs/xiranite-target-node-manifest.json` 这份清单真源还没替掉编译期注册。
- wasm 残留属同一类正确性债：`manifest.rs` 还在按 `BACKEND_RUNTIME = "extism"` 校验、
  `scripts/build-node-wasm.ts` 与 `audit:plugin-manifests` 还在门禁表里、`plugins/*/manifest.toml`
  还在树里，说的都是作废口径；按 AGENTS 它们要随 `plugins/` 一起删掉。
- `node-contract.md` 把 `Component.tsx` 的位置与必填性写错，并教 `runner.runNode` 这种会被门禁
  判红的写法；`validate-node-architecture.ts` 的 Component 分支因此是死码。
- 27/30 个 GUI entry 不声明 `host` 要求，remote 化后等于默认全信任。
- ~~`nodeWindowPreferences.ts` 是第二个直接读生成表的地方~~ **已修**（2026-10-05）：改成走
  `resolveEntryLoader`，缺陷证据与对照见 §1.1。
- `StandaloneNodeApp` 路径从不做 host 需求校验。
- **应用的生产构建目前是断的（2026-10-05 实测，与本文件无关但挡住 §7 的生产验收）**：
  `bunx vite build` 跑完分块后栽在一条解析上——
  `Rolldown failed to resolve import "@xiranite/node-trename/help" from
  src/components/modules/packageModules.generated.ts:95`。两侧看着都齐：
  `node_modules/@xiranite/node-trename` 软链在、`packages/nodes/trename/package.json` 有
  `exports["./help"]`、`dist/help.js` 也在；dev server 不报是因为 help 卡是懒加载、没被触发。
  归因没做完（该包的注册表与 trename 的更名正在别的泳道里动），**所以这里只记症状不记结论**：
  在有人确认之前，任何「生产构建已通」的说法都不成立。

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

- 后端半（2026-10-05 重锚）：`docs/adr/0073-retire-wasm-and-register-native-nodes-through-inventory.md`、
  `docs/adr/0074-keep-runtime-boundaries-with-quickjs-as-one-node-executor.md`（§1/§2/§4 定「协议稳定、
  执行器可选」）、`docs/migration/extism-retirement-checklist.md`（残留删除进度）、
  `docs/migration/quickjs-substrate-evaluation.md`（引擎证据包）。代码侧现读：
  `scripts/build-node-bundles.ts`（三份产物与 esbuild 参数）、`artifacts/node-bundles/manifest.json`
  （30 records / 28 registered / 24 host bundle）、`crates/xiranite-quickjs-executor/src/{lib,engine,
  bundle,shims,host_calls,host_services,machine}.rs`（`xrh-v1`、`__xrh` 六成员、limits/interrupt 边界）、
  `crates/xiranite-node-registry/src/lib.rs`（`NodeRequirements`/`NodeDescriptor`）、
  `crates/xiranite-builtin-host/src/{lib,dissolvef,kisaki}.rs`（今天那张编译期表）、
  `crates/xiranite-api/src/lib.rs`（9 条路由）、`crates/xiranite-loopback-host/src/launcher.rs`
  （`XIRANITE_ALLOWED_DIRS` 仍在、`XIRANITE_PLUGIN_DIR` 已删）。
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

**已实测（2026-10-04 第二轮，真 Chrome + 宿主 dev server + 外部 `vite preview`，后端换成
`xiranite-dev-host` 起的 Rust/Axum + Extism）**——括注：**这条后端链 2026-10-05 已作废**（§1.4），
同一节点今天的实现是宿主内 QuickJS 跑 TS bundle。本段里只有「前端经 `/operations` 打宿主、按磁盘状态
核对 plan/执行/undo」这部分与执行器无关、继续成立；端到端本身要在 QuickJS 上重跑一遍才算数。
full 形态端到端跑通——仓库外构建的 remote 用
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

**已实测（2026-10-05，真 Chrome + `bun run dev:vite`(5173) + 外部构建的 `poc_frontend` remote(4176)）**：
能力投影端到端成立，四条各配一张截图判据，判据取**插件自己渲染出来的那一行**（`entry.tsx` 打印
`host.contract.supportedCapabilities`），不是宿主侧的自述：

| URL 参数 | 宿主回读 | 插件里看到的授权 | `host.env.theme` |
| --- | --- | --- | --- |
| （无） | `trust=third-party granted=[contract]` | `contract` | `unknown`（`env` 确实没给） |
| `capabilities=state,env` | `granted=[contract, state, env]` | `contract, state, env` | `light` |
| `capabilities=runner,env` | `granted=[contract, env] refused=[runner]` | `contract, env` | `light` |
| `trust=internal` | `granted=` 九项全列 | 九项全列 | `light` |

三条要点：① 默认拒绝不是装饰——第一行里 `env` 缺席导致节点自己打出 `unknown`；② 越界声明被拒且**可见**
（`refused=[runner]`），第四行证明内部 trusted 路径（阶段二/三的示范）没被这次改动打断；③ 四种情况下
remote 都在宿主 realm 里正常渲染并带着 `react 19.2.4` 的共享实例（没有 Invalid hook call）。
纯逻辑侧的 12 条断言在 `src/plugins/frontendHost.test.ts`（含「天花板不许等于全集」这条反自己路的控）。

**已实测（2026-10-05，同一套管路）：资源完整性与来源白名单**。pin 由 `bun scripts/plugin-integrity.ts`
生成（`Buffer` 路径），浏览器侧由 `crypto.subtle` + `btoa` 计算（另一条实现），**两边算出同一个
`sha384-WsojKdNl71Q…myxApRR0`** —— 这本身就是对校验实现的一次交叉验证。两条判据：

| URL 参数 | 结果 |
| --- | --- |
| `pin=<manifest>|<对的 hash>` + `pin=<remoteEntry>|<对的 hash>` + `origin=http://127.0.0.1:4176` | 页面打 `pins: 2 pinned, origins: http://127.0.0.1:4176`，插件照常渲染（react 19.2.4、`granted=[contract]`）——说明钩子供出的字节能被 MF 求值 |
| 把 `remoteEntry` 的 hash 末段改成 `AAAAAA` | 页面打「插件资源校验失败：integrity mismatch … expected sha384-…AAAAAA, computed sha384-WsojKdNl…」，**插件不渲染** |

第二条是这把尺的阳性对照：不校验时它必然通不过。另有 9 条纯逻辑断言在
`src/plugins/frontendIntegrity.test.ts`，其中一条专门测「换包窗口」：先按 pin 校验通过并缓存字节，
再把源站换成别的字节，第二次必须仍交出**原来那份**且 `fetch` 只被调用一次。

**已实测（2026-10-05）：验收 6「装插件不重编宿主」在前端这一半成立，而且之后不需要再带 URL**。两步：

1. `?plugin=poc_frontend&entry=http://127.0.0.1:4176/mf-manifest.json&type=module&capabilities=state,env`
   → 页面打「… · 本次安装」，remote 渲染，`granted=[contract, state, env]`。
2. 换一条**只带模块名**的 URL：`?module=poc_frontend`（没有 plugin/entry/pin/origin）
   → 页面打「… · 来自已安装记录（未带 URL 参数）」，同一个 remote 照常从 4176 加载渲染，
   授权仍是记录里那三项——来源、pin、能力都跟着记录走，query 只是安装入口。

同时确认这次给产品入口接线没把它打坏：带着这条已安装记录打开 `/`（主应用），画布、字母索引栏、
模块库照常渲染（页顶那条「Local Backend 未能启动」红条只是因为这个标签页没接 Rust 宿主，与插件层
无关）。16 条注册表断言在 `src/plugins/pluginRegistry.test.ts`，含三条反自己路的控：
`enabled:false` 必须**不**被激活、torn JSON 必须报「不可读」而不是读成「没装」、
第二个插件抢同一个 `moduleId` 必须被拒。

**未拿到截图的一条（2026-10-05）**：贡献的模块在**模块库/A–Z 栏里那一行长什么样**没有实机目视证据——
浏览器连接器在那一步整个不可用（`take_snapshot`/`take_screenshot`/`list_pages` 全部超时）。已证到的是
数据与订阅两层：`contributions.test.ts` 8 条（含「撞内置 id 不出第二行」「没消费者的 kind 只记 note」）
与 `useContributedModules.test.tsx` 2 条（真渲染组件，注册→`2:example.a,example.b`→清除→`0:`，
证明消费者确实会重渲染而不是静默少一行）。目视确认留给下一次连接器可用时。

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
7. ~~冷启动 `registerRemotes` 后立刻 `loadRemote` 是否存在 `<script>` 竞态（`globalLoading` 复用行为）~~
   **已实测（2026-10-05，真 chromium / Vitest Browser Mode）**：没有。`src/plugins/
   frontendRuntime.browser.test.ts` 用一个手写的 ESM remote（`__fixtures__/esm-remote-entry.js`，
   就是探针测到的 `get`/`init` 形状）走真 runtime，三条判据：注册后**同一 tick 并发**两次
   `loadRemote` 都拿到模块、`init` 只跑一次、entry URL 的 resource timing 只有 1 条；后续重复加载与
   换 expose 也都不再下载。**顺带量到两条写插件必须知道的契约**：`loadRemote("id/entry")` 到容器是
   `get("./entry")`（`./` 是 key 的一部分，所以 §2.1 的 `module = "./FooPanel"` 不是装饰），
   且 `get` 是**每次 `loadRemote` 都调一次**（同一 expose 也不会被宿主缓存返回值），所以 remote 的
   `get` 必须便宜且幂等；反过来，比较两次 `loadRemote` 的返回对象身份**不是**去重判据——它每次都是
   新包装的命名空间对象，要数就数容器调用或网络。
