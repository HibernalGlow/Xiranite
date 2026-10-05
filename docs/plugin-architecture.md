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
  `xiranite_bootstrap` 交出 channel，脚本不再传 token/backend URL。**打包态那个洞 2026-10-05 已被另一条
  泳道补掉**（我此前记的「`build.frontendDist` 仍指 crate 内 `frontend/`、生产接不进 `dist/`」到此作废）：
  现读 `crates/xiranite-desktop/tauri.conf.json` 是 `frontendDist: "../../dist"`（**crate 相对**）+
  `beforeBuildCommand: "bun run build"`，并由 `crates/xiranite-desktop/tests/webview_assets.rs` 钉住；
  crate 内那份 `frontend/` 退成诊断用途（`index.html` 的协议自检与 `mf-probe.html` 的 WebView 探针，
  由 `tauri.conf.selfcheck.json` 这个 flavor 保留）。⇒ 对本文件的意义：**生产形态下 WebView 里就是产品
  React bundle**，§14 第 1 项「宿主 MF runtime 在 WKWebView 里渲染产品组件」从此可以真跑，不再需要先补洞。
- 现采版本（npm registry 直读，`https://registry.npmjs.org/@module-federation/<pkg>/latest`）：
  `runtime`/`enhanced`/`manifest` = 2.9.2，`@module-federation/vite` = 1.23.1（peer `vite ^5||^6||^7||^8`），
  **`@module-federation/rolldown` 不存在（404）**。

### 1.4 后端（QuickJS）侧已完成到什么程度

现读命令：`bun run build:node-bundles`、`bun run audit:node-bundles`、
`cargo test -j 1 -p xiranite-quickjs-executor`。

> **下面四条是「引擎事实与协议事实」的旧落点，本文只保留到它们搬家为止。** ADR-0078
> （`docs/adr/0078-keep-the-quickjs-substrate-in-two-portable-crates.md`，2026-10-05 accepted）定的规则是
> 这类事实**只写进 `crates/quickjs-realm` 与 `crates/quickjs-host-protocol` 的模块文档**，其它文档留结论与链接。
> 实测这个搬迁**还在途中**：两个 crate 在工作区里已有，HEAD `c0484b9a` 的 `git ls-tree crates/` 里
> **还没有**（只有 `xiranite-quickjs-executor`，也没进 `[workspace] members`），那份 ADR 文件本身还是
> untracked。所以现在把下面的枚举删掉，等于让这批事实暂时没有落处——等两个 crate 进 HEAD，
> 这四条就照 ADR 压成结论 + 链接（那一刀不属于本文档能自己完成的范围：依赖别人在途的 crate 拆分）。

- **bundle 形状**：`scripts/build-node-bundles.ts` 每节点往 `artifacts/node-bundles/` 写
  `<id>.core.js`、`<id>.platform.js`（只有存在 `platform.ts` 时），以及执行器真正链接的
  `<id>.js`（ESM，由合成 host entry 重导出 `run` 与 `createRuntime`），外加一份 `manifest.json`。
  esbuild 参数是 `--bundle --platform=node --format=esm --metafile`，每个 shim 说明符一条
  `--alias`，platform/host 两次 `--inject packages/quickjs-shims/src/index.ts`。
  **两条这一格现读补上的后端事实**（都在 `scripts/build-node-bundles.ts` 的头注释里，之前我只写了产物形状
  没写为什么长这样）：
  - **打包器是 esbuild 且走 CLI**（`runSync` 打 `node_modules/.bin/esbuild`），**不是没试过 rolldown**：
    rolldown 1.1.5（Vite 8 钉的版）与 1.2.12 都会把单文件 ESM 的 `__esmMin` helper 定义在首次顶层使用**之后**
    （`encodeb/src/platform.ts` 上 `use=217, def=521`），产物求值即 `TypeError: __esmMin is not a function`，
    `node --input-type=module` 与 `bun` 同样炸；24 份 host bundle 里 4 份中招（encodeb/logx/linku/kisaki，
    即 platform 闭包里拉了 CommonJS 依赖的那些）。已逐条排除 `strictExecutionOrder` 真假、`minify:false`、
    去掉 `codeSplitting:false`、换 1.2.12、把 zod 指到 ESM 入口（这些闭包里根本没有 zod）。rolldown 还**没有**
    `metafile`（门禁得改读 `chunk.imports`），`inject` 等价物要合成入口文件（`transform` 钩子里加的 import 会被
    tree-shake 掉）。⇒ **谁要把节点产物换成 rolldown，先解这个 helper 顺序**，别当自由选型。
  - **节点 id 与 `run`/`createRuntime` 导出名是从生成表派生的**（`packages/runtime/src/node-runner.generated.ts`），
    不手写；节点全集＝该表 ∪ 盘上每份 `packages/nodes/<id>/src/core.ts`。这条与 AGENTS 的「词表只有一份」同向，
    也解释了为什么 §2.1 的 `[backend]` 清单字段将来不能由插件作者自填导出名。
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
- **HTTP 面在 HEAD `c0484b9a` 是 14 条路径**：`GET /health` + `/node-operations` 族 8 条
  （`POST /nodes/{id}/operations`、列表/清理、详情、`events`、`stream`、`cancel`、`pause`、`resume`）
  + `/config` 族 **5 条 GET**（`/config`、`/config/path`、`/config/themes`、`/config/app/{section}`、
  `/config/nodes/{nodeId}`）。本条此前写的是「9 条，`/config*` 一条都没有」——那是 `config_routes.rs`
  落地前的实情，已按现读改准。**仍然没有的是任何写面**：`/config*` 只有 GET，所以 §2.5 那份安装记录
  还是搬不出 `localStorage`。TS 客户端声明的 `/workspace/*`、`/runtime-history`、`/local-files/*`、
  `/system/*`、`/file-deletions/*`、`/nodes/:id/runtime-info` 在 Rust 侧依旧一条都没有 →
  full 形态的第三方前端一接产品 GUI 就 404。

尚未闭合的后端事实（决定 backend-only 形态的真实成本）：

- **运行时装载后端插件这条路今天是断的**：Extism 那套 staged 目录装载
  （`<root>/<id>/{manifest.toml,<id>.wasm}`）随 ADR-0073 退役，替它的「清单驱动注册」还没落地。
  今天的表是编译期的：inventory + `register_node!`/`link_nodes!`，宿主实际那张表是
  `crates/xiranite-builtin-host/src/lib.rs` 里两条显式 static（dissolvef + kisaki，bundle 由该 crate 的
  `build.rs` 从 `artifacts/node-bundles/` stage 进来）。**backend-only 形态必须先把注册换成
  `docs/xiranite-target-node-manifest.json` 驱动**，否则第三方后端插件只能靠重新编译宿主。
- wasm 残留未删：`crates/xiranite-extism-adapter` 与 `crates/xiranite-node-runtime` 仍在根
  `[workspace]` 成员里，但没有任何 crate path-depends 于它们（即产品链路走不到），
  `xiranite-node-runtime` **今天编得过**（2026-10-05 重跑 `cargo check -p xiranite-node-runtime -j 1`：
  5.78s、`rc=0`、零 error；那条 `E0080 at capabilities.rs:508` 的编译期断言已由 `4b15ed99`
  「删掉那条前提已作废的编译期断言」移除，那个文件现在 466 行，508 那处根本不存在了），
  但 `manifest.rs` 里还留着
  `BACKEND_RUNTIME = "extism"` 那份 TOML 结构；`scripts/build-node-wasm.ts`、
  `bun run audit:plugin-manifests` 与 `plugins/*/manifest.toml` 说的都是已作废口径。**残留里有一条会
  误导下一次删除**（2026-10-05 现读）：`crates/xiranite-node-runtime/src/manifest.rs:236-238` 那段
  测试注释仍然用「`scripts/build-node-wasm.ts` 写这个名字、桌宿的 `XIRANITE_PLUGIN_DIR` 扫描读它」来
  解释 `MANIFEST_FILE` 凭什么是契约，而 `crates/xiranite-loopback-host/src/launcher.rs:11` 的模块注释
  已经写明那个环境变量「is gone rather than defaulting to something」——那条测试照跑照绿，但它声称的
  两个生产者/消费者都已不存在。删除这套时必须连注释一起改，否则下一个读者会以为目录扫描链还活着。
  删除进度以 `docs/migration/extism-retirement-checklist.md` 为准，本文不再把这套当真源。
- bundle 侧现状（2026-10-05 现读 `artifacts/node-bundles/manifest.json`，字段是
  `core/platform/host/bundleError`，**没有** 我此前写的「registered」这一列）：30 条节点记录里
  **core 全 30 成功**、platform 有内容 26 份、host bundle 24 份；失败的是 bandia/cleanf/enginev/smartzip
  四个的 **platform 阶段（不是 core）**，记的原因都是 `packages/quickjs-shims/src/czkawka-service.ts`
  缺 `getTrashCapabilities` 导出。**这条读数本身可能已经过期**：那个符号在现在的 shims 源码里已经不存在
  （`rg getTrashCapabilities packages/quickjs-shims/src crates/` 零命中），而 manifest 是 gitignored 的
  上一次构建产物、不是真源 ⇒ 要定它得重跑 `bun run build:node-bundles`，而 quickjs-shims 此刻正被
  别泳道整片改写（几十个文件 `MM`/`D`），所以现在跑出来的红绿不可归因。结论按「待重测」记，不按已证记。
- 执行器的**授权**还没接：`Executor::with_files` 在 HEAD **没有宿主调用点**（只有
  `crates/xiranite-quickjs-executor/src/bin/quickjs-run.rs` 这个 debug 入口和 `tests/` 在用），所以 `JsNode::run` 一律拿
  `MachineAccess::seam_only()`，`fs.copy`/`mkdtemp`/link 家族/字节通道/子进程表都按名字拒绝。
  插件的 `[permissions]` 声明要有真消费者，得先补这条缝。
- 协议差集门禁 `packages/tauri-migrate/src/http-surface.ts` 的 Rust 默认扫描根仍写着已消失的
  `crates/xiranite-plugins/src`，且已提交的 `artifacts/rust-http-surface.json` 是 `routes=0`
  → ADR-0067 的「协议不缩水」目前**没有证据在背书**，属必须修的门禁完整性。

**后端半按提交锚定（2026-10-05 复核，HEAD `c0484b9a`）**：凡「Rust 侧今天长这样」的句子都改成对
`git show HEAD:<path>` 现读，而不是对脏工作区现读——工作区此刻正被别的泳道重结构（`crates/xiranite-builtin-host`
整包在 staged 删除里、`xiranite-core` 正在往外搬 power/trash/clipboard、`crates/nodes/{dissolvef,linedup}`
仍在 members 里等判归零），拿它当事实源会把别人的在途状态写成我的结论。四条锚点：
① `crates/xiranite-builtin-host/src/lib.rs` 在 HEAD 仍是 `mod dissolvef; mod kisaki;` 两条编译期 static
⇒ §1.4 那句「注册是编译期的」按 HEAD 成立；② `crates/xiranite-node-runtime/src/manifest.rs` 在 HEAD 仍是
`pub const BACKEND_RUNTIME = "extism"` ⇒ §2.1/§3 那条「清单读取器还不认 quickjs」成立；
③ `crates/xiranite-api/src/lib.rs` 在 HEAD 是 **14 条路径**：操作族 9 + `/health` + `/config` 族 **5 条 GET，
没有写面** ⇒ §2.5 的 localStorage 权宜理由改成「缺写面」而不是「没有 /config」；
④ `crates/xiranite-quickjs-executor` 在 HEAD 有 `xrh-v1` 与 `globalThis.__xrh`，`Executor::with_files` 的
非宿主调用方只有 `crates/xiranite-quickjs-executor/src/bin/quickjs-run.rs` 与测试 ⇒ 「运行期恒 `seam_only()`」成立。

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
# 2026-10-05 更新：**range 比较在前端这一面已经落地**（`packages/contract/src/versionRange.ts`，被
# `src/plugins/frontendApi.ts` 用来校验下面的 `required_api`，落点见 §2.5/§5）。Rust 侧
# `NodeDescriptor.api_version` 仍按裸数字比对，那一条还没落地——别把它当成已就绪。
# 两条拼写规则不许混：**发布的版本**是裸数字 `major.minor[.patch]`（像上面的 `frontend_api = "1.0"`，
# 那是宿主/插件的自述）；**声明的范围**只认三种写法——精确 `X.Y.Z`（必须三段）、`^`、`~`。
# 把 `"1.0"` 当范围写会判 `unsupported-range` 而拒装，这是实测出来的缺口（§14），清单作者容易踩。
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
required_api = "^1.0"                       # 安装期校验已落地（§2.5）：只认 X.Y.Z / ^ / ~
# Xiranite 自加、MF 不提供（见 §6 第 4/5 条）：
source_allow_list = ["https://plugins.example.com"]

# 钉字节是「绝对 URL → SRI」的表，不是单个字符串：钩子按 URL 精确匹配（§6 第 5 条），
# 一个标量只能盖住一个文件、还说不清盖的是哪个。值由 `bun scripts/plugin-integrity.ts <url>` 生成。
# 现算注意（2026-10-06，实跑过工具）：它打的是 `url<TAB>sha384-…`——键取第一列、值取第二列；
# dev 页的 &pin= 用的是竖线（url|sha384-…），别把制表符粘过去。
[frontend.integrity]
"https://plugins.example.com/remoteEntry.js" = "sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

# `[[frontend.exposes]]` 是这个清单里的糖：一条 expose 就是一条 component 贡献。
# 两种写法都可以，但**同一个 id 不许两边都写**（解析器会拒，见 §2.1 末的「无静默掉」门禁）。
[[frontend.exposes]]
id = "foo.panel"
module = "./FooPanel"                    # → 宿主 workspace 组件（MODULE_REGISTRY / ModuleRenderer 有消费者）

# 注意：`type = "route"` 现在**没有消费者** —— 全仓没有 URL 路由
# （无 `@/router` 模块、无 hash/history 路由、入口是 createRoot(...).render(App)；
#  `audit-node-ui-independence.ts` 的 COUPLING_PREFIXES 里那个 `@/router` 是死前缀）。
# 要做 route 贡献，前提是宿主先有路由层；在那之前 route 不进贡献词表。

[backend]
runtime = "quickjs"                      # 目标值。**这份读取器今天还不认它**：`BACKEND_RUNTIME` 仍是
                                         # "extism"，非该值一律拒（见本节末）。节点逻辑实际跑在 QuickJS 上
                                         # 是靠编译期注册（§1.4），不是靠清单被读通
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
type = "component"                        # 词表只有 component | tray | window：只有被读者登记的 kind 才进得来
id = "foo.other"
module = "./FooOther"
```

> **2026-10-05 实测纠正（`4d71b252`/`86d9da2a`）**：上面这条 `module` 之前是**解析了没人消费**的字段
> ——正是 §2.1 立「无静默掉」门禁要拦的形状。`contributions.ts` 的 `FrontendContribution` 当时连 `module`
> 都没有，`dynamicEntries.resolveEntryLoader` 只取固定的 `entry` 暴露，而且 `bindModuleToFrontendPlugin`
> 只绑记录的那一个 moduleId。后果不是「少个功能」而是**列得出、打不开**：第二条贡献行进了模块库，
> 加载器却认不出它。现在 `contributedModuleSource` 带着暴露走同一条查表，`exposeOfModule` 按行取
> `./Panel`（`./` 前缀在请求名里去掉，这是 MF 的写法）。
>
> **顺带挖出的一条安全后果（真浏览器里撞出来的，不是想出来的）**：`frontendPluginForModule` 以前也只看
> 绑定的那张表，而 `ModuleRenderer` 正是用它判断「这是内置还是插件」从而决定给整台宿主还是投影。所以
> **多组件插件的第二个组件会拿到完整的 `NodeHostApi`**——绕过 §2.4 的能力天花板。同一个提交里把它并进同
> 一条查表，并留下双向证据：单元测 `a contributed id answers with its plugin…`（外加「把这条查表摘掉 ⇒
> 三个测必须红」的反空对照，实测 rc=1 且点名的正是那三条）。活体证据跑了两遍，两条安装路径都过：
> ① **query 路径**（`&contributes=example.panel|第二面板@./Panel`）下 `?module=example.panel` 渲染出
> `XR-PANEL-MARKER-7731` 且回读 `授权=contract, env`；② **分发清单路径**（`?manifestUrl=http://…/manifest.toml`，
> 也就是 `dist/manifest.toml` 里那两条 `[[frontend.exposes]]`）下 `?module=poc-frontend.panel` 同样渲染，
> 而回读是 `授权=contract` —— 这一条顺带把默认拒绝也演活了：清单不声明能力、没人批准，所以第二个组件
> 拿到的投影里除了 `contract` 一个命名空间都没有。两遍都各带一条回归：`?module=poc-frontend` 照旧渲染共享
> react 19.2.4 的第一张卡；pageerror 计数为 0。
>
> **那把尺当时也是瞎的（`49d1d80a` 补）**：`pluginManifestInstall.test.ts` 的门禁按**顶层字段**比记录，
> 而 `contributions` 被当成「容器」豁免（理由写的是「整份作为列表带上」）。所以列表到了、每一行的叶子却没了，
> 门禁照样绿。现在除了顶层比对，还逐行比叶子（`missingContributionFields`），并给它自己配了两条对照：
> ① 造一条「声明了 `module` 而记录里没有」的形状 ⇒ 必须点名 `x.panel.module`；② 非 `component` 的行不向记录
> 索取。反过来把 `pluginManifestInstall.ts` 里那行映射删掉 ⇒ 「maximal manifest」必红，实测 rc=1 且只有它红。

**`[frontend]` 这一段有两条 2026-10-05 补上的口径**：

- **`share_scope` 是真字段，不是摆设**：runtime-core 的 `RemoteInfoCommon` 带
  `shareScope?: string | string[]`，所以解析出来的值现在一路走到 `registerRemotes(…)`
  （`FrontendPluginSpec.shareScope` → 安装记录 → runtime）。此前它被解析出来之后就被丢掉——
  这正是本文档反反复复在抓的那一类：**清单里有名字、代码里没人接**（旧后端那两个死字段
  `allowed_paths`/`allowed_hosts` 是同形，`share_scope` 是我自己这一轮写漏的那个）。
- **没人读的声明段回 `notes`（数据），不再静默**：`[permissions]`（前端授权由宿主的天花板与
  将来的授权 UI 决定）、`[backend]`（归 `crates/xiranite-node-runtime/src/manifest.rs` 读），以及非
  `component` 的贡献行，都作为 `notes: string[]` 返回，并由 dev 页打在屏幕上。理由与上一条同源：
  「装了但某段没人服务」必须让人看见，而不是打在一行没人开的 console 里。

> **`command` 不在这份词表里，是故意的**：§10.1 那条规则（新 kind 必须带着读者一起来）同样适用于它——
> 今天没有任何消费者读 `command` 贡献，写进样本就等于再造一个「声明了没人服务」的字段，和旧后端那两个
> 死字段、以及我自己在 §2.1 刚修的 `share_scope` 同形。同理 `route` 也不写（全仓没有 URL 路由）。
>
> **这份样本不是插画，是被读的**：`packages/contract/src/docSample.test.ts` 把上面这个 ```toml 块抽出来，
> 交给真解析器 `parseFrontendPluginManifest` 断言它能过。改样本改到实现不接受、或实现加了必填字段而样本没跟上，
> 那条测试就红——文档与词表就此锁在一起，不再靠人对眼。

迁移是**替换不是并存**（不留 JSON 垫层）：清单格式在 2026-10-04 已一次性落到 TOML，读取器
`crates/xiranite-node-runtime/src/manifest.rs`（`toml = "1.1"`，与 `xiranite-core` 同一条版本线）、
`scripts/build-node-wasm.ts`、`scripts/audit-plugin-manifests.ts`（当时用 `Bun.TOML.parse` 读，按
ADR-0075 这条也得换成标准 TOML 库）与全部现存清单都不再认 JSON。**但那份 TOML 结构描述的是作废的
wasm 字段**，所以这次重锚不只是改文档：`[backend]` 的解析要按上面的 QuickJS 字段重写，而它所属的
不再是「连编译都不过」——那条 `E0080` 断言由 `4b15ed99` 删掉了，本轮重跑
`cargo check -p xiranite-node-runtime -j 1` 回 `rc=0`。**卡点换了性质**：`[backend]` 那份结构仍在按
Extism 校验，`BACKEND_RUNTIME = "extism"`，所以今天写 `runtime = "quickjs"` 的清单会被这条读取器**直接拒**
（错误文案 `this host only runs runtime extism`）。真源随之改成
`docs/xiranite-target-node-manifest.json` + `bun run audit:node-registry` / `audit:node-bundles`，
`bun run audit:plugin-manifests` 与 `plugins/` 一起退役（AGENTS 已定）。
`[frontend]`/`[permissions]`/`[[contributions]]` 由将来的 Plugin Manager（TS）读；Rust 侧读取器**容忍**
它们但**不校验**，因为 `[backend]` 缺失的清单本来就不该进节点表（frontend-only 形态没有后端）。
**2026-10-05 更新：`[frontend]` 的解析落地了，落点变了。** 卡点当时是依赖声明：`src/` 只许 import 根
`package.json` 声明过的工作区包，而根 `package.json` 正被别的泳道占着（`MM`），`@xiranite/config` 加不进去。
这条约定不是猜的——实测 `src/` 里 34 个 `@xiranite/*` 引用**全部**在根声明里，唯一的例外
`@xiranite/node-kisaki` 正是前面记过的那条「在盘上但没声明」缺陷。所以解析器落在**已经声明的
`@xiranite/contract`**（`packages/contract/src/pluginManifest.ts`）：清单本来就是 Xiranite 的契约文件，
`smol-toml` 又是已发布包（按 lock 里现有范围 `^1.3.0` 声明，不新拉版本），既没动根清单也不是手写的解析器。
读出来的东西由 `src/plugins/pluginManifestInstall.ts` 映射成安装记录，dev 页新增
`&manifestUrl=<…/manifest.toml>`（仍受 dev-only 门禁管——manifest 说的是「装什么」，不是「谁能装」）。
三条口径记在这：① **词汇表在 contract、政策在宿主**——`required_api` 由 contract 用同一条
`checkContractVersion` 判定，但宿主自己的版本号是调用方传进去的，CLI 不传就只记录不裁决；
② **能力与 trust 一律不从清单来**（`[permissions]` 是对后端说的，今天原样保留、无人读）；
③ **拒绝胜过忽略**：`[frontend] alias` 映射成记录的 `moduleId`，写得跟 `id` 一样的 alias 会被拒
（那等于声明一个没人用的字段），同一 id 同时从 `[[frontend.exposes]]` 与 `[[contributions]]` 贡献也被拒。
清单里 `[[contributions]]` 的分派键写 `type`、记录里写 `kind`，**这个改名只发生在`parseFrontendPluginManifest` 一处**。

**两条语义是实机定下来的（2026-10-05），别再猜**：
- **`frontend.manifest` 按清单文件自身的位置解析**。清单跟着产物一起部署（example 的构建现在把
  `manifest.toml` 当 asset 发进 `dist/`，与 `mf-manifest.json` 同级），所以里面写 `mf-manifest.json`
  而不是 `dist/mf-manifest.json`——后者是我先验写的错值，实机报
  `Failed to get manifest. #RUNTIME-003`，console 里直接把解析出的错 URL 报了出来。
  **规则：清单描述的是产物目录的布局。**
- **`alias` 是 MF runtime 里 remote 的名字（`RemoteInfo.name`、`loadRemote` 的前缀），不是 `moduleId`**。
  构建产物自己声明了名字（`mf-manifest.json` 里 `id`/`globalName = "poc_frontend"`），宿主必须照它注册才拿得到容器；
  `moduleId` 是宿主模块库里的键（默认等于插件 id，要替换内置节点时用 `&module=` 或记录显式指定）。
  这条是我先把 alias 当 moduleId 用、实机报 `Module "…" failed to load` 之后改对的。

- **清单字段不许静默掉，这条现在是机器判的（2026-10-05）**：`src/plugins/pluginManifestInstall.test.ts`
  里 `missingManifestFields()` 拿**解析产物**当字段清单（不是手抄的名单），逐个要求在安装记录里有对应值；
  结构性容器（`frontend` 本身、`[[contributions]]` 列表）按定义排除，确实没有消费者的两项
  ——`frontend_api`（宿主自己发布的那个版本才作数，这是插件的自我描述）与 `[permissions]`（授权归宿主的
  天花板与将来的授权 UI）——进**显式豁免名单并各带理由**。阳性对照：把记录里的 `shareScope` 抹成
  `undefined` 再跑同一个函数，必须点名 `["shareScope"]`。这一格也正是这么抓到 `name`/`description`
  两个从没进过记录的字段（安装面板要用它们，见 §2.5），现在它们真的被带上了，校验也按「非字符串即拒」。

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
- **已落地（2026-10-05 实测，`5ff1ee30`/`38734f28` 把「授权」补成第三层）**：`src/plugins/frontendHost.ts`
  是那份投影，`ModuleRenderer` 在把 host 交给组件之前调它（`hostForModule`，`da821e51` 之后不叫
  `projectHostForModule` 了），判定依据是「这个 moduleId 有没有被绑到某个 remote」。三层各自有实体：
  声明 = `FrontendPluginSpec.capabilities`（今天来自安装方，dev 页用 `&capabilities=`；**清单不参与**，
  见 §2.1 末「能力与 trust 一律不从清单来」）；
  **授权 = `src/plugins/frontendGrants.ts` 里那条可指认的决策记录**（批准时算一次
  声明 ∩ `GRANTABLE_FRONTEND_CAPABILITIES`，落 `{declared, granted, refused, decidedAt}`，与安装记录一样
  存在 `localStorage`）；投影 = 只带**已批准**的命名空间 + 如实的 `contract`。
  改之前那句「授权 = 声明 ∩ 天花板」是每次 render 现算的，所以落在天花板内的声明**声明即授予**——
  三层其实只有两层。现在的差别是可测的：撤销（`revokeFrontendPluginApproval`）能在**不卸载**的前提下
  收走命名空间（测里断言投影对象的 key 集回到只剩 `contract`），批准之后新增的声明进
  `unapproved` 而不是悄悄生效。**默认拒绝**照旧，且多了第二种成因：没声明拿不到，声明了但没人批准也拿不到。
  **批准的寿命是被规定的**（`pluginRegistry.ts`，测 `the approval outlives the right things and not the
  wrong ones`）：**停用保留**（开关是用户自己的，决定仍然算数）、**卸载撤销**、**更新时换了 `entry` 也撤销**。
  后两条不是洁癖：批准记录按 plugin id 存，卸载后重装（哪怕换了作者、换了来源）若不撤，等于宿主替一份自己
  没看过的代码把上次的命名空间原样发回去。反空对照实测过——摘掉那两处 `revokeFrontendPluginApproval`
  ⇒ 恰好 2 条测红（卸载、换来源），而「停用保留」那条照绿（`f960a775`）。
  **还没有对话框**：今天唯一的批准动作就是 dev 安装页那一步（它同时也在钉 pin 与 origin，本来就是人在
  说 yes 的位置）；`FrontendPluginApproval` 故意不存「谁」，没有对话却记一个批准人就是假审计轨迹。
  **2026-10-05 真浏览器实测（dev 5173，playwright chromium，逐条读 localStorage 回写）**：
  装一条带 `capabilities=state,runner` 的记录 ⇒ `records=1 grants=1`；`&lifecycle=revoke-grant`
  ⇒ `grants=0` 且记录与贡献仍在（撤销确实是不卸载的那一刀）；`&lifecycle=bogus` 被清单拒掉并打印
  「只接受 disable | enable | uninstall | revoke-grant」；`uninstall` 未知 id 与重复 uninstall 都回
  「没装过，什么都没做」而不是假装成功。**两条由实测纠正的说法**：① 停用**不**动批准
  （实测 `disable` 之后 `grants` 仍是 1——批准是宿主对这个 plugin id 的决定，撤销是独立的一刀），
  我原先写的「停用 = … + 撤批准」是错的，已改成实测形状；② 跑生命周期动词的那次加载不是安装，
  页面原来会在 `enable` 后显示「本次安装」（因为 `storedPlugin` 取的是运行期绑定，停用后为
  `undefined`），现在按动词分支显示「本次只执行生命周期动词」。
  天花板今天排除 `runner`/`clipboard`/`downloads`/`localFiles`，理由不是保守而是这三条宿主还兜不住：
  `runner` 按任意 nodeId 打后端而整个宿主只有一个 bearer token（§10.3 第 1 条没做），
  `clipboard`/`localFiles` 是 OS 面且形状已按平台漂移（§6 第 6 条）。**要放开就得先补那两条**。
  `trust: "internal"` 是 §2.4 那句「内部 trusted Node 保持现状」的落点（阶段二把仓库自己的
  `entry.ts` 当 remote 就属于这类），它返回**同一个 host 对象**，因此 §10.2 第 3 条要的实例等价语义
  没有被投影层改动。**这条不是插件能自封的**，见 §6 第 8 条。
- 前端 → 后端只走 Xiranite Plugin API（今天即 `/operations` 族 + `@xiranite/api` 客户端），
  **不允许前端直接依赖后端执行器**（QuickJS 实例、宿主服务、`NodeHost` 都不是前端能拿的东西），
  也不给第三方插件暴露 Tauri command。
- 待补：插件级作用域凭证。今天一个宿主 bearer token 打通全部路由且可落 query；第三方插件必须拿
  按 manifest 能力裁剪的派生 token，否则权限过滤形同虚设。

**投影这层现在有门了（2026-10-05）**：同一个规则此前有两份声明——宿主侧
`XiraniteFrontendHost`（真正构造出来的那个）与 SDK 侧 `PluginHostSurface`（作者被告知会收到的那个），
今天二者字面相同，但没有任何东西保证下次改其中一份时另一份跟得上。现在有了：
`src/plugins/frontendHost.surface.test.ts` 用两个方向的 `Assignability` 常量把它钉成**编译期**断言，
外加 5 条运行期判据（key **集合**相等而非「这些字段有值」：未授权命名空间必须是**缺席**，
`runner: undefined` 这种桩在真值探针下会蒙混过关；`contract.supportedCapabilities` 报的就是授权集；
投影对象 `Object.isFrozen` 且改写会抛）。跨包 import 走**相对路径**：宿主不是插件，不能因此对 SDK 产生
运行期依赖，这行只进测试文件、不进产物。
**这把尺的阳性对照实测过**：把宿主侧类型改成 `Pick<NodeHostCapabilities, "contract" | "state">`
（多要一个必给命名空间），`tsc -p tsconfig.app.json` 就在
`frontendHost.surface.test.ts(27,7)` 报 `TS2322: Type 'true' is not assignable to type 'false'`；
还原后 `git diff` 为空、该文件零错误。


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
`xiranite.frontendPlugins`）——**理由与代价都记在这**：按 HEAD `c0484b9a` 复核，`crates/xiranite-api/src/lib.rs` 共 **14 条路径**，其中 `config_routes.rs` 提供 **5 条 GET**（`/config`、`/config/path`、`/config/themes`、`/config/app/{section}`、`/config/nodes/{nodeId}`），**没有任何写面**——本句此前写的是「9 条路由里没有 `/config`」，那是 config_routes 落地前的实情，读面已经存在了，缺的只剩写面。宿主那份带锁 + 原子写的配置服务因此还没有 HTTP 面可写，而成品 WebView 除 `localStorage`
之外没有别的持久化；这与 `src/store/workspaceStore.ts` 已有的分工一致（UI 偏好留本地、业务数据给
后端），插件安装记录属前者。**`/config` 的写面一落地，这个模块的存储层就是要搬走的那一块**（读面已有；把记录放进 `/config/app/plugins` 让宿主写、页面读，等的是同一个前置条件，不是新设计），读写已经各自
收在一个函数里。
**`check API compatibility` 已落地（2026-10-05）**：记录多一个 `requiredApi` 字段（§2.1 的
`required_api`），宿主拿它和自己公布的**插件面前端 API 版本**（`src/plugins/frontendApi.ts` 的
`XIRANITE_FRONTEND_API_VERSION = "1.0.0"`；这是与 `NODE_HOST_CONTRACT_VERSION` 分开的另一个面，见 §5）
交给同一条 `checkContractVersion` 判定。判定发生在 `validateFrontendPlugin` 里，所以范围不满足、
或者宿主根本读不懂这个写法时，**在注册 remote 之前**就被拒：记录不落盘、模块不绑定、启动时也不会
被激活（已装记录在宿主升级后重新判定，问题按 issue 报出来而不是静默少一个插件）。**`update` 也落地了（2026-10-05，`updateFrontendPlugin`）**：记录多一个 §2.1 自己的
`version`（插件发布号，与 `requiredApi` 那条宿主面分离，也是「装了什么版本」的唯一可读处——不靠下载
remote 才知道）。三条规则各自挡掉一种静默改归属：id 必须已装过（否则就是 install，调用方要说清）、
`moduleId` 不许在更新里换指向、候选没写 `enabled` 时**沿用用户当前的禁用状态**（禁用是用户决定，
一个忘了重述的插件版本不该把它自己打开）。更新走 §4 那一步卸载再激活，不是覆盖一半。
**这一格顺手抓到自己层的 bug**：`registerModuleContributions` 原先只加不减，所以「新版本少声明一行贡献」
会把旧行留在模块库里、指向一个已不再声明的组件——现在登记前先摘掉该 plugin 的旧行（对照测试就是这条）。
同一类隐患一并收了：`installFrontendPlugin` 覆盖同 id 时原先只写记录再 activate，现在先 deactivate 旧记录，
否则收窄 origins、撤 pin、删贡献都会新旧并存。**清单也成了安装来源之一（2026-10-05）**：`installFrontendPluginFromManifestUrl` 取 `manifest.toml`、
按 §2.1 的词汇表解析、映射成记录再走同一条 `installFrontendPlugin`（校验、投影、贡献登记一条不少），
dev 页用 `&manifestUrl=` 走这条路。**「发现新版本」也接上了（2026-10-05，走今天唯一存在的分发来源）**：记录多一个
`manifestUrl`（清单是从哪个 URL 装的），`checkFrontendPluginUpdate(id)` 重新读那份清单、比对
`version`，dev 页 `&checkUpdate=[id]` 只看不动记录（测试断言 localStorage 逐字节不变）。两条限制写死
不粉饰：① **不比大小**——版本先后要 §5 那条还没拉的 range 依赖，所以只报 `changed`（字符串不同），
`1.10.0` vs `1.9.0` 这种事不替人决定；② **没来源就明说**：从 query 装的旧记录没有 `manifestUrl`，
返回一条 issue，**绝不拿 entry URL 去猜**（`mf-manifest.json` 是 MF runtime 自己的元数据，§2.1 明令
不得当清单读）。剩下没做的只剩 `resolve dependencies`（§2.1 词表里还没这个字段，不发明它）。

报告里除了版本差异还带 **`grantEffect`**（`de3081b6`）：清单若把装载来源移到别的 URL，`updateFrontendPlugin`
应用时会撤掉批准（§2.4 的寿命规则），所以这条后果必须在**装之前**说得出来，而不是等面板上少了一个已授权的
命名空间再回头查。判据按数据给（`entryMoved: {from, to}`），dev 页把两种各渲染一次实测过：同源换版本 ⇒
「装载来源没变，批准仍然算数」；把服务里的 `variant.toml` 改成别的 entry 再查 ⇒ 「⚠️ 应用这次更新会撤掉批准：
装载来源从 `http://127.0.0.1:4176/mf-manifest.json` 移到 `https://cdn.example.org/moved/…`」，pageerror 0。
仍然只报「不同」而不报「更新」——版本大小比较还是 §5 那条欠账，这条检查不替它背书。

**预检也接上了（`272b31c3`）**：`previewFrontendPluginManifest(text, { baseUrl })` 把 §2.5 流水线里
`validate (manifest + api compat + capabilities)` 那一步单独跑一遍、什么都不写，dev 页 `&manifestUrl=…&preview=1`
渲染成一行。它不是第二套规则：模块行走的是抽出来的 `planContributions`（`registerModuleContributions` 现在
也只是拿它的结果去落表），能力那格调的是真的 `resolveFrontendHostAccess`（读真批准记录），所以报告不可能和
安装后的事实分家——测 `installing the same text agrees with what the preview promised` 就是钉这一点的。
实测三种：好清单 ⇒ `会新增模块 [poc-frontend.entry ← ./entry, poc-frontend.panel ← ./Panel]` 且
`装完立刻能拿到 [contract]`；`required_api = "^9.0"` ⇒ 装前就打印 `拒绝安装：requiredApi …`；两者之后
`xiranite.frontendPlugins` 与批准表都读回 `null`（**什么都没写**是量出来的，不是声称的）。
这一轮也被真浏览器抓出一条自己的 bug：加了 `preview` 之后 `installing` 仍为真，于是预检那次加载撞进
「首次安装需要 plugin/entry」的终止路径，报告根本没机会渲染——单测全绿看不见，因为那条分支在页面的
模块求值里。谓词已改成同时排除生命周期动词与预检。

**预检现在两条安装路径都有，且批准改到记录被接受之后写（`ffe4901e`）**。两件事同源：报告要说的正是
「装下去会发生什么」，而在此之前 *宿主自己* 必须先做到「没装成就什么都别留」。

- 两条路径共用一个 `previewFromPlugin`：`previewFrontendPluginManifest`（清单）与
  `previewFrontendPluginRecord`（query 手装的那份记录形状）都只做「校验 ⇒ 报告」，不写任何东西。
  测 `the query path and the manifest path agree on the same content` 把两份报告逐字段比死——两份互相
  矛盾的预检比没有预检更糟。
- 顺序规则：dev 页原来是先 `declarePluginTrust` + `approveFrontendPluginCapabilities`，再做 pin 预检与
  `installFrontendPlugin`。于是**被拒的安装会留下一条没人认领的批准**（校验失败 ⇒ 记录没写、批准写了），
  而换 entry 的被拒 update 还会把 pin/来源声明留在旧记录头上。现在批准排在记录被接受之后，两条拒绝路径
  各自回滚 pin/来源声明。三种结果都量过，不是推的：坏 pin ⇒ `records=0 grants=0`；`required_api=^9.0`
  被校验拒 ⇒ `records=0 grants=0` 且页面打印「（pin/来源声明已回滚，批准记录没写）」；正常安装 ⇒
  `records=1 grants=1`（这条阳性对照是必要的——否则前两条的 0 可能只是「什么都没跑起来」。）

## 3. 三种形态与各自缺什么

| 形态 | 现在能不能跑 | 缺什么 |
| --- | --- | --- |
| frontend-only | **能**（`examples/plugins/frontend-only`，2026-10-04 真 Chrome 实测） | `[frontend]` 的解析已落地（§2.1：contract 里的 `parseFrontendPluginManifest` + `src/plugins/pluginManifestInstall.ts`，dev 页 `&manifestUrl=`）；还缺 PluginManager 的注册表读取（清单从分发来源来、写进 `/config`）与安装面板（`src/i18n/locales/*` 被占）。`AppNodeEntry.core` 已改可选（`HeadlessNodePackage.core` 仍必填），纯前端插件不再需要伪造 core |
| backend-only | **不能**（10-04 当时能，靠的是 Extism 的 staged 目录装载；那条链已作废） | 缺的是**两件**，不是一件：**清单读取器改判**（`manifest.rs` 的 `BACKEND_RUNTIME` 还是 `"extism"`，`runtime = "quickjs"` 今天会被拒）+ **运行时注册**：`NodeRequirements` 已经能表达策略，但注册仍是编译期的 inventory + `crates/xiranite-builtin-host` 里两条显式 static。要做成两件事——清单驱动注册（AGENTS/ADR-0073 已定，替掉逐节点仪式）与执行器授权接线（`Executor::with_files` 至今无生产调用方）。旧字段那批补齐项（`entry_point`、零参数导出、`host_functions`）不再需要，它们随 ADR-0073 一起作废 |
| full | **能（本轮实测）**，两档 | 最小第三方形态：`examples/plugins/dissolvef-full` 端到端跑通（plan 6 行 / 真实执行 6 success / undo 还原，全部按磁盘状态验证）。口径要写清：当时那条链是 Axum → NodeRuntime → Extism，同一节点今天的实现是 QuickJS bundle（`crates/xiranite-builtin-host/src/dissolvef.rs` 以 `JsNodeSpec::platform("runDissolvef", "createNodeDissolvefRuntime")` 注册）。内部节点形态：`examples/plugins/dissolvef-product` 把仓库自己的 `entry.ts` 当 remote，节点原界面照常渲染。缺的产品级外壳不变：`/config` 的**写面**（HEAD 实测只有 5 条 GET）、插件级受限凭证、受限 host 投影、PluginManager |

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
  **2026-10-05 实测：Rust 那一半比「还没换 range 库」更糟，它和 TS 侧没有共同语法。**
  `crates/xiranite-node-runtime/src/manifest.rs:139-148` 做的不是范围比较，而是
  `self.backend_api.split('.').next().unwrap_or_default().parse::<u8>() == PLUGIN_ABI_VERSION_MAJOR`
  ——**只取第一段、按整数相等**。后果分三层，都按这条实现现读：
  （1）`"1"`、`"1.99.7"`、`"1.0"` 一律放行（它压根不看下界，也不看 minor/patch）；
  （2）带 range 语法的 `"^1.0.0"` 因为 `parse::<u8>()` 拿到 `"^1"` 失败而**被判成版本不兼容**，诊断文案
  会说「declared major 不是这个宿主服务的」，而不是「这个写法不支持」——这正是 §5 开头要避免的那类误诊；
  （3）两侧语法的**交集只有「首段为纯数字的裸版本」**：本轮给 `frontend_api` 定的 `"^1.0"`（见 §2.1 与
  `examples/plugins/frontend-only/manifest.toml`）如果照搬进 `backend_api`，会直接被 Rust 拒。
  同文件 `:39` 的字段注释把 `backend_api` 写成 `"major.minor"`、`:163` 的测试夹具用的 `"1.0"` 在 TS 侧
  属于 `unsupported-range`，这两处就是那套裸版本语法的自述。**所以 Rust 侧要改的不只是换实现**：参照值
  `PLUGIN_ABI_VERSION_MAJOR` 本身是删除项（上面那条），把它换成宿主自己的 Plugin API 版本事实之后，
  比较规则还得从「major 相等」改成范围语义，否则 §10.3 第 3 条的「两侧一致」门禁会一直红在
  「一边接受 `^`、一边把 `^` 读成不兼容」这种谁也说不清的差集上。
  **2026-10-05 进度（TS 侧）**：那条规则已经从 `ModuleRenderer` 里搬进
  `packages/contract/src/versionRange.ts`（`@xiranite/contract` 导出
  `checkContractVersion` / `isContractVersionCompatible`），终端面要用就是同一条实现。实现的是一个
  **点名过的子集**：精确 `X.Y.Z`、`^`（1–3 段，含 npm 的 `0.x` 钉 minor 规则）、`~`（同前缀 + 下界）；
  `>=`、`1.x`、`||`、prerelease/build 一律返回 `unsupported-range`，诊断卡因此说「这个 range 语法没实现」
  而不是「你的宿主版本不对」。顺带修掉一个 under-reject：旧的 caret 分支只比 major、不看下界，
  `^1.5.0` 会放宿主 `1.0.0` 过去。**仍欠两条**：真正的 range 库（根 `package.json` 现在被别的泳道占着，
  加不了依赖声明），以及 Rust 侧对齐 + 「两侧一致」的门禁（§10.3 第 3 条）。
- **插件面（`frontend_api`）与节点契约面（`host.contract`）是两个版本号**（2026-10-05 接线）：
  `XIRANITE_FRONTEND_API_VERSION = "1.0.0"` 版本化的是「前端插件从模块外面碰到的东西」——投影后的
  `XiraniteFrontendHost` 成员、`InstalledFrontendPlugin` 记录形状、贡献 kind 词表，以及 §14 实测的
  `get("./entry")` 语义。它与 `NODE_HOST_CONTRACT_VERSION` 分开计数，因为改一个投影词汇表可以在
  `host.contract` 一字未动的情况下打断插件。落点：`required_api` → `validateFrontendPlugin`（§2.5）；
  升号条件是「成员增删 / kind 进出词表 / 记录形状变化到老 remote 会察觉」，纯 bugfix 不升号。

## 6. 安全模型（第 17 条）

1. 默认无权限：`[permissions]` 未声明即拿不到。
2. 双层强制：manifest 声明 ∩ 宿主授权。后端这条今天**有结构、没有闭环**：`NodeRequirements` 就是
   那份授权数据，但执行器的授权入口 `Executor::with_files` 没有生产调用方，实际每次运行都是
   `MachineAccess::seam_only()`（copy/mkdtemp/link/字节通道/子进程表按名字拒绝）；前端已经改成三层，
   中间那条是可指认、可撤销的批准记录而不是 render 时现算的交集（§2.4）。
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
8. **信任级不能自封**（2026-10-05 补的不变量）：投影是第三方插件的默认，`trust: "internal"` 走的是
   「不投影、拿完整 `NodeHostApi`」这条路——也就是绕开天花板拿到 `runner`。所以它只能由**宿主自己的表**
   授予：`pluginRegistry.validate` 现在要求 `moduleId` 存在于 `packageModules.generated`
   （`dynamicEntries.isBuiltInModuleId`），否则整条记录被拒并写明原因。这一步必须赶在 §2.1 的
   `[frontend]` 清单读取之前落地——否则「manifest 里写一行 `trust = "internal"` 就拿到全部宿主能力」
   会成为第一个真正的提权路径。三条断言在 `pluginRegistry.test.ts`（自封被拒 / 去掉该字段就能装 /
   内置 id 可以标 internal）；第二条是第一条的对照，证明拒的是 `trust` 而不是这条 fixture 记录本身。

   **5.1 覆盖率现在装前就能看见（2026-10-06，`34c96d95`）**：预检多报两个字段，都直接来自真正执行
   那条判断的 `resolveTrustedResource`（同源比较抽成 `isResourceOriginAllowed` 复用，绝不在预检里
   另写一份规则）：
   - `entryIsPinned` —— 钩子按 URL 精确匹配，所以只钉后续 chunk 的清单等于**第一份字节没被验过**。
   - **覆盖面本身有条硬上限，别把「枚举到」读成「钉得住」**：枚举能列出 async 分块（它们在
     `exposes[].assets.js.async` 里），但钩子只拦 runtime 自己抓的资源，**async 分块实测篡改后照样执行**
     （机制、测法与两条对照见 §14）。所以 `unpinnedArtifacts` 是下限告警而不是充分条件。
   - 正因为这条上限，覆盖数**分桶报**（`c103a9ba`）：`classifyPluginArtifacts` 给每个 URL 带
     `enforceable`（entry、container、`js.sync` 为真；`js.async` 与 **全部 CSS，含 `css.sync`，为假**——
     两者都是实测而非保守猜测：已 pin 的样式表在服务端被改掉后，浏览器应用的仍是改后字节，见 §14），
     预检因此报三种数：可校验且没钉（补 pin 有用）、
     钉了也没用（要改的是容器的 chunk 加载路径）、以及对不上任何产物的死 pin。读不到 MF 元数据时报
     **「不作答」而不是报一份**：活体探针抓到过我拿 `remoteEntry.js` 当 entry 时把结果写成「本次要抓 1 份，
     其中 1 份宿主管得到」——那是把「我不知道」渲染成「很干净」，方向正好相反。两条都在 chromium 里
     各看过一次原文（容器入口 ⇒ `没读到 MF 那份产物清单，覆盖率不作答（不作答不等于没问题）`；
     清单入口 ⇒ `本次要抓 11 份，其中 10 份宿主管得到：已钉 0、没钉 10 …；另有 1 份钉了也没用…`）。

     **三种原因后来合成了一条**（`141c6d8f` 的 `ineffectivePins`）：它们回答的是同一个问题——「钉这个有用
     吗」——分开列等于让读者自己做并集，而手工拼出来的数一定会拼错。汇总按**加载器察觉的先后**分组
     （来源被拒 > runtime 不抓 > 产物里没有），一条 pin 同时符合两种原因时只出现一次、记在先那种；
     产物层面的「钩子覆盖面之外」仍与 pin 层面分开陈述，因为那是两个不同对象（URL 有没有被抓 vs 谁去抓它）。
     判据本身现在只有一份实现：`packages/contract/src/pinCoverage.ts`（`9012dac8` 搬过去的），宿主的
     `frontendIntegrity` 只剩再导出，`resolveTrustedResource` 与预检调的是同一组函数——报告不可能和执行
     各说一套。分发方侧也接上了同一个口：`bun scripts/plugin-integrity.ts --coverage <清单> <mf-manifest.json>
     --base <部署 origin>` 直接打印「本次会抓 N 份 / 其中 runtime 亲自取回 M 份 / 没钉的（可贴的摘要）/
     钉了也没用的 / 空转 pin 及其原因」，四条输出分支都在真构建产物上各跑过一次（含「已全部覆盖」那条，
     否则它就是条死分支）。`--base` 是必填的：pin 按绝对 href 匹配，拿本地路径去比对部署 URL 会一律
     报成「没钉」，那种假干净比不报更糟。origin 连不上时不抛错，只把摘要那一列标成未取——发布前检查
     不该要求站点已经上线。
     测里除了逐条归属，还钉了一条一致性：`unreachablePins` 必须等于汇总里 `origin-not-allowed` 那一子集
     （两套说法不许漂移）。活体三种原因各命中一次：`evil.example/x.js（来源不在白名单…）`、
     `assets/lazy-note-*.js（runtime 根本不抓它…）`、`assets/gone-0000.js（本次构建的产物里没有这个 URL…）`。
   - `unreachablePins` —— pin 键的来源不在 `source_allow_list` 里时，加载它只会抛错，那条 pin 永远轮不到；
   这是分发方自己的两处声明互相矛盾，光看清单看不出来。
   两条都在 chromium 里各见过一次：本仓示例清单 `pin 0 条 · 入口未钉（只信 URL 形状）`（**这条是真话不是缺陷**
   ——示例每次重建都会换资源哈希，把 pin 写死进示例只会在下一次构建后把演示装坏，所以钉法留给分发方用
   `bun scripts/plugin-integrity.ts <url>` 现算）；另一例给 entry 上了 pin 却把来源指到别处 ⇒ 同一行里既报
   `入口已钉字节` 又把那条 pin 列为永远轮不到。

   **5.2 分母也是量出来的（2026-10-06，`cade2cbc`）**：`enumeratePluginArtifacts(entryUrl, mfManifest)`
   从 **MF 自己的元数据**里列出这次会抓哪些字节 —— `entry` 本身、`metaData.remoteEntry.{path,name}`、
   以及 `exposes[]`/`shared[]` 下 `assets.{js,css}.{sync,async}` 的每一条。这不违反 §2.1 那条禁令：
   禁令说的是「不许拿 `mf-manifest.json` 当 Xiranite 的插件清单」（身份、版本、生命周期），而「加载器
   要抓哪些 URL」正是这份文件唯一合法的职责。预检因此能报三种不同的话：`unpinnedArtifacts`（会抓但没钉
   = 裸字节）、`pinsMatchingNothing`（钉了但产物里没有 = 构建换哈希后的死 pin）、以及
   `artifactsEnumerated=false` 时的**不作答**（读不到元数据不等于干净）。
   实测：本仓示例这次加载枚举出 **10 份**产物，清单里 `pin 0 条` ⇒ 报 `10 份没钉`；只钉容器文件时 ⇒
   `1 份已钉、9 份没钉` 且 `入口未钉`（entry 是 `mf-manifest.json`，先抓的是它自己）。测的夹具是真实构建
   产物逐字拷贝（`src/plugins/__fixtures__/mf-manifest.sample.json`），不是手写样例——手写只能证明我对
   它形状的猜测。顺带纠正我自己上一轮的一次读漏：我先看顶层键没有 `assets` 就断定「元数据不列 chunk」，
   实际列表在 `exposes[].assets.js.sync` 里，差点因此把「分母算不出来」写成交付结论。

9. **授权存储的两条完整性规则**（2026-10-05 落地，`1c4433ee`；两条都是量出来的，不是推的）。
   ① **批准不能丢写**：`approveFrontendPluginCapabilities` 先读后写。它原来直接往内存表塞一条再整份
   `persist()`，于是「本次页面加载还没读过存储」时的一次批准会把早先的决定连磁盘那份一起抹掉——活体探针
   连续装两个插件，`xiranite.frontendPluginApprovals` 从应有的 2 条只剩 **1** 条；修后同一条探针得 2。
   单测要能构造这个状态，`resetFrontendPluginApprovals()` 因此改成不置 `loaded`（否则「存储里有、内存没读」
   在单测里根本重现不出来）；摘掉那句 `loadIfNeeded()` 该测必红（实测 `expected undefined to deeply equal ['state']`）。
   ② **`&type=` 与清单读取器共用同一套 fail-closed**：原来 `params.get("type") === "var" ? "var" : "module"`
   把 `type=modul`、`type=systemjs`、`type=`（空）统统读成 module 并装下去，而发布路径的解析器对这些写法是
   直接拒的——query 路径比分发路径宽松，只会让拼错在很久以后才咬人。现在一律拒并回显收到的原值（空值写作
   「（空值）」），理由与「声明了空白的 `required_api` 必须拒」同一条。实测矩阵：bogus / 空 / systemjs 三种都
   `records=0 grants=0`，module 与 var 两种各留一条阳性对照都装成。

## 7. Dev / Production 模式（第 19 条）

- Dev：`xiranite plugin dev` 把 remote 指到 `http://localhost:3000/mf-manifest.json`；backend 单指
  `artifacts/node-bundles/<id>.js` 那份 TS bundle（宿主内 QuickJS 装载，不重新编译）。开发环境允许
  Vite/Rspack dev server（**开发机**装 Node/Bun 是允许的；`bun` 只作 runner，代码不得用 Bun 专有
  API——ADR-0075）。
- Prod：WebView 里只有 JS runtime + MF runtime，节点逻辑在 Rust 宿主内的 QuickJS 里跑。运行时无
  Node/Bun/npm/pnpm 的证据链靠三条门禁：`crates/xiranite-desktop` 不引 Go/Bun、
  `audit:build-chunks` 确认打包资源里没有 `node:` import、`audit-no-bun-apis` 保证脚本与终端面不用
  Bun 专有 API。§1.3 那条真实违反点（Wails+Bun embed 链）已在 2026-10-05 删掉，不是绕过。
- **「URL 装插件 = 仅开发环境」这一条已在生产产物里实测**（2026-10-05，`vite build` → `vite preview`
  4181 + 真 chromium）：带 `?plugin=&entry=` 打开被拒、只带 `?module=<已安装 id>` 照常加载并带着
  投影后的授权渲染，`import.meta.env` 在产物里零残留。细节与那条「拒绝分支不该被 tree-shake」的
  确切含义见 §14。
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
   依赖解析/「发现新版本」要的分发来源、插件级派生 token（做完才谈得上把 `runner` 放进天花板）、
   生产 CSP 收紧（§7）。**`[frontend]` 的 TOML 解析已在这一格里完成**（contract 的
   `parseFrontendPluginManifest` + `src/plugins/pluginManifestInstall.ts` + dev 页 `&manifestUrl=`，
   fixture 就是仓库里那份 `examples/plugins/frontend-only/manifest.toml`）；同一格也完成了 §12 的
   `@xiranite/plugin-sdk`（含 `.d.ts` vendoring 与两道 ABI 门禁）。
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
   **2026-10-05 部分闭合**：第三层与第二层分开了——`contract.supportedCapabilities` 现在反映的是
   `frontendGrants.ts` 里那条批准记录的结果（`38734f28` 有测），所以「声明即授予」不再成立，撤销也第一次
   有地方落。**仍然开着的是「谁批准」的人那半边**：没有确认对话框、没有内置白名单，
   今天的批准动作由 dev 安装页替人做；把它变成真确认需要的仍然是 `src/i18n/locales` 与设置页那两处占用。

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

- **贡献行的 `module`（expose 路径）解析了没人消费，并且同一条查表的缺口让第二个组件绕过投影** —— **2026-10-05 已修**（`4d71b252` + `86d9da2a`），成因与证据写在 §2.1 的引用块里；dev 页 `&contributes=<id>[|名][@./Expose]` 现在也能表达多组件（清单那条路本来就带 `module`）。
- **`NodeComponentProps.host` 的形状比运行期给的更宽**（2026-10-05 实测提出）：contract 把 `host` 声明成
  完整 `NodeHostApi`，而 §2.4 的投影递给第三方 remote 的是 `XiraniteFrontendHost`（默认拒绝，多数命名空间
  缺席）。今天不炸只因为内部节点本来就是 trusted 全量；一旦有外部插件照这个类型写，它会得到「类型说存在、
  运行期 undefined」。本轮的处置是**在 SDK 侧另立插件面 props 类型**（`PluginComponentProps`），不去动
  contract——改 `NodeComponentProps` 会牵动 30 个内部节点的 `host.state`/`host.workspace` 用法，属于一次
  独立的、按节点逐个复核的改造，别顺手做。**遗留问题写清楚**：contract 里那条类型仍是对内口径，谁把它当
  对外承诺用就会踩。
  **2026-10-05 已闭合（`da821e51`），下面这段留作成因**：宿主侧不再用 `as unknown as NodeHostApi` 把投影伪装成完整 API。`ModuleRenderer` 现在按判别式 `hostForModule()` 返回 `{fullHost:true, host:NodeHostApi}`（内置节点与 `trust:"internal"`，对象同一）或 `{fullHost:false, host:XiraniteFrontendHost}`（第三方），JSX 据此分别以 `NodeComponentProps` 与新增的 `FrontendPluginComponentProps`（`src/plugins/frontendHost.ts`）挂载——两份契约不是一条契约的两种宽度。那条 cast 已经在掩盖一处真实错误解引用：同一函数把 `nodeHost.localFiles`（天花板之外的命名空间）递给 provider，类型说它必有、运行期对插件恒为 `undefined`。运行期行为等价，改的只是检查器知道什么；尺：`tsc -p tsconfig.app.json` 对这两个文件 0 错、全仓仍 100（=基线）。**本节下面「仍欠」的部分不变**：`NodeComponent` 返回 `unknown` 那条还开着，且第三方组件真正 import 的是 SDK 的 `PluginComponentProps`，本条只是让宿主不再自证谎言。
- **`NodeComponent` 返回 `unknown`**：同一类「对内够用、对外不够用」。宿主侧靠两处 cast 渲染
  （`ModuleRenderer.tsx:84`、`:178`），仓库外的作者写 `<entry.Component/>` 会得 `TS2786`。本轮把 react
  返回类型放进 SDK（react 走 peer），contract 是否要把 `NodeComponent` 泛型化成「返回 ReactNode」仍待决——
  那等于让 contract 沾上框架类型，与它「纯 TS 核心、框架薄适配」的分工相冲，需要单独定夺。

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
  成立：`NodeRequirements` 有结构但执行器的授权入口 `Executor::with_files` **没有宿主调用点**（2026-10-05 逐处
  数过：只有 `crates/xiranite-quickjs-executor/src/bin/quickjs-run.rs` 那个 debug 入口和 `#[cfg(test)]` 里的 `MachineAccess::granted`），
  运行期一律
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
- **一条我自己制造过的假信号，记下来免得重演**（2026-10-05）：我一度在此断言「应用的生产构建是断的」，
  依据是 `bunx vite build` 报 `Rolldown failed to resolve "@xiranite/node-trename/help"`。
  复查发现该说法不成立：`@xiranite/node-trename` 在根 `dependencies` 里、`exports["./help"]` 与
  `dist/help.js` 都在、`node --input-type=module -e "import('@xiranite/node-trename/help')"` 解析正常，
  而**重跑 `bunx vite build` 得到 rc=0（21.13s，无解析失败）**。真实原因是共享工作树里另一条泳道正在
  非原子地替换该包的 `dist/`（`vite.config.ts` 里 NeoView 那段注释警告的就是同一件事），我撞上了窗口。
  教训：在这棵树上**一次构建失败不构成结论**，先重跑再归因；跨包解析类错误优先怀疑并发构建。
  顺带量到一条仍开着的真实不一致：`packages/nodes/kisaki` 在盘上（30 个节点包之一），但根
  `package.json` 的 `@xiranite/node-*` 依赖只有 29 条，缺的正是 `@xiranite/node-kisaki`——
  修它要动那个仍被别的泳道占着的文件，所以只记不改。

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

**第一格已落地（2026-10-05）：`packages/plugin-sdk`**（`@xiranite/plugin-sdk`，走 `packages/*` 那条
workspace glob ⇒ 不需要动根 `package.json`）。里面就是上面说的那一层的一半：
- `PluginHostSurface` = `Pick<NodeHostCapabilities, "contract"> & Partial<NodeHostCapabilities>`——
  与宿主投影同一个来源（`@xiranite/contract`），**命名空间清单不在 SDK 里重抄一遍**；`contract` 恒在、
  其余按 `Partial` 可选，于是「没被授权就取 `host.runner`」在插件作者那边是**编译期**错误，不只是运行期日志。
- `PLUGIN_CONTRIBUTION_KINDS = ["component"]` 与 `ComponentContribution`，加一个 `componentContribution()`
  构造器，作用就是把 `kind` 标签交给 SDK 写：手打的 `kind: "panel"` 会被宿主校验拒绝，那类拼写只有
  「不让作者手写」才治得住。
- 两件**故意没做**：① 没有 capability 天花板（那是 `GRANTABLE_FRONTEND_CAPABILITIES` 的决定，抄进 SDK
  就是这条文档已经记过两次的「第二个读者」）；② 没有第二个 RPC client——插件能打的 operations 已经由投影
  里的命名空间经 `/operations` 族送到，而 `@xiranite/api/operationsClient` 的依赖闭包会把 Node 侧的东西
  拖进第三方浏览器 bundle，今天没有消费者，所以不做；真要做就是加一条 subpath export 并在门禁名单里登记。
- **门禁**（`packages/plugin-sdk/src/abi.test.ts`，5 条）：① 读**构建产物** `dist/index.d.ts` 的导出名集合，与显式清单
  逐一对——加一个公开名字必须改这张名单，这就是「ABI 变更要有人签字」的最小实现；② SDK 的运行期导出里
  **没有** capability 列表（防的就是把 `GRANTABLE_*` 抄一份进来）；③ **产物自足性**：声明里出现的每个
  specifier 要么不存在、要么是「本包 `dependencies` 里声明过的裸包名」，`@/…` 别名与 `../../src/…` 相对
  逃逸一律算违规。这条测的是 §12 那句「内部目录不能变成公开 API」的可机读版本，也是「在盘上但没声明」
  那一类（`@xiranite/node-kisaki` 就是这么漏出未声明依赖的）在 SDK 侧的对照。②③ 都配了阳性对照：
  拿一段含 `@/components/ui/button`、`../../src/types/host`、`@xiranite/node-kisaki/help` 的假声明去跑
  同一个 `auditAbiSpecifiers`，必须恰好报 3 条——否则「违规名单为空」可能只是这把尺瞎了。
  现测结果：`bunx tsc -p tsconfig.json` 回 `rc=0`，产物只有 `index.*`（测试文件已从 emit 排除），
  声明里唯一的外部 specifier 是 `@xiranite/contract`（已声明），5 条测试全绿。
- **消费者装不上——这一格把 §12 的真正前置条件测出来了（2026-10-05）**。我拿
  `examples/plugins/frontend-only`（它自带 lockfile、明确「不是根 workspace 的一部分」）试了两条路：
  `link:../../../packages/plugin-sdk` 回 `FileNotFound: failed linking dependency/workspace to node_modules
  for package @xiranite/plugin-sdk`；换 `file:../../../packages/plugin-sdk` 回
  `error: @xiranite/contract@workspace:* failed to resolve`。**不是路径写错**：SDK 的公开声明里
  `import type { … } from "@xiranite/contract"`，而 contract（以及它依赖的 `@xiranite/shared`）的依赖
  写成 `workspace:*` —— 只在根 workspace 内解析得开。于是 §12 承诺的「仓库外编译」**今天还不成立**，
  缺的不是包名而是**产物里不许带 workspace-only specifier**。
- **解法已落地（2026-10-05）：`.d.ts` 打包 = vendoring。** 成熟工具先试过、这台机器上用不了：本仓
  TypeScript 是 **7.0.2**，`require("typescript").sys` 为 `undefined`，`dts-bundle-generator` 就死在
  `check-diagnostics-errors.js` 读 `ts.sys.getCurrentDirectory` 那行（`@microsoft/api-extractor`、
  `rollup-plugin-dts` 同属经典编译器 API，同一堵墙）。于是 `packages/plugin-sdk/scripts/vendor-dts.mjs`
  只做一件最小的**机械**事：`tsc` 出声明之后，把 `@xiranite/*` 的 specifier 改写成 `dist/vendor/<pkg>/`
  里**同一份构建产物的副本**（递归跟到 `shared`，也跟包内相对 sibling `./versionRange.js`），认不出的形状
  **抛错而不放过**；每份副本记 sha256，门禁拿它与当前 `packages/*/dist` 现算的哈希比——契约改了没人重打包
  就变红，不靠人肉评审。
- 规则是两条而不是一条：**workspace 包必须 vendored，第三方包必须 declared**。闭包里确实有第三方——
  `shared` 的声明写着 `import { z } from "zod"`（仓里是 `^4.3.6`），所以 SDK 的 `dependencies` 里是 `zod`；
  而 `@xiranite/contract` **从这份包的 manifest 里彻底消失**：写成 `devDependencies` 也照样炸，因为 bun 会
  解析 `file:` 依赖的 devDependencies。构建期仍需要 contract，靠的是 vendor 脚本对 `packages/contract/dist`
  的硬失败 + 上面那条哈希新鲜度门禁，**不是靠一条已发布的依赖声明**。
- **消费者已接上并测过**：`examples/plugins/frontend-only` 加 `"@xiranite/plugin-sdk": "file:…"` 后
  `bun install` 成功（`+ @xiranite/plugin-sdk@../../../packages/plugin-sdk`、4 packages installed，消费者的
  `node_modules/.../dist/vendor/contract/index.d.ts` 在场），`bunx tsc --noEmit` 与 `bun run build` 都 `rc=0`；
  它拿到的声明文件里 `from "@xiranite/` 命中数 **0**。**换掉手抄当场抓到一条真漂移**：example 原先把
  `config.get/save` 抄成同步（`unknown` / `void`），真实契约是 `Promise<{config, path}>` / `Promise<void>`，
  且 `contract.name` 是字面量 `"xiranite.node-host"`——§12 反对手抄的理由就这么兑现了，`preview.tsx` 已按
  真形状改回（`pluginTypes.ts` 现在只是 `PluginHostSurface` 的别名，不再自带形状）。SDK 侧门禁 6 条全绿：
  导出名单、运行期无自带 capability 清单、产物零 workspace specifier（含四类违规的阳性对照）、vendor 哈希新鲜度。
  `@xiranite/ui` 那一半仍未动。
- **两条构建顺序的实测（写这免得下次踩）**：`dist/` 不在版本控制里，而 `bun install` 对 `file:` 依赖
  **既不跑 `prepare`**（bun 跑脚本时的 cwd 也不是包目录，脚本里 `cd ../../packages/...` 会落到仓库根
  而失败），**也不会在依赖后来才产出 `dist/` 时刷新消费者副本**。所以顺序是
  `packages/plugin-sdk: npm run build` → 消费者 `bun install` → 消费者 `bun run typecheck`；
  先装后建的症状就是 `TS2307: Cannot find module '@xiranite/plugin-sdk'`，且必须重装一次才通。
  本包自己的 `test` 脚本已经是 `npm run build && vitest run`，所以 SDK 侧自足；这条只影响消费者。
- **入口形状也进了 SDK（2026-10-05）**：`PluginNodeEntry` / `PluginComponent` / `PluginComponentProps`
  （加原有 `PluginHostSurface`），`examples/plugins/frontend-only` 的 `pluginTypes.ts` 现在**只剩
  re-export**——这个消费者不再自带任何 host 形状副本（`const entry: PluginNodeEntry = { def, Component }`）。
  两条逼出这个形状的实测：
  1. **`NodeComponentProps.host` 写的是完整 `NodeHostApi`**，而 §2.4 运行时递给 remote 的是**投影后**的
     host。内部节点用得起完整形状，第三方插件照着它写就会「编译过、运行期 `host.workspace` 是 undefined」。
     所以插件面的 props 在 SDK 里声明成投影形状，而不是继承 contract 的那个。
  2. **`NodeComponent` 返回 `unknown`**（contract 刻意不引 react，实测它的 `.d.ts` 零 react 引用）。
     宿主自己靠 cast 渲染（`ModuleRenderer.tsx:178`、`:84`），但插件作者写 `<entry.Component … />` 直接得到
     `TS2786：'Component' cannot be used as a JSX component`。SDK 因此声明 react 返回类型，并把 **react 放
     peerDependencies**（放 dependencies 就是第二种「插件自带一份 React」的坏路，§12 开篇点名的那条）。
- **门禁因此把规则改准了一条**：「已声明」= `dependencies ∪ peerDependencies`，并专门加一条测试证明
  `from "react"` 在 peer 下算已声明、`from "some-random-lib"` 算违规；导出名单也按签字机制补到 5 个公开名
  （新增 `PluginComponent`/`PluginComponentProps`/`PluginNodeEntry`）。SDK 侧 7 条全绿。

- **`@xiranite/ui` 的第一格也落地了（2026-10-05），内容是**名字**而不是值。** 理由就写在这：值住在宿主的
  主题层（`src/styles/themes/*.css`；落地当天实测 20 个文件、约 1644 条自定义属性声明，16 套内置预设出局后
  只剩 4 个文件——一份调色板、轴默认值、自定义主题桥接与 import 清单）。这个包要是把颜色抄成
  十六进制字面量，就变成了本文档已经点过两次的「第二个真源」，而且用户一换主题就是错的。所以插件拿到的
  是 `var(--name)` 引用，主题在运行期解析。
- **「哪些名字是合法的」是量出来的，不是我挑的**：`PLUGIN_COLOR_TOKENS` 只收**配色层每一个调色板都声明**的那些
  （`--background/--foreground/--card/--card-foreground/--muted/--muted-foreground/--border/--input/
  --ring/--primary/--primary-foreground/--accent/--accent-foreground/--destructive/--popover`，15 个）。
  `packages/ui/src/tokens.test.ts` 每次跑都从 CSS 现算这个集合，并且**自带三条防瞎尺**：样本量下限
  （调色板文件 ≥1 且亮/暗两个完整 token 块都在、交集名字数 >30，否则「全部命中」可能只是集合算空了）、
  逐块（亮 **和** 暗）要求 15 个名字都在、`--scrollbar-thumb` 作为**点名对象**（它住在 `src/index.css`
  的 `:root`，从来不在任何 `.theme-*` 块里 ⇒ 必须被列出）。**它的理由 2026-10-05 被真浏览器改窄过一次**：
  我原本写「插件用 `--radius` 会在 endfield 下静默拿不到值」，实测拿到的是 `0.375rem`（穿透到基础层），而
  `.theme-vite` 自己声明 `0.75rem` ⇒ 真实故障形状是**与当前主题不一致**，不是画空。
  **同一天晚些时候 16 套内置预设整批出局**（用户裁定：它们本来就是在模仿高级主题那个样子），文件语料从
  17 个调色板塌成 1 个，「交集」退化成那一份文件自己的声明集——所以 `radius` 与 `shadow` 现在**通得过**
  旧判据了。它们仍然被排除，但换了理由并写进第二个名单 `PLUGIN_TOKENS_OWNED_BY_ANOTHER_AXIS`：形状与高度
  由高级主题的 `shape` / `elevation` 维度回答（`stijl-components.css` 明确**不**改 `--radius`，配方走
  `--stijl-radius` / `--md3-shape-*`），插件读到的可能是「调色板说的角半径」而画面画的是另一套。
  ⇒ 契约的「每个主题都声明」这一半如今靠两条别的尺兜住：`tokens.test.ts` 逐块查亮/暗，
  `src/lib/appearance.test.ts` 把 `AppTheme` 表与盘上文件做双向差集（那条正是抓出
  `WorkspaceLayout`/`FloatingComponentWindow` 手抄的 `theme-endfield` 而 `endfield.css` 已不存在）。
  另一组 `PLUGIN_TOKENS_EXCLUDED_BY_MEASUREMENT`（`scrollbar-thumb/surface-1`）逐个要求「调色板层里确实没有」，
  这样将来补齐了也不会留下谎话。7 条绿，且植入一个不存在的名字会让逐块尺与点名控件同时变红（实测过）。
- **消费者与实机判据**：`examples/plugins/frontend-only`（自带 lockfile 的仓库外构建）加
  `"@xiranite/ui": "file:../../../packages/ui"`，卡片改用 `pluginColor("card")/"card-foreground"/"border"`；
  构建产物里出现的是 `var(--card)`（不是字面量），装进宿主后实测
  `getComputedStyle(插件卡片).backgroundColor = oklch(1 0 0)` **等于**宿主自己 `var(--card)` 的解析值，
  文字色 `oklch(0.12 0.01 148)` 等于 `--card-foreground`，console 零 error。⇒ 「插件不必 import 内部 UI 树
  也能跟着主题走」这条 §12 的核心主张，现在有浏览器里的数。
- **暂不进 MF `shared`，理由写在这而不是留个空开关**：这一格的内容是无状态的名字表 + 纯函数（几十字节），
  shared 单例要解决的是「两份实例互相看不见」的问题，这里没有那份状态；值本来就由宿主 CSS 解析，共享反而
  多一条协商面。等这个包长出真正无状态原语（组件层）时再进 `shared`，那时判据是宿主与 remote 各只有一份实例。

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
  `crates/xiranite-api/src/lib.rs`（HEAD `c0484b9a`：14 条路径 = 操作族 9 + `/health` + `/config` 族 5 条 GET）、`crates/xiranite-loopback-host/src/launcher.rs`
  （`XIRANITE_ALLOWED_DIRS` 仍在、`XIRANITE_PLUGIN_DIR` 已删）。
- Module Federation runtime 的 remote 形状：`node_modules/@module-federation/runtime-core/dist/type/config.d.ts`（`RemoteInfoCommon{alias, shareScope, type, entryGlobalName}`、`RemoteInfo{name, entry, …}`）——`share_scope` 该不该接就按这份类型判，不按文档措辞判。
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
  `packages/frontend-dynamic-feature-loader/src/loader.ts`（**上游 Backstage 仓内的路径**，本仓没有这个包；启动期 `Promise.all` 全量 eager，
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

**已实测（2026-10-05，生产产物 + 真 chromium）**：§7 那条「URL 装插件只在开发环境放行」在**发出去的
bundle** 里成立，而不是只在源码里成立。管路：`bunx vite build` → `dist/`（rc=0），用
`bunx vite preview --outDir dist --port 4181` 供同一份产物（**不要用 `python3 -m http.server`**：
并发取 chunk 时它会 `ERR_CONNECTION_RESET`，那是服务器的毛病不是应用的），外部 remote 仍跑在 4176。
两条判据：

| 打开的 URL | 生产产物里的表现 |
| --- | --- |
| `/src/entrypoints/plugin-host.html?plugin=poc_frontend&entry=http://127.0.0.1:4176/mf-manifest.json&type=module&trust=internal` | 页面抛 `Error: installing a frontend plugin from a URL is development-only`，画面上是那条中文拒绝文案（「生产构建不接受「用 URL 装插件」…只带 `?module=<已安装的 moduleId>` 即可」），插件不加载 |
| 先 `addInitScript` 把 `xiranite.frontendPlugins` 写成一条已安装记录（`poc_frontend`，capabilities `state,env`），再打开只带模块名的 `?module=poc_frontend` | 插件照常加载渲染：`来自已安装记录（未带 URL 参数）`、`trust=third-party granted=[contract, state, env]`、`pins: 0 pinned`、`react 19.2.4`、`host.env.theme = light`、插件自打「host 授予的能力 = contract, state, env」 |

第二条才是验收 6 的完整形状：**「不带 URL 就能装」在生产形态同样成立，而「带 URL 就能装」在生产形态
被拒**。产物层面另有两条静态证据：全量 `dist/**/*.js` 里 `import.meta.env` **零残留**（编译期已内联），
`urlInstallAllowed` 编成 `function J(e={BASE_URL:"/",DEV:!1,MODE:"production",PROD:!0,SSR:!1}){return e.DEV===!0}`。
注意这后一条的确切含义：**拒绝分支没有被 tree-shake 掉**（生产里本来就该留着喊话），成立的是
「默认参数在产物里是 `DEV:!1`，而唯一的生产调用方 `canInstallFrontendPluginFromUrl()` 恰好不传参」。
那个 env 参数只为让门禁可测（`pluginInstallPolicy.test.ts` 三条：`DEV:true` 放行、`DEV:false` 与
缺 `DEV` 键都拒绝），**禁止**出现「传参覆盖 env」的调用方——真出现时这条门禁就从「静态为假」退化成
「靠调用纪律」，届时应改成编译期常量而不是默认参数。仍未证：同一份产物在 Tauri WebView（WKWebView /
WebView2）里的表现，本轮用的是桌面 Chrome 跑 `http://127.0.0.1:4181`，不是 `<scheme>://localhost` origin。

**已实测（2026-10-05）：`required_api` 的安装期校验**。这一层的判据全在记录与注册函数上
（`src/plugins/frontendApi.test.ts` 8 条，插件目录合计 64 条绿），每条配了对照：
`^1.0` / `~1.0` / `~1.0.0` / `1.0.0` 放行；`^9.0` 判 `incompatible`，并且**证明什么都没发生**——记录没
写进 localStorage、`discoverInstalledFrontendPlugins()` 为空、`frontendPluginForModule()` 取不到绑定；
`>=1.0 <2.0`、`*`、`1.x`、`latest`、空串一律 `unsupported-range`（读不懂不等于通过，空串尤其不能读成
「没要求」）；把 `requiredApi: "^9.0"` 直接写进 localStorage 模拟宿主升级后，启动激活返回空列表并把
问题报成 `[0].requiredApi`。**顺带量到一条拼写缺口**：`"1.0"` 作为**版本**合法、作为**范围**被拒
（精确范围要求三段），已写进 §2.1 的注释而不是留给清单作者踩。
**这一层也在真浏览器里过了**（5173 宿主 + 4176 外部 remote，playwright chromium。踩点复记：探针脚本
放 `/tmp` 会 `ERR_MODULE_NOT_FOUND`——node 按**脚本位置**向上找 `node_modules`，必须放进仓库内临时目录）：
`&requiredApi=^1.0` ⇒ 记录带着 `"requiredApi":"^1.0"` 落盘，页面打
`frontend API 1.0.0 · required "^1.0" → 满足`，remote 照常渲染（react 19.2.4、`granted=[contract, state, env]`）；
`&requiredApi=^9.0` ⇒ 页面只有「插件记录未通过校验：requiredApi: …（incompatible）」，而
**localStorage 读回来是 `null`**——没写记录，也就没有注册；`&requiredApi=1.0` ⇒ 同一句拒绝，但原因写成
`unsupported-range`，与「宿主版本不对」分得开。类型口径：`tsc -p tsconfig.app.json` 里我的文件零错误
（全仓 533 条都在别的泳道）。

**已实测（2026-10-05）：`update` 这一格**，8 条断言在 `src/plugins/pluginUpdate.test.ts`（插件目录合计
72 条绿；`tsc -p tsconfig.app.json` 我的文件零错，全仓 530 条都在别的泳道）。三条是关键：
「新版本少声明一行贡献 ⇒ 旧行必须从 `contributedModules()` 消失、`getContributedModule("example.b")` 为
`undefined`」是那把尺的阳性对照（把语义改回只加不减它就红）；「被拒的更新不许顺手卸载已装的插件」——
`moduleId` 换指向与 `requiredApi: "^9.0"` 两次拒绝之后记录仍是 `1.0.0` 且 `frontendPluginForModule()`
仍取得到绑定；「没写 `enabled` 的更新保持禁用，明写才打开」。
**已经补上的一条（同一轮）**：更新里换 `entry` URL 之后 `loadRemote` **确实取到新字节**——
`src/plugins/frontendRuntime.swap.browser.test.ts` 在真 chromium 里装 `…/esm-remote-entry.js`（marker
`fixture:./entry`），`updateFrontendPlugin` 换成 `esm-remote-entry-b.js`（marker `fixture-b:./entry`）后再
load，拿到的就是 B 那份；容器侧计数同时给出「A 只在更新前被要过一次 `./entry`、B 自己 `init` 一次」。
更新路径上必然打 `The remote "…" is already registered`，那是 `registerRemotes(…, { force: true })`
在做替换的提示，不是失败信号（本条实测就是把它当噪声读过去的）。
**顺带量到一把尺的边界（要记，因为 §14 第 7 条那条测试用过它）**：同一页里
`performance.getEntriesByType("resource")` 对**确实加载过**的 A 回的是 **0 条**——browser mode 的页面在
这个测试文件跑之前已经拉了几百个 dev server 模块，资源计时缓冲区是有限的、溢出会丢最旧的条目。
所以「计时里没有」不能当「没发生」用；换源这类判据要数**容器自己的 `init`/`get`**（夹具自带计数），
也别把「这次是 0」钉成断言——那会让下一次页面少加载几个模块时无故变红。

**已实测（2026-10-05）：`[frontend]` 清单解析与安装链路**。`packages/contract` 套件 44 条绿
（`npm run test` rc=0，其中 12 条属于这份解析器：相对/绝对入口解析、runtime 名不符一律拒、
`required_api` 把 `incompatible` 与 `unsupported-range` 两种说法分开、截断的 SRI pin 被拒、
`type = "route"` 因无读者被拒、同一 id 从两种写法重复贡献被拒、坏 TOML 回一条数据而不是抛、
多个问题一次报全）。**其中一条直接拿仓库里那份 `examples/plugins/frontend-only/manifest.toml` 当夹具**——
它就这么暴露出 `required_api = "1.0"` 这条真实缺陷（清单把「版本」拼成了「范围」），已改成 `"^1.0"`，
文件头也写明现在谁在读它。应用侧 `src/plugins/pluginManifestInstall.test.ts` 9 条绿（装完记录里
`moduleId` 来自 alias、`version`/`requiredApi`/贡献都跟着清单走；alias 重复 id 被拒；`^9.0` 被拒且
记录为空；**清单绝不带来 capabilities 或 trust**；非 component 贡献只进 console.info 不进模块库），
`src/plugins` 合计 86 条全绿，`tsc -p tsconfig.app.json` 我的路径零错（全仓 158 条在别泳道）。
**这一格也补了实机（真 chromium，宿主 dev 5173 + example `vite preview` 4176）**，三条各带对照：
`?manifestUrl=http://127.0.0.1:4176/manifest.toml` ⇒ 记录落盘（`alias=poc_frontend`、`version=0.1.0`、
`requiredApi="^1.0"`、贡献 `poc-frontend.entry`），页面打「来自 manifest.toml」，插件渲染出
`POC Frontend-only Plugin react 19.2.4`；**清单没声明能力 ⇒ `granted=[contract]`，插件自打
`host.env.theme = unknown`**（默认拒绝在浏览器里可读）；console 零 error。
`required_api = "^9.0"` ⇒ 只有「manifest 未通过校验：frontend.required_api …(incompatible…)」，
**localStorage 读回 `null`**；`runtime = "systemjs"` ⇒ 同一句拒绝、原因换成 `frontend.runtime`。
两条**判据教训**：① 宿主那句 `Module "…" failed to load` 不带原因，真错在 `page.on("console")` 抓到的
`[Federation Runtime] Failed to get manifest. #RUNTIME-003`——浏览器验收要同时抓 console，
并**跑一条对照用例**（同页用老的 query 安装路径），否则分不清是我改坏了还是产物布局不对；
② 上面 §2.1 那两条语义（路径解析基准、`alias ≠ moduleId`）就是这轮实机纠正出来的，不是读文档读出来的。

**本轮验证口径（2026-10-05，SDK 入口形状那一格）**：`packages/plugin-sdk` 门禁 7 条绿（含 peer 那条新规则）、
`npm run build` 的 vendoring 输出「workspace specifiers left: 0」；消费者侧
`examples/plugins/frontend-only` 的 `bun install`／`bun run typecheck`／`bun run build` 都 `rc=0`（dist 重建于
19:45，且**按 §12 那条顺序要求**先建 SDK 再 install）；应用侧 `bunx vitest run --maxWorkers=1 src/plugins/`
72 条全绿，`tsc -p tsconfig.app.json` 我的路径零错。**没再跑真浏览器**：这一格改的是类型层与包清单，
运行期字节不变（插件的 `def`/`Component` 值一模一样），所以端到端证据沿用上一轮那条换源实测；
要挑刺的话就是「example 在 WebView 里渲染」这条仍属 §14 未实测清单第 1 项，且它现在被 `crates/` 的
在途重构挡住（桌面 crate 与 `Cargo.toml` 都 `MM`，`dev:desktop` 还会跑 registry 生成器去动别人在改的生成物）。

**已实测（2026-10-05）：投影与 SDK 声明的一致性成了编译期门禁**。运行期 5 条判据绿
（`src/plugins/frontendHost.surface.test.ts`），双向类型断言在 `tsc -p tsconfig.app.json` 下成立
（我的路径零错），并跑过注入漂移的证伪：宿主侧多要一个必给命名空间 ⇒ 门文件立刻 `TS2322`，还原后归零。
这一格同样没跑真浏览器——它只读投影函数的返回值，不引入新的跨 realm 行为。

**已实测（2026-10-05）：`@xiranite/ui` 的 token 名在浏览器里被宿主解析**。判据不是「看起来对」：同页造一个
宿主自己的 `background: var(--card)` 探针 div，读出它的 computed backgroundColor，与插件卡片
（`[data-xr-token-surface]`）的实测值比对——两边都是 `oklch(1 0 0)`，文字色两边同为 `oklch(0.12 0.01 148)`
（即 `--card-foreground`），console error 计数 0；插件包体里搜到的是 `var(--card)` 而不是字面量。
`packages/ui` 自身 5 条门禁绿（含「≥15 个配色主题」的样本量下限与 `--radius` 的阳性对照）。

**已实测（2026-10-05）：`share_scope` 接进运行时、清单里没人读的段回成数据**。
`src/plugins/pluginManifestInstall.test.ts` 新增两条：`share_scope = "xr-plugin-scope"` 必须落到记录里
（此前解析后有、记录里没有 ⇒ 死字段）；`[permissions]` + 一条 `tray` 贡献 ⇒ `notes` 恰好 2 条、
且**只有 component 那一行进模块库**。contract 侧 48 条绿（含「well-formed 清单 notes 必须为空」这条
负对照，防止「空名单」是瞎尺）。应用侧 `src/plugins` 87 条绿、`tsc -p tsconfig.app.json` 我的路径零错。

**已实测（2026-10-05）：`update` 的发现新版本那半**。`src/plugins/` 93 条绿（新增 4 条：版本不同 ⇒ `changed:true`
且**记录一字节未变**（读操作不许顺手安装）；版本相同 ⇒ `changed:false`；记录无 `manifestUrl` ⇒ 报
`manifestUrl` 一条 issue 而不是去猜 entry URL；清单读不回合法 TOML ⇒ issue 字段前缀成
`manifestUrl.manifest`）。dev 页的 `&checkUpdate=` 分支只加了一行回显，没有新的跨 realm 行为，
所以这一格同样没跑真浏览器——记录在案，不当已证。

**未拿到截图的一条（2026-10-05）**：贡献的模块在**模块库/A–Z 栏里那一行长什么样**没有实机目视证据——
浏览器连接器在那一步整个不可用（`take_snapshot`/`take_screenshot`/`list_pages` 全部超时）。已证到的是
数据与订阅两层：`contributions.test.ts` 8 条（含「撞内置 id 不出第二行」「没消费者的 kind 只记 note」）
与 `useContributedModules.test.tsx` 2 条（真渲染组件，注册→`2:example.a,example.b`→清除→`0:`，
证明消费者确实会重渲染而不是静默少一行）。目视确认留给下一次连接器可用时。

仍未实测（WebView 一侧；「生产形态」里能被浏览器证的那部分已经证完，见上一段）：

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
   新包装的命名空间对象，要数就数容器调用或网络。**覆盖边界，2026-10-05 用真浏览器改窄了一次（原来那句是我推的、偏悲观）**：
`pin` 的键是任意绝对 URL，**不只是 remoteEntry/mf-manifest**。实测把错 pin 打在 expose 自己的分块
（`assets/entry-*.js`，即 `mf-manifest.json` 里 `assets.js.sync` 列出的那份）上 ⇒ 加载被
「integrity mismatch」挡下；换成对的 pin 就正常渲染（对照组：错 pin 打在 `remoteEntry.js` 上同样挡下，
证明这条链不是「报了但没拦」）。⇒ **一个愿意列出全部产物 URL 的发行物，是可以逐字节钉住的**，
不需要把 chunk 交出去——**但这句话 2026-10-06 被我自己的实测推翻了一半，剩下的才是真的**。

**pin 的覆盖面 = MF runtime 会去抓的资源，不等于发行物的全部字节。** runtime 自己抓的（manifest、container、
`assets.js.sync` 里的预载分块）经过 `fetch` 钩子因而被校验；**容器内部用原生 `import()` 拉的
`assets.js.async` 分块绕开 runtime 的抓取路径，因而不过这道钩子**。负面测法：给示例唯一那份 async 资源
（`assets/lazy-note-*.js`，点 `src/panel.tsx` 里的按钮才加载）先钉**正确**摘要（安装期预检通过、0 报错），
宿主空闲时把服务端那份字节改掉，再开一次**不带安装参数**的加载（信任由记录重新声明、预检不跑），点按钮 ⇒
屏幕显示 `XR-LAZY-9142`、pageerror 0；而同一轮里 `sync` 那份钉错值仍然立刻 `integrity mismatch` 挡下。
两条一起把机制划清，也说明为什么「多加 pin」修不了它：要覆盖 async 分块得改容器的 chunk 加载路径，
这一步今天没做，也不许写成已覆盖。

**CSS 同样量了（2026-10-06，`8f8238ba`）：同步样式表也不经过钩子。** 示例 `panel.tsx` 顶部
`import "./theme.css"` 让一份 CSS 落进 `exposes[].assets.css.sync`——按「runtime 预载 ⇒ 受保护」的直觉它
会被算进覆盖面，里面带着能被 `getComputedStyle(el,"::after").content` 读回的标记串。实验与上面同形：
先把它的**正确摘要** pin 进记录（安装期预检通过、0 报错），再把服务端 CSS 里的标记改掉，然后开一次
**不带安装参数**的加载（信任由记录重新声明、预检不跑）⇒ 探针读到 `XR-CSS-TAMPERED`、pageerror 0；
同一条链未篡改时读到 `XR-CSS-6113`，这条对照证明读法本身有效（否则「没报错」什么都说明不了）。
所以判据不是「sync 就等于被校验」，而是「**runtime 亲自取回的 JS 才算**」；
`classifyPluginArtifacts` 因此写 `kind === "js" && mode === "sync"`，并有一条测钉住这个形状——把它放宽成
`mode === "sync"` 时 3 条测立刻红（实测 rc=1），把服务端文件还原后回到全绿。

未声明 pin 仍是透传，不等于「已验证」。