# QuickJS 作为节点基底的评估（2026-10-05）

状态：**未决策**。这是给未来 ADR-0074 的证据包，不是 ADR。结论先行，数字全部来自本仓实测或 crates.io / docs.rs 当日现查；
凡是我没能核实的，写在 §7，不当论据用。

## 0. 结论

1. 用户的判断在**逻辑那一半**上是对的，而且有数字支撑：41 个保留节点的 `core.ts` 共 17,746 行、`platform.ts` 6,158 行、
   伴随 165 个测试文件 14,518 行 TS 测试。走 QuickJS，这些一行都不用重写，而且这批测试继续是保真判据。
2. 但它只换掉「逻辑那一半」。**宿主服务那一半两条路都要写**，而且是本仓已经量过的硬活：授权根 fs（38 个节点用
   `fs/promises`）、递归枚举、外部程序白名单（31 个节点用 `child_process`，实测收敛到 9 个不可替代的二进制）、
   回收站/注册表/剪贴板/文件监视/SQLite（6 个节点）。
3. QuickJS 还白捡三件 ADR-0073 明确记为「放弃」的东西：`set_memory_limit`、`set_max_stack_size`、
   `set_interrupt_handler`（docs.rs 实测存在，见 §2）。这三条正是当初 wasm 退役时最肉痛的代价——原生 Rust 没有指令预算、
   没有超时抢占、没有内存上限，而 QuickJS **有**。这一条粘贴稿没提，是支持 QuickJS 最硬的论据。
4. 粘贴稿里三处需要纠正：LLRT 不是可依赖的库（§2.3）；`quickjs_runtime` 与 rquickjs 是二选一的竞品，不是叠 buff；
   txiki.js 是 C 应用，不解决 Rust 嵌入问题。
5. 建议路径：**先跑一天 spike（§6），判据先写死再跑**；在 spike 出数字之前不动 40 个节点的迁移队列。
   若通过，节点基底变成两种（Native | Script），dissolvef 可以留在 native 一侧当第一条腿，`core.ts` 那 17.7k 行全部转为 Script 基底。
6. 「尽量复用别人写好的兼容层」这条**按能不能碰 OS 切**（§15.2）：纯计算（EventEmitter/StringDecoder/常量表/深比较）
   该复用现成包或库自己的非 Node 入口（§15.4 实测 liquidjs/jsonpath-plus/fflate 都发布了 browser 入口）；
   碰 OS 语义（fs/child_process/os/时间/locale/网络）**一律宿主答**，引第三方实现等于绕过授权并造出第二份语义。
   `rquickjs-extra` 与 `llrt_*` 分别 pin `rquickjs >=0.10,<0.12` 与 `^0.11`，接不进我们的 0.14——它们只能当读物（§15.1）。
7. 缺口的真实形状与粘贴稿相反：44 个 core 里 **43 个已经干净**，门禁 19 条 WARN 的大头全在 `platform` bundle
   那一侧。归因到具体引入者之后（§15.6，esbuild meta 反查）：那组 `assert constants events stream worker_threads`
   **一个节点 logic 都不需要**，全部来自 `@xiranite/config` 的 `proper-lockfile` + `write-file-atomic`——
   即「带锁原子写配置」这条宿主职责被打进了每个 bundle。于是最大一块缺口从 A 档（补 shim）改判成 C 档（下沉宿主），
   §15.3 那 1,064 行手写 shim 的大半也失去消费者。
   留给用户拍板的两件事：**(a) `@xiranite/config` 的读写是否下沉宿主**；**(b) B 档的条件钉死**——
   Bun 源码跑按 `node` 条件、bundle 按 `browser` 条件，两侧不同入口会破「一份实现」。
8. 目标的另一半 **tauri3 还没落地也无法验证**（§16）：本仓锁的是 `tauri 2.12.1`，上游 stable 仍是 2.12.1、
   `3.0.0-alpha.4` 是 4 天前的 alpha；而 `cargo check -p xiranite-desktop` **REAL_RC=101**，挡路的不是 tauri 而是
   `crates/xiranite-node-runtime/src/capabilities.rs:508` 的 E0080（判据已被 ADR-0073 作废，文件属别的 lane）。
   好消息是接触面实测极小：Rust 侧 3 个调用点、TS 侧 1 个全局名 `window.__TAURI__.core.invoke`，
   且读 `tauri-utils@3.0.0-alpha.3` 源码确认 camelCase 配置键与 `withGlobalTauri` 注入在 v3 都还在。
   所以「升 v3」的代码成本接近零，代价是**接受 alpha**——那是产品决定，等用户定。

## 1. 粘贴稿里对、但没给出出处的东西

- 「没有一个 QuickJS + Rust 完整补齐 Node API 的成熟项目」——**成立**（§2）。
- 「你的节点不是 npm install xxx，是 image.convert()/file.organize()」——**部分成立**：npm 面确实很薄（§3.3：全仓节点只用 6 个第三方包），
  但 `child_process` 用了 31 个节点，说明「文件整理」类节点大量靠外部二进制干活（ffmpeg/7z/ffprobe/Bandizip），
  这不是「不碰系统」的纯逻辑。
- 「补 ~20 个领域 API，比 Rust 重写小几个数量级」——**前半句基本对，后半句要打折**：减少的是逻辑移植量，
  宿主服务与门禁量不变（§4 有分解）。

## 2. 引擎与生态现状（2026-10-05 crates.io / docs.rs 现查）

### 2.1 rquickjs — 唯一推荐候选

- `rquickjs` **0.14.0**，updated **2026-09-18**，downloads 4,836,276，repo `github.com/DelSkayn/rquickjs`。
- feature 列表包含 `loader`、`full-async`、`futures`、`parallel`、`bindgen`、`dump-*`（调试）、`allocator`、`rust-alloc`。
- `struct Runtime` 的方法里实测存在（docs.rs HTML 现查）：`set_interrupt_handler`、`set_memory_limit`、`set_max_stack_size`。
  语义分别是：中断回调（返回 true 打断当前执行，抛不可捕获错误）、JS 堆上限、栈上限。
- **平台表（上游 README 现读，`## Supported platforms`）**：`x86_64-apple-darwin` 预生成绑定 ✅ 已测 ✅；
  `aarch64-apple-darwin` 预生成绑定 ✅ **未测**；`x86_64-pc-windows-msvc` 预生成绑定 ✅ 已测 ✅ 但 **quickjs 支持度标为 ❌ experimental**；
  `aarch64-pc-windows-msvc` 同样 experimental。**发布门禁那台（Windows MSVC x64）恰好是上游自称 experimental 的组合**，
  这是本方案的头号风险，不是靠读文档能排除的那类问题。反向证据见 §2bis：Rossi 在 Windows 上已经实际发货。
- **`bindgen` 是可选 feature，默认不开**（0.14 的 40 个 flag 里 `default = std`；上游 README 明说预生成绑定覆盖不到的平台才需要它）。
  开着它才引入 libclang/LLVM 并可能挑错 host 的 libclang——Rossi 的踩坑正是显式开了 `bindgen` 之后发生的（§2bis）。
  不开 `bindgen` 时仍要 C 工具链（要编 QuickJS 那一个 C 库），但不需要 LLVM。
- 与 ADR-0073 的关系：wasm 退役时记下的三条代价（无指令预算 / 无超时抢占 / 无内存上限）在这里都有对应物。
  中断回调 ≈ fuel 的「跑得动就继续」语义，且可以只读 `AtomicBool`，与宿主现有的取消标志天然对接。

### 2.1bis 姊妹项目 Rossi 的现成证据（实读 `../rossi`，2026-10-05）

- 用的就是 **`rquickjs` 0.12.0**，features `["bindgen", "futures", "parallel", "loader", "macro"]`
  （`rossi/rust/rquickjs_playground/Cargo.toml:11`）。**不是 spike，是发货件**：Flutter-Rust-Bridge 的
  `rust/src/api/{qjs,local,file_ops,image,system,webdav,logger,data_backup,file_manager}.rs` 全都依赖它。
- workspace 级 `[patch.crates-io]` 只替换了 `rquickjs-sys` → git fork
  `deretame/rquickjs` 分支 `fix/android-windows-bindgen`（`rossi/rust/Cargo.toml:201-211`，lock 锁到 `0575b50c`）。
  注释写明原因：0.12.0 在 **Windows 交叉编译 Android** 时，host 构建会错误使用 Android NDK 的 libclang 生成绑定，
  导致 `JSValue` 类型不匹配（上游 issue DelSkayn/rquickjs#709）。`rquickjs`/`-core`/`-macro` 仍在 crates.io 0.12.0。
  对 Xiranite 的读法：这条坑的前提是**显式开了 `bindgen`**；不开的话走预生成绑定，但 Windows 上的实测仍是 §6.3 判据 6。
- 形态：`AsyncRuntime` + `AsyncContext`（`src/host_runtime.rs:2/235/441`），宿主层 2,295 行 + web 层 1,378 行 +
  一层 JS polyfill（`js/*.js`：bootstrap / polyfills / structured_clone / URL / Intl / Headers / Abort / **fetch** /
  **fs** / native / bridge / **stack hook** / console / Temporal），`fetch` 由 reqwest（rustls + system-proxy + socks）供。
- 质量证据：WPT `fetch/` 可离线子集 37 个文件 629 条断言，**541 通过 = 86.0%**（同条件 Node v24.18 为 41.8%，
  2026-07-13，`docs/WPT_FETCH_REPORT.md`）。这是「rquickjs 能把 Node/Web 面补到什么程度」目前最硬的旁证。
- 他们**没有**用 `set_interrupt_handler` / `set_memory_limit`（`src/` 零命中；深递归是用 JS 侧 `63_stack_hook.js` 兜的）。
  所以 Xiranite 最想要的那三条引擎原语在 Rossi 里没有现成样例，要自己接——但 API 存在（§2.1）。
- 他们同时在评估换 `boa_engine`，理由**纯是构建工效**（LLVM/Clang/bindgen 摩擦），并明确「这不是换依赖，
  是运行后端重写」（`BOA_MIGRATION_ASSESSMENT.md`）。Xiranite 的读法：避开 `bindgen` 就能避开他们把坑踩响的那条路；
  真出问题的备选才是 boa（纯 Rust 引擎，代价是 WPT 级兼容面要重做）。
- 可直接复用：host function 注册与 promise pumping 的模式、`js/` polyfill 层、WPT 的跑法与数字、
  以及池化并发样例（`examples/concurrent_100_file_ops.rs`、`tokio_plugin_pool.rs`、`http_plugin_pool.rs`）。

### 2.1ter `boa_engine` 是什么，Rossi 为什么提到它

- 它是 **Boa**（`github.com/boa-dev/boa`）的引擎 crate：**纯 Rust 写的 JS 词法/语法分析与解释器**，
  上游 README 第 20 行自称 "experimental … more than 90% of the latest ECMAScript specification"。
  crates.io 现查：`boa_engine` **0.22.0**（2026-08-28），累计下载 5,217,103 / 近 90 天 1,620,455——量级与 rquickjs 相当。
- 它出现在 **`../rossi/rust/rquickjs_playground/BOA_MIGRATION_ASSESSMENT.md`**（382 行，Rossi 自己的迁移评估），
  动机**只有一条：构建工效**（`:30-38`）——rquickjs 要编一个 C 库、`bindgen` 路径还要 LLVM/Clang，
  首次构建与 CI 环境变重，对 Flutter+Rust 混合项目直接变成贡献者体验与跨平台可靠性问题。
- 该文档自己的结论（`Current Recommendation`）：**这不是换依赖，是运行后端重写**；只有当团队接受「主收益是构建与维护工效」
  且按阶段验证时才值得做。理由是他们 2,295+1,378 行的宿主层与 rquickjs 深耦合：
  `Runtime`/`Context` 所有权、`ctx.globals().set(..)`、`Func::from`、显式 `is_job_pending()`/`execute_pending_job()` 泵任务（`:76-95`）。
- 他们的路线是五阶段（`:240-330`）：先抽引擎适配层 → 最小 Boa 后端 → **用真实插件 bundle 验证**（失败就停，不继续搬）→
  按 timers → fetch → 原生二进制桥 → fs → wasi 的顺序补宿主能力 → 期间用 feature flag 双后端共存以便回退。
  成功判据第一条就是「contributor setup 与 CI 明显更简单」，性能只要求 "acceptable"，不要求更好。
- **对 Xiranite 的读法**：boa 是 rquickjs 在 Windows 门禁上翻车时的逃生口，但代价比 Rossi 小也小不完——
  Xiranite 需要的 polyfill 面窄得多（41 个节点里只有 1 个要 fetch；主要是 fs/path/child_process），
  可风险转移到**打包进来的 npm 包对 Web API 的依赖**上：例如 `@zip.js/zip.js` 用 `CompressionStream`、
  `p-queue`/`write-file-atomic` 对 microtask 时序敏感——这些在 Boa 上是否可用/等价，属于「真要换才去量」的清单。
  另外 boa 同样是上游标 experimental 的引擎，且没有 JIT，性能只会比 QuickJS 更退一档。

### 2.2 quickjs_runtime — 另一套嵌入，不是补件

- `quickjs_runtime` **0.18.0**，updated 2026-09-22，downloads 76,298，repo `github.com/HiRoFa/quickjs_es_runtime`。
- 它自称提供 console/timer/fetch/模块加载/TS 预处理。与 rquickjs **功能重叠**，选一个即可；粘贴稿把它列为「runtime 设施补充」
  是误解。它的优势是开箱设施多，劣势是社区远小于 rquickjs（76k vs 4.8M 下载）且自带一套「es runtime」约定。

### 2.3 AWS LLRT — 只能当参考，不能当依赖

crates.io 现查（`?q=llrt`）：`llrt` 0.8.1-beta（dl 18）、`llrt_modules` 0.8.1-beta（dl 255）、`llrt_context` 0.8.1-beta（dl 1071）、
`llrt_buffer`（dl 1004）……全部是 **beta + 几百到几千下载**。这不是能写进产品依赖表的对象。
它的价值在**实现参考**：`llrt_modules` 的 fs/编码/压缩/进程模块是 OpenJS 兼容面的一套成熟取舍，可以拿来抄 API 形状。

### 2.4 txiki.js

C 项目（QuickJS-NG + libuv + curl），是一个**独立 runtime 二进制**。对 Rust 嵌入没有帮助，且会重新引入「发布要带一个 runtime」的问题。

## 3. 本仓自己的账（AST 清单 + 实测）

### 3.1 规模

| 项 | 行数 |
| --- | --- |
| `packages/nodes/*/src/core.ts`（业务逻辑） | 17,746 |
| `packages/nodes/*/src/platform.ts`（Node API 面） | 6,158 |
| `packages/nodes/*/src/cli.ts` | 15,717 |
| `packages/nodes/*/src/help.ts`（不得漂移的字典） | 4,568 |
| 节点测试（165 个 `*.test.ts`） | 14,518 |

### 3.2 `platform.ts` 实际用到的 `node:` 内建（按使用节点数）

`fs/promises` 38、`path` 36、`child_process` 31、`fs` 10、`util` 4、`os` 4、`crypto` 3、`url` 1。

**就这 8 个。** 粘贴稿猜的 fs/path/events/stream/worker/child_process 里，events/stream/worker 一个都没用上；
真正的大头是 `child_process`（31 个节点）——那本来就要变成宿主白名单，与引擎无关。

### 3.3 npm 面（`platform.ts`/`cli.ts` 里的第三方包）

只有 6 个：`chardet`、`iconv-lite`、`@zip.js/zip.js`（`index-native.js`）、`p-queue`、`write-file-atomic`、
`@stable-canvas/comfyui-client`。前 5 个是纯 JS 可打包，最后一个要网（comfygure 是全仓唯一的 network 节点）。

### 3.4 「进程内重活」只有 6 个节点

AST 清单的 `heavyCodecOrImage` 有 13 个节点，但逐条读证据后，大多数本来就是外部进程代理（ffmpeg/7z/ffprobe/Bandizip）。
真正在 JS 进程里做重活的：`classf`（opencc-js 繁简转换）、`encodeb`（chardet + iconv-lite 转码）、`marku`（remark AST + diff，
30+ 变换）、`coveru`（zip.js 解压条目）、`smartzip`（32 MiB 尾部的码页嗅探）、`soundw`（gb18030 解码 + 表格解析）。
**解释器性能风险只落在这 6 个上**，其中 4 个还是 IO 主导，真正的 CPU 热点是 `classf`/`encodeb`/`marku`。

### 3.5 与引擎无关、两条路都要写的宿主服务

- 回收站 ×5（bandia/cleanf/enginev/recycleu/smartzip）、剪贴板（classf）、注册表 ×2（jellypot/owithu）、
  文件监视 + 常驻 SQLite（findz）、shell 集成（owithu）。
- findz 仍是唯一的 blocker：它的实现是一个 Go 库 + 常驻 SQLite + watcher（`native/findz-go`），**换引擎不解决它**。

## 4. 两条路的成本分解

| 工作项 | Rust 重写（当前 ADR-0073 路线） | QuickJS 基底 | 备注 |
| --- | --- | --- | --- |
| 17,746 行 core.ts 逻辑 | 逐节点重写 + 测试（dissolvef 实测 3.6k TS → ~4.5k Rust + 108 测试，约 1:1+测试） | **0** | 这是 QuickJS 省下的部分 |
| platform.ts 6,158 行 | 换成宿主调用（每节点桥接） | 换成 host function shim（一次） | 两路都要 |
| 8 个 `node:` 内建 | 部分已有（FileCapability、join_paths/path_within） | 同左 + 一层 JS 绑定 | 两路都要 |
| child_process 白名单 | 已有 `NodeRequirements.processes` 模型，需补执行器 | 同左 | 两路都要 |
| OS 原生服务（回收站等） | 逐条写宿主服务 | 同左 | 两路都要 |
| 打包管线 | 无 | **新增**：esbuild 别名 `node:`→shim、单文件 bundle、嵌入 | QuickJS 独有成本 |
| 引擎嵌入 | 无 | **新增**：rquickjs + interrupt/memory 接线 + 每节点脚本注册 | QuickJS 独有成本 |
| 编译期保证 | 有（类型 + 借用检查） | 无（靠 14.5k 行测试） | 风险侧 |
| 运行期原语 | 无指令预算/抢占/内存上限 | **有**（§2.1） | 质量侧，QuickJS 赢 |

结论：QuickJS 把「逻辑移植」这一半清零，代价是新增一条打包+嵌入管线并放弃编译期保证；
宿主服务、门禁、协议那部分**完全不变**。所以「小几个数量级」对逻辑成立，对总工作量大约减半。

## 5. 与已完成工作的关系

- **不受影响**：Tauri/Axum/`/operations` 协议、`xiranite-core` 的 fs/时钟/操作管理、`xiranite-node-registry` 的
  策略模型（`NodeRequirements`/`DangerGate`/预算）、`crates/xiranite-native-host`（fs+时钟+事件的宿主绑定）、
  全部门禁（`audit:node-registry`、`audit:target-node-manifest`、AST 清单）。
- **要改**：`BuiltInNode` 从一个 Rust trait 扩成「节点产物」枚举（`Native | Script`）；`register_node!` 的注册项里
  多一种载荷；dissolvef 保留在 native 一侧（已跑通，不推倒）。
- **不受影响的既有决策**：ADR-0073 的 wasm 退役结论（QuickJS 不是 wasm，也不是 Extism）；ADR-0067 的 AST 事实源；
  ADR-0069 的四面结构与 TUI=ratatui（§6.3）。
- 若决策走 QuickJS，需要 ADR-0074 明确「两种节点基底」并逐条标注它取代 ADR-0073 的哪一条（当前 0073 写的是「节点的唯一业务实现是原生 Rust」）。

## 6. 建议：一天 spike，判据先写死

### 6.1 选样

- `linedup` 或 `cleanf`（fs 型、纯逻辑、已有测试多）；
- `encodeb` 或 `marku`（进程内计算型，性能风险样本）。

### 6.2 步骤

1. esbuild 打包节点（别名 `node:fs/promises`/`node:path`/`node:child_process` → 一个 shim 模块，shim 调 `NativeNodeHost`
   已有的 fs/时钟能力；`child_process` 走白名单执行器）。
2. rquickjs 0.14 探针：嵌入脚本，注册 shim；取消标志用 `AtomicBool` 接 `set_interrupt_handler`；
   另外验证 `set_memory_limit` 触发时的可观测失败。
3. 用该节点**现有的 TS 测试输入**跑一遍（不改测试）。

### 6.3 判据（先写死，不许事后调）

1. 该节点现有 TS 测试**不改一行**全绿（允许换断言载体，不允许改断言内容）；
2. 计算型节点的耗时 ≤ 3× 于 bun 直跑（同一台机、同负载串行测，秒数带负载标签）；
3. 新增机制代码行数 ≤ 该节点 Rust 移植的代码行数（否则「省下来的」是假的）；
4. esbuild metafile 里**未映射的 `node:` builtin = 0**（做成门禁，防某个包偷偷 import 没 shim 的内建）；
5. 死循环脚本能被 interrupt 打断，且打断延迟可测（记 μs/ms 数字）；
6. Windows 上 rquickjs 能编、能跑（发布门禁是 Windows，这条不过就整个方案不作数）。

### 6.4 明确不做

- 不引入 `llrt*` 当依赖（§2.3）；
- 不双栈并行：一个节点只能有一个基底，不许「先 QuickJS 之后再说」；
- 不为 QuickJS 放弃 ratatui（TUI 与节点基底无关，见下）；
- 不在 spike 出数字前动另外 39 个节点的迁移队列。

## 6bis. TUI / CLI / GUI 的边界（回应「TUI 依赖 Node 要另想办法」）

- **GUI**：React 跑在 Tauri webview 里，本来就不需要 Node/QuickJS，不受任何影响。
- **TUI**：今天的 TUI 是 `packages/cli-runtime/src/tui/opentui/app.tsx`（OpenTUI = 原生渲染器的 Node 绑定）。
  QuickJS **跑不了它**（没有 Node 原生扩展加载机制），所以「用 QuickJS 救 OpenTUI」不成立；
  ADR-0069 定的 ratatui 仍是唯一解。这条与节点基底无关，是独立问题。
- **CLI**：`clap + cliclack` 是 Rust；节点 core 走 QuickJS 时，CLI 只是「宿主进程内调脚本」，
  命令与提示外观不用改（AGENTS.md 里 Clack 1:1 复刻的约束不变）。

## 7. 我没能核实的（不许当论据）

1. rquickjs 在 Xiranite 的 Windows(MSVC x64) 上编译与运行——**已降级为「待确认」而不是否决点**：上游平台表把这一组合标为
   experimental，但姊妹项目 Rossi 就在那台机上编译并发货（带 `bindgen` + `rquickjs-sys` fork），引擎家族在 Windows 上不成问题。
   剩下要问的只是：本 probe **不开 bindgen**（预生成绑定）能不能过；不能就照 Rossi 开 bindgen（代价是构建机要有 LLVM），
   两种结果都不改变设计。
2. `set_memory_limit` 是否覆盖 ArrayBuffer/typed array 的堆外分配（QuickJS 的 js_malloc 是否接住全部）。
3. `set_interrupt_handler` 的实际调用频率（多密才被调一次）与在长时间 host call 期间的行为。
4. QuickJS bytecode 预编译对启动时间的收益，以及跨引擎版本的兼容性代价。
5. `write-file-atomic`/`p-queue`/`@stable-canvas/comfyui-client` 在 shim 下的真实可用性（要打包后实跑）。
6. 解释器 vs bun JIT 在 classf/encodeb/marku 三个真实热点上的倍数（§6.3 判据 2 就是为它准备的）。

## 8. 用户提的终局架构：逐条对照本仓约束（2026-10-05 讨论记录）

提法：「Rust 做平台，JS 做扩展层，Node 只做开发工具入口」；四层 = Rust Core（workflow/registry/scheduler/task/storage/config/
plugin loading/IPC/权限）+ QuickJS 运行层（TS 节点）+ CLI/TUI 继续 Node/Bun+Clack + GUI = Tauri+Rust+QuickJS。
方向成立，**两处必须改，三条边界要现在定**。

### 8.1 澄清后的第 1 条（我原先的「必修一」撤回一半）

我把它读成了「CLI 里跑 TS 节点逻辑」；用户澄清：**Node/Bun 只负责把命令行/TUI 框架跑起来**（Clack、OpenTUI 的壳），
节点逻辑仍然经过 Rust 里的 QuickJS 执行。这样就没有「双引擎跑同一份逻辑」的问题，我那条反对意见不成立。
剩下的只是一个要说清的产品成本：**CLI/TUI 的用户需要装 Node，GUI 用户不需要**——这是可接受的产品决策，
但必须在 ADR 里写成「接受的代价」，并守住两条：① 节点逻辑的执行引擎只有一个（Rust+QuickJS），
Node 壳不许自己算逻辑；② 壳里出现的 `Intl`/`Date`/`Math.random` 只许用于**展示**，凡影响结果的都必须走宿主 API（§8.3.1）。

### 8.2 必须改 2：Core 清单要补 operation 生命周期与协议适配

真正被三个入口共享、且**已经在 Rust 里**的是：`OperationManager`/`OperationControl`（checkpoint/pause/cancel）、
`NodeRunEventRecord` 事件流、撤销日志（现在是 dissolvef 的 `history.rs`，应上收到宿主服务）、以及 `/operations` 的
HTTP 适配（Axum 薄层，GUI 用）。用户清单里的 workflow engine 若指 `enginev`，那**它是一个节点，不该升进 Core**。
边界原则：Core 暴露一套 Rust API；HTTP 是薄适配，CLI 进程内直调——不要再给同一个核加 NAPI-RS 这第二条跨语言边界。

### 8.3 三条要现在定的边界

1. **locale 归宿主**：实测（`/usr/bin/grep` 扫 `packages/nodes/*/src/*.ts`）`localeCompare` 52 处、`toLocaleLowerCase` 59 处、
   `toLocaleUpperCase` 1 处，分布在 **23 个节点**（kisaki 8 文件、comfygure 7、classf 3 最多；含已原生化的 dissolvef——
   它的 Rust 侧已有 `similarity.rs` 的 locale-aware 比较，说明这条本来就该归宿主），而 `Intl.*` 是 **0 处**。
   QuickJS 默认不带 Intl，`localeCompare` 会退化成码位比较 ⇒ 宿主必须自己提供该函数（Rossi 也是这么做的，他们补了一层
   Intl 时间子集），否则排序/改名类节点在 CLI 与 GUI 间会出现不一致，且今天 Node 上「默认 locale」本来就随机器变。
   **并且只有一份实现**：用户草图的「Node CLI → 走 Node 的 Intl」那一支必须去掉——CLI 的展示壳也一样要调宿主 API，
   否则两个 host 各自尽力就又出 `["a","ä","b"]` / `["a","b","ä"]` 的分叉；这条也是「宿主吸收引擎差异」的样板。
2. **第三方插件隔离**：内置节点同进程 QuickJS 可以；第三方/不可信插件以后才用 wasm 或进程隔离。现在就写进 ADR 的「明确不做」，
   按 ADR-0073 的规矩：不为理论兼容堆抽象，等真有第三方需求再实现。
3. **一个 Core，一个协议面**：CLI/TUI/GUI 的差别只许发生在入口与展示层；任何「CLI 特有的执行语义」都是 bug 温床。
4. **Core 不知道 JS 存在**（用户提的第四条，正确——而且**本仓已经落地**）：`crates/xiranite-node-registry` 的
   `NodeDescriptor`（策略）与 `BuiltInNode`（行为）就是这条边界的实现，dissolvef 是第一个实现者，QuickJS 只是接在同一个
   trait 后面的第三个 adapter。禁止出现 `struct Node { js_code: String }` 这类让 Core 被脚本绑定的形状。

### 8.4 流程要求

已按这份收敛写成 **`docs/adr/0074-keep-runtime-boundaries-with-quickjs-as-one-node-executor.md`**（状态 **proposed**，
未生效——Windows spike 是唯一否决点）。它逐条标注了取代 ADR-0063 / 0069 / 0073 的哪些句子，并明确**不**激活 Extism/wasm
给内置节点。AGENTS.md 的同步发生在该 ADR 被接受之时，不是现在——在那之前旧规则仍然有效。

## 9. 上游复用策略与 Windows spike 的落地方式（2026-10-05）

### 9.1 先纠正一个前提：Rossi 是 Breeze 的 fork，QuickJS 运行时是 Breeze 上游的

实查 `../rossi`：`origin = github.com/HibernalGlow/rossi`，`upstream = github.com/deretame/Breeze`。
`rust/rquickjs_playground` **不是 Rossi 新加的**——`upstream/main` 上有 9 个提交动过它，最近一次 2026-09-04
（deretame「新增漫画详情预览并整理插件协议模型」）；Rossi 只是在其上叠了 fork 自己的提交
（本地 clone 计数：fork 领先 418、上游领先 6，计数前未 fetch）。
所以「拿上游能力」和「跟上游更新」的对象是 **Breeze**，不是 Rossi。

### 9.2 结论：不为 Xiranite fork Breeze

1. fork 的用途是「你要改它」；我们要的是「用它的能力 + 跟上它的更新」，fork 对这两件事都是负作用，
   而且你已经在维护一个 fork（Rossi），再加一个只会把同步成本乘以二。
2. 形状不同：Breeze 的 playground 是给**漫画插件**用的（fetch/Headers/cheerio/图片桥/HTTP 拦截/i18n），
   Xiranite 要的是 fs/path/child_process + operation 的 pause/cancel/事件。整包拿来要么删一半，要么白背
   axum/reqwest/fluent/scraper 一整棵依赖。
3. 许可：Breeze 是 **MPL-2.0**（文件级 copyleft），Xiranite 各 crate 是 MIT。混编没问题，但**照抄的文件必须继续标 MPL**
   并在文件头保留出处——所以「抄」只限少量确有过坑的机制（promise pumping、事件驱动调度、stack hook、CBOR 数据通路），
   其余自己写。
4. 真要走依赖形态，正确的是 **git 依赖 + `rev` 钉死**（不是 fork、不是跟 branch），升级 = 改 rev + 跑门禁。
   一个坑：**cargo 的 `[patch]` 不传递**——Breeze 是在**它自己的 workspace 根**把 `rquickjs-sys` patch 到
   `deretame/rquickjs` 的 fork 上的；Xiranite 若以 git 依赖引入且开了 `bindgen`，必须在**自己的根 `Cargo.toml`**
   重复这条 patch，否则会拿到发布版的 `rquickjs-sys`。
   （AGENTS.md 现在禁止 git 依赖，这一条要你单独授权；即便授权，也只进 spike crate。）

### 9.3 Windows spike 怎么跑

- **形态**：Xiranite 仓内新建一个**不被根 workspace 收编**的独立 crate（像 `plugins/*` 那样自建 `[workspace]` 并进 `exclude`），
  例如 `spikes/quickjs-probe/`，只依赖 crates.io 的 `rquickjs = "0.14"`，**先不开 `bindgen`**——那正是要验的：
  预生成绑定在 Windows MSVC x64 上能否编过（上游表：shipped ✅ / tested ✅ / quickjs 支持度 ❌ experimental）。
- **只带一个真节点**：fs 型取 `linedup`（或 `cleanf`），计算型取 `encodeb`。JS 侧**在 Mac 上用 esbuild/bun 打包**成
  自包含 `.js`（把 `node:fs/promises`/`node:path`/`node:child_process` 别名到 shim 模块），Windows 上不装 node_modules。
- **宿主最小面**：6–8 个 host fn（stat/list/read/write/ensure/move/delete + now，直接复用 `NativeNodeHost` 的设计），
  取消用 `AtomicBool` 接 `set_interrupt_handler`，`set_memory_limit` 设一个小值验证失败可观测。
- **传输**：`scp` 整个 probe 目录 + 打好的 `.js` 到 Windows 机（`30902@100.122.176.77`）；
  **不 push**、不进 git，避免碰 Xiranite 仓的发布纪律。Breeze 只作只读参考（`git -C ../rossi fetch upstream`）。
- **顺序**：先在这台机上确认「能连上 + 有 Rust MSVC 工具链」，再跑判据；六条判据里 Windows 是**唯一否决点**，
  所以不接受「先在 Mac 上跑通、Windows 以后再说」。
- 现状（2026-10-05 实测）：`ssh 30902@100.122.176.77` **连接超时**，这台机当前不可达；
  工具链（rustc/cargo/bun/MSCV）是否就绪也还没验。spike 的第一步是连通性 + 工具链盘点，不是写代码。
  （用户同日回复：这台是他自己的机子，且已在上面编译过 Rossi ⇒ MSVC + Rust 工具链存在，rquickjs 家族在 Windows 上编过；
  只是 SSH 这条路当前连不上，需要 Tailscale/开机恢复。）

### 9.4 macOS 上已跑出的数字（probe 已落地，`spikes/quickjs-probe/`）

probe 是真代码：独立 workspace（根 `Cargo.toml` 的 `exclude` 里加了 `spikes`），只依赖 crates.io 的
`rquickjs = "0.14"`，**不开 `bindgen`**（预生成绑定路径），`cargo build` 19.6s 一次通过。

```
probe=smoke  outcome=ok elapsed_ms=1 host_calls=2                    # 引擎 + 宿主调用可用
probe=spin   outcome=interrupted cancel_after_ms=500 elapsed_ms=501
             error=JS exception: interrupted                          # 死循环被 interrupt 打断，开销 ≈1 ms
probe=alloc  outcome=failed-observably limit_mb=64 elapsed_ms=2
             error=JS exception: out of memory                        # 内存上限是「可观测失败」，不是进程崩溃
```

真节点保真（`spikes/quickjs-probe/js/linedup-entry.ts` 由 esbuild 打包成同一份 bundle，
`packages/nodes/linedup/src/core.test.ts` 的 7 个用例原样搬入当 oracle）：

| 引擎 | 断言 | 附加的 locale 用例（informational） |
| --- | --- | --- |
| bun v26.3.0（当前 TS 运行时） | 7/7 | `["äpfel","apfel","zebra"]` |
| QuickJS（probe） | **7/7** | `["apfel","zebra","äpfel"]` ← 码位序，因为 QuickJS 没有 Intl |

两条结论：① 节点逻辑在 QuickJS 上**逐字节一致**（这 7 个用例覆盖 normalize/去重/过滤/diff/统计/解释/大小写）；
② 唯一的偏差正是 locale 排序，而且**节点自己的测试抓不到它**（用例是纯 ASCII）——这就是 §8.3.1
「locale 归宿主」边界的实测复现，也说明那条边界必须做成宿主函数而不是「注意一下」。
Windows 数字仍未采集（唯一否决点）。

## 10. `quickjs_runtime` vs rquickjs：三处纠正与真实取舍（2026-10-05 现查）

用户提议首选 `quickjs_runtime`（HiRoFa/quickjs_es_runtime，quickjs-ng 路线）。查证后**三处前提不成立**，
但它的真实卖点成立，结论是「binding 维持 rquickjs，runtime 层单独量」。

### 10.1 纠正

1. **rquickjs 就是 QuickJS-NG 的绑定**。其 README 第 8 行原文：This library is a high level bindings of the
   **QuickJS-NG** JavaScript engine。本机还能验尸：`~/.cargo/registry/src/…/rquickjs-sys-0.14.0/quickjs/`
   里是 ng 的树（`SECURITY.md`、`amalgam.js`、`builtin-array-fromasync.h` 都是 ng 特征文件）。
   所以「quickjs_runtime 才支持 quickjs-ng」这条优势不存在。
2. **quickjs_runtime 不是 rquickjs 的上层**，它自带 `hirofa-quickjs-sys`（自研 FFI crate，0.16.1，27.7k 下载）。
   两者是**并列的绑定**，不是「绑定 + 框架」。
3. **它的构建反而更重**：`hirofa-quickjs-sys` 把 **`bindgen ^0.73` 列为必需 build-dependency** ⇒ 每台构建机都要
   LLVM/Clang；rquickjs 默认走**预生成绑定**，我实测在 macOS 上 19.6 秒从零构建、全程不需要 LLVM。

### 10.2 它真实的卖点（成立，且正是我们迟早要写的那层）

- 单线程 **EventLoop** + 跨线程任务投递（`QuickjsRuntimeFacade`）、`JsValueFacade`（值复制/引用计数，省掉 GC 心智负担）、
  可传 module loader、可选 `typescript` feature（swc 在**运行时**编译 TS）。
- 对 Xiranite 的意义：**promise/async 那一层**确实是我们还没证明的部分（38 个节点用 `fs/promises`、31 个用
  `child_process`，代码里全是 `await`）。Rossi 的 2,295 行 host 层就是「自己写这层」的存在证明。

### 10.3 代价与两侧能力差

| | rquickjs 0.14 | quickjs_runtime 0.18 |
| --- | --- | --- |
| 引擎 | QuickJS-NG（vendored，已验） | bellard（windows 表格里 ❌）或 quickjs-ng（feature，MSVC ✅） |
| 绑定 | 预生成绑定，`bindgen` 可选 | **bindgen 必需**（LLVM/Clang 常驻） |
| 中断抢占 | ✅ 实测 `interrupted`，开销 ≈1ms | ✅ 文档里有 `set_interrupt_handler` |
| 内存上限 | ✅ 实测 `out of memory`（`set_memory_limit`） | **未发现**（文档里只有 `memory_usage` 读取） |
| runtime 层（event loop/promise/loader/TS） | 自己写（参考 Rossi） | ✅ 开箱 |
| 依赖树 | async-lock / hashbrown / relative-path | tokio/flume/lru/string_cache/num_cpus/thread-id/backtrace/rand/either/hirofa_utils（+swc 可选，巨大） |
| 社区 | 4.83M 下载，DelSkayn | 76k 下载，HiRoFa |

### 10.4 结论与下一步

- **binding 维持 rquickjs**：它已经是 ng、不要 LLVM、且我实测拿到了中断与内存上限这两条 quickjs_runtime 没有齐全的原语。
- **「runtime 层」是独立问题，按需量**：Xiranite 的节点模型是**一次同步调用**（input JSON → output JSON），
  不需要通用 event loop、模块解析、定时器（esbuild 在构建期已把模块打成一个文件）。真正需要的只有
  **Promise 泵**（host 的 async fs/child_process 要被 `await`）+ 中断取消。
- 下一步（probe 里做）：host 返回 deferred promise、手动泵 job、并在 **await 挂起期间验证 interrupt 仍能打断**。
  这一块若证明难做，兜底是 quickjs_runtime（而不是 Boa/GreenCopper）——到那时再付 LLVM + 依赖树的代价。
- 顺带：它的 `typescript` feature 对我们是多余（TS 在构建期由 esbuild 处理），`module loader` 也不需要（单文件 bundle）。

## 11. 迁移成本实测：runtime 与节点 API 的 Node 耦合度（2026-10-05，回应「决定成本的那个问题」）

问题：`packages/runtime` 与一个典型 `packages/nodes/*` 的执行面是否已经足够脱离 Node？**答案是已经脱离了，而且比预想的干净。**

### 11.1 实测数字

| 面 | 规模 | 引 `node:` 的数量 | 读法 |
| --- | --- | --- | --- |
| `packages/nodes/*/src/core.ts`（业务逻辑） | 17,746 行 | **0 / 44 个节点** | 也**没有**任何 core 引 `./platform` ⇒ 注入式，已解耦 |
| `packages/nodes/*/src/index.ts`（节点对外贡献） | — | **0 / 44** | 只 re-export `def` 与 `core` |
| `packages/nodes/*/src/platform.ts`（Node API 面） | 6,158 行 | 38 用 `fs/promises`、36 `path`、31 `child_process`、10 `fs`、4 `os`、4 `util`、3 `crypto`、1 `url` | **只被 `cli.ts`/测试引用，从不被 core 引用**（`grep -rl './platform'` 的名单里没有 core.ts） |
| `packages/nodes/*/src/cli.ts`（终端面） | 15,717 行 | **29 / 44 个节点** | 耦合集中在这里，但**不在 core 执行路径上** |
| `packages/runtime/src/*`（执行层） | **778 行**（其中 `node-runner.ts` 152、`node-runner.generated.ts` 302 生成物、loader 88、preparer 106） | — | 「runtime 层」要重写的只有约 150 行真逻辑 |

### 11.2 现在的 seam 就已经是目标形状

`packages/runtime/src/node-runner.ts:17-44` 定义的就是注入式契约：

```ts
interface PlatformNodeSpec { packageName; loadCore; run; loadPlatform; createRuntime }
interface PureNodeSpec     { packageName; loadCore; run; message }
type PlatformRunFunction  = (input, runtime: unknown, onEvent) => Promise<NodeRunResult>
interface NodeRunControl  { isCancelled(); waitWhilePaused(); checkMemory?() }
```

`runSpec`（`:80-101`）两条路径：纯节点 `core[run](input)`（**完全没有 runtime**）；平台节点
`platform[createRuntime](runtimeContext)` → `core[run](input, runtime, onEvent)`；
且 `control` 的三个函数（取消/暂停/内存）是**注入进 runtime 对象的**（`:97-99`）。
这正是 ADR-0066 的语义以「宿主提供的函数」形式到达——它天然就是 QuickJS 侧 `isCancelled → interrupt 标志`、
`waitWhilePaused → checkpoint`、`checkMemory → set_memory_limit` 的对应物。**没有需要重新发明的中层。**

### 11.3 于是迁移工作被切成四块（按代价排序）

1. **platform.ts 的 41 个 `createRuntime` 工厂 → 宿主能力**（真正的工作量）：它们才是节点接触机器的地方
   （fs/child_process/os-native）。做法不改节点代码：工厂留在 bundle 里，宿主提供 8 个 `node:` 内建 shim + `process`
   （`process.platform` 出现在 `linedup/src/platform.ts:9/22` 这类分支里），esbuild 构建期别名过去——probe 已经跑通这条管线。
2. **`node-runner.ts` 的 152 行 → Rust 侧执行器**：加载 bundle、调用 `run(input, runtime, onEvent)`、注入 control、回 `NodeRunResult`。
3. **`node-runner.generated.ts`（302 行生成物）→ 由注册表生成**：它是 `nodeId → loaders/导出名` 的表，
   在 ADR-0073 的 registry 里已有等价物（`NodeDescriptor` + 按名字解析的 node function），换执行器时重新生成即可。
4. **`cli.ts`（29/44 引 `node:`）**：不在 core 路径上，按 ADR-0074 §5 它是展示壳的事——先不动。

### 11.4 结论

- 「节点 API 是否足够脱离 Node」= **是**（core 侧 0 耦合，契约已是注入式）。迁移成本因此集中在 `platform.ts` 的
  平台面与 promise/async，而不是节点逻辑。
- 唯一还没证明的机制是 **async**：`PlatformRunFunction` 返回 Promise，38 个节点 `await` 文件 IO——这就是 §10.4 说的下一块拼图。
## 12. dev 期节点热重载：本仓已有的机制、QuickJS 等价物、与 blitz-quick 的查证（2026-10-05）

### 12.1 这个机制本仓已经实现（`packages/runtime/src/node-module-loader.ts`）

- `XIRANITE_NODE_SOURCE=1` 时节点从源码走 Bun 动态 import；再开 `XIRANITE_NODE_SOURCE_HMR=1` 才启用
  `fs.watch(sourceDirectory, { recursive: true })`（`:58-72`，并带递归不可用时的降级）。
- 文件变更只做 `revision += 1`（`:63`），loader 把 revision 拼进 import URL 的查询串（`:78`）⇒ 下一次 import 拿到新模块；
  `node-runner.ts:61-70` 按 revision 让缓存失效。
- 代码注释原文（`:61-62`）："A file change merely invalidates its next run; it never restarts the backend."
  —— 这正是「新任务用新版本、在跑的任务继续持有旧引用」的语义，**已经实现**（整个文件 88 行）。

### 12.2 QuickJS 等价物 = 同一个形状，中间多一步打包

`watch 源目录 → esbuild 重建该节点 bundle → revision += 1 → 下一次 run 发现 revision 变了：为该节点建新 Context、
eval 新 bundle、取新 entry 函数`；在跑的 run 继续持有旧函数与旧 Context，语义与现状一致。
实测成本：小节点 bundle + 8 个用例 = **2–4 ms**（probe 的 `bundle` 探针）。

**顺带的收获**：「每次 run 一个全新 Context」在这条路上是可行的（4 ms 量级），它顺手绕开 §9.4 记的
Persistent/关停断言坑——代价是每 run 重新 eval，收益是生命周期简单到不会错。是否采用按节点 bundle 体积再量。

### 12.3 blitz-quick 的查证

仓库存在：`SunDoge/blitz-quick`，**3 star**，2026-07-11 建、07-17 之后未再推；确实是 Rust + QuickJS + Vite 的组合
（Blitz + Vello 渲染、SolidJS 无 DOM 自定义 renderer、二进制 opcode FFI 替代 JSON）。但它的 `README.md`、`DESIGN.md`、
`docs/ARCHITECTURE.md` 里**都找不到**「Vite HMR 转发给 QuickJS / accepted updates keep QuickJS context alive」这几句
（三份文件现查：README/DESIGN 无 HMR 关键词，ARCHITECTURE.md 无 HMR/Vite 关键词）。所以那三句目前**没有出处**；
它只能当「这条路有人试过」的旁证，不是可依赖的实现。

### 12.4 建议

- 节点 bundle **不要接 Vite 的 HMR 协议**：节点不是页面组件，没有组件边界与状态迁移问题，
  §12.1 的 revision 失效 + esbuild 重建已经覆盖需求；GUI 继续照旧用 Vite HMR。
- 顺序：排在「第一个节点端到端跑通」之后（约 50 行、dev-only），不提前做。
## 13. 「真隔离 vs 假隔离」：core 闭包的传递扫描（2026-10-05，`spikes/node-core-isolation-scan.ts`）

`core.ts` 不 import `node:` 只是必要条件：相对文件或 workspace 包都可能把 Node 依赖藏在后面，而 Node 的**全局**
（`process`、`Buffer`、`import.meta.url`、`require(`）根本不会出现在 import 语句里。所以扫描按 esbuild 真实解析出的
**传递闭包**做（用的是产品构建同一个 resolver），再对闭包里每个一手文件做全局 API 扫描。

命令：`bun spikes/node-core-isolation-scan.ts`（结果同时写 `spikes/core-isolation-report.json`）。
实现备注：走 esbuild **CLI**（`node_modules/.bin/esbuild --metafile`），JS API 那条路在本仓 0% CPU 挂死过。

### 13.1 结果

```
node cores scanned: 44
clean closures (no Node API, no npm package, no Node global): 37
cores reaching outside pure JS: 7
```

7 个例外，逐条性质不同：

| 节点 | 性质 | 处理 |
| --- | --- | --- |
| `classf` | npm `opencc-js`（纯 JS） | 随 bundle 打包即可 |
| `lata` | npm `yaml`（纯 JS） | 同上 |
| `logx` | npm `zod`（纯 JS） | 同上 |
| `comfygure` | npm `clone/eventemitter2/fflate/hash-it/json-rules-engine/jsonpath-plus/jsonrepair/liquidjs/zod` | 同上（该节点是唯一的 network 节点） |
| `marku` | npm `remark`/`micromark`/`mdast` 全栈（约 44 个包，全部纯 JS） | 同上 |
| `findz` | Node 全局 `import.meta.url`（`worker-client.ts`）＋ Go worker/常驻 SQLite | 既有 blocker（§3.5），换引擎不解决 |
| `owithu` | **原生 Node 插件** `registry-js` 的 `.node` 二进制，esbuild 无法 bundle | 注册表/ shell 集成必须变成宿主服务（与 AST 清单的 `osNative: registry+shellIntegration` 一致） |

**37/44 的 core 闭包在传递意义上干净**（无 `node:` 内建、无裸内建、无 npm 包、无 Node 全局），
5 个只带纯 JS npm（已证明 esbuild 能打包），真正需要宿主化改造的只有 `owithu`（注册表）与 `findz`（Go/SQLite/watcher）两个。

### 13.2 边界说明

- 本扫描覆盖 **core 闭包**；`platform.ts` 不在范围内，它就是已知的 Node 面（§11.1：fs/promises 38 节点、path 36、
  child_process 31…），那部分本来就要换成宿主能力。
- 结论与 ADR-0074 的判据一致：迁移成本集中在 `platform.ts` 平台面 + `owithu`/`findz` 两个宿主服务，
  **不在**节点业务逻辑里。
- 这条扫描具备当门禁的一切条件（全仓 44 个 core、秒级、结果可枚举、失败模式明确）。建议 spike 通过后提升为
  `bun run audit:node-core-isolation`：**新增依赖 Node 的 core 闭包即红**，`owithu`/`findz` 用显式白名单带着理由留在名单里。
## 14. 分发形态：节点 CLI/TUI 是产品，GUI 统一；runtime 怎么带（2026-10-05 实测数字）

### 14.1 先回答「独立分发」是哪种（本仓 ADR 已定）

- **CLI/TUI 是产品，不是调试壳**：ADR-0069 的四面里，CLI 是节点自己的 `[[bin]] x<id>`（clap + cliclack），
  TUI 是节点自己的（`xtrename-tui` 或 `x<id> tui`）；`xr run <node>` 只是 Xiranite 的管理入口，**不取代节点自己的命令**。
- **GUI 不是逐节点产品**：所有节点的 React UI 打进同一套 Tauri 应用。真要单独给某人一个节点的 GUI，
  是 `tauri build --config <node>.conf.json` 的**构建期覆盖**（assets + definition + wasm 作为 resources），
  不复制源码树——「独立交付是构建期属性，需要的是构建目标而不是源码树」是 AGENTS.md 的原话。
- 所以「独立分发」= CLI/TUI 独立，GUI 统一；这也把用户问的「第 1 种 vs 第 2 种」变成一个**构建目标**问题而不是架构问题。

### 14.2 引擎与脚本的重量（今天在本机实测）

| 项 | 大小 |
| --- | --- |
| QuickJS 引擎进 release 二进制（rquickjs + 编进去的 QuickJS C + host glue，probe 实测） | **1.63 MiB**（`strip -x` 后 1.46 MiB） |
| 单个节点 bundle | linedup **3 KB**、dissolvef 27 KB、marku 321 KB、comfygure 1.0 MB |
| **全部 44 个 core 的 bundle 总和** | **2.8 MiB** |

### 14.3 方案评估（B 否掉、A≡C、新增两个）

- **方案 B（系统级共享 runtime，类 python）——明确否掉**：引入「先装 runtime 再装节点」的安装步骤、版本偏移
  （节点声明的 API 必须与共享 runtime 兼容）、Windows 安装器与权限问题；而本仓既定纪律正相反：
  `target/` 只是开发缓存，**「编出来的 exe 自带自己那份」**（AGENTS.md）。为省 1.5 MB 换来一套包管理器，不划算。
- **方案 A 与 C 在交付期是同一件事**：只要发布物是静态内置，A（每节点自带 core）与 C（开发共享、发布自带）产出完全一样，
  差别只在源码树是否共享 workspace。本仓已经是 C（一个 workspace、一个 lock、`cargo build -p <flavor>` 只编该 flavor），不用改。
- **第 4 种（建议采纳）：一个多路复用二进制**。即 Git/Cargo subcommand 的形状：`xiranite <node> …` 一个二进制，
  内含全部 bundle（2.8 MiB）+ 一份引擎（1.5 MiB）≈ **4.3 MB**；节点命令名照旧（`xlineup`、`xtrename`…），
  它们由同一个二进制按子命令/argv[0] 分派，而不是 40 份 runtime。
  需要把某个节点当独立软件送人时，再从同一棵树切一个只带该 bundle 的 flavor（A 形态）。
  好处：消掉「几十份 runtime」与「更新 Core 要重装 40 次」；代价：整包略大、一个节点编译失败挡住整包——
  这正是 workspace 本来就在承受的成本。
- **第 5 种（提出但建议不做）：引擎做成动态库共享**（`libquickjs` dylib 多节点共用）。省磁盘，但把「静态内置」
  换成「运行时加载」，版本偏移与 DLL 搜索路径问题立刻回来；ADR-0073「不为理论兼容堆抽象」同样反对。

### 14.4 结论

分发形态不需要新架构：**源码树一份（C）、发布物按需切 flavor（A），日常装的那份用多路复用二进制（D）**。
引擎重量 1.5 MiB、全节点脚本 2.8 MiB 都是可接受的量级，方案 B/F 省下的空间买不回它们引入的运行时依赖。

## 15. Node 兼容缺口的复用判定（2026-10-05 下午，回应「尽量用别人已经写好的，别再自己弄」）

原则一句话：**缺口分两类，纯计算可以且应该复用现成实现；碰 OS 语义的复用等于把第二份实现请回来**。

### 15.1 两份粘贴稿的断言，逐条回掉

| 断言（来自粘贴稿） | 本仓/上游实测 | 判定 |
| --- | --- | --- |
| 「缺口名单来自 `docs/migration/node-quickjs-workorders.json` 的 `unmappedExternals`」 | 该文件里 `node:module` 命中 4 次、`node:zlib` 1 次，`events`/`stream`/`assert`/`vm`/`worker_threads`/`string_decoder`/`constants` **命中 0 次**，`nodes[0].unmappedExternals` 是 `[]` | **假引源**。真实名单只出自门禁 `bun run audit:node-bundles`（§15.6） |
| 「`packages/quickjs-shims` 已覆盖 11 个 `node:` 模块」 | 现在 13 个入口（`fs`、`fs/promises`、`path`、`buffer`、`util`、`os`、`process`、`crypto`、`url`、`child_process`、`events`、`constants`、`string_decoder`） | 数字过期；`events.ts`/`string-decoder.ts`/`constants.ts`/`deep-equality.ts` 是本轮才出现的**未提交**文件 |
| 「rquickjs-extra 已经在替你做 Node 补全，直接拿现成的」 | crate 真实存在：0.2.1，Apache-2.0，2025-03-07 首发、2025-12-24 最后更新、1,767 次下载；README 的覆盖面就是 console/os/timers/url/sqlite（**没有 fs/path/buffer/child_process**），并自述「优先用 LLRT 的模块，本仓是 LLRT 没覆盖的溢出」 | 方向对、结论错：子 crate pin `rquickjs >=0.10, <0.12`，我们是 **0.14**（`crates/xiranite-quickjs-executor/Cargo.toml`），装进来就是两个引擎两个 QuickJS。且它的 os/timers 是**自带一份语义**，直接撞 ADR-0074 §2「一种实现」 |
| 「LLRT 的 Rust 模块可以直接抄进来」 | crates.io 上 `llrt*` 全是 **0.8.1-beta**（2026-07-28/30）；`llrt_path` pin `rquickjs ^0.11`；`llrt_crypto` 除 `^0.11` 外还拉 `openssl`、`ring 0.17` 和十几条 RustCrypto `-rc.5/-rc.9` 预发布 | 接不进 0.14，且依赖面违反 AGENTS.md 的「不随手加依赖」。LLRT 继续是**架构读物**（§2.3 结论不变） |
| 「你已经决定 Extism 负责真正的插件隔离」 | ADR-0073 已把 Extism 与 wasm 退役；第三方隔离按 ADR-0074 §4 是**明确推迟项** | 前提失效。「Runtime 只暴露稳定 capability、插件不直接碰宿主」这条原则留着，落点改成注册表上的 `NodeDescriptor` 策略 |

`rquickjs` 本身不需要辩护：executor 的绑定层就是 rquickjs 0.14（`array-buffer` 特性、**bindgen 故意关掉**走预生成绑定），我没有也不需要「自己封一套 Rust↔QuickJS ABI」。我写的只有 `__xrh` 那批宿主 op——那正是「项目特有 capability」，粘贴稿说该自己写的就是这层。

### 15.2 判据（定这条，后面的账都按它算）

| 类别 | 判定 | 理由 |
| --- | --- | --- |
| **纯计算 / 纯数据**：EventEmitter、StringDecoder、`constants` 常量表、深比较、path 规范化 | **优先复用现成包**（alias 到 node_modules 里已有的，或一条 `bun add` 的 browserify 同源包） | 不碰 OS，语义可 1:1 对照 Node，重复写就是我自己的维护债 |
| **碰 OS 语义**：fs、child_process、os、时间/随机/locale、网络 | **一律宿主答，不许引第三方实现** | 第三方那份会绕过路径授权与程序白名单（`DangerGate` 挂在注册点上），并在宿主之外造出第二份语义（ADR-0074 §2、§13.1） |
| **需要引擎本身没有的东西**：worker_threads、`node:module`（createRequire） | **显式 not-implemented，保持表外成员 throw** | QuickJS 无线程；bundler 已解析完依赖，`createRequire` 没有真实消费者。给假实现比报错更坏 |

### 15.3 A 档：我们自己写的重复劳动（实测行数）

`packages/quickjs-shims/src/` 本轮新增、未提交的四个文件：**events.ts 420 / string-decoder.ts 293 / constants.ts 145 / deep-equality.ts 206 = 1,064 行**，全部落在 §15.2 第一行（纯计算）里。

本机 `node_modules` 已存在的纯 JS 实现：`string_decoder@1.1.1`、`buffer@5.7.1`、`safe-buffer@5.2.1`、`readable-stream@2.3.8`、`inherits@2.0.4`。
**不在**树里的：`events`、`assert`、`url`、`util`、`process`、`path-browserify`（要复用就得装）。

两点必须写在这里，不能只喊「复用」：
- `readable-stream@2.3.8` 是 Node 8 世代的 API（无 `stream/promises`、无 `Readable.from`），拿它 alias `node:stream` 之前要先按调用点核对覆盖面；`string_decoder@1.1.1` 同理落后于 1.3.0。
- 那 1,064 行是**别人这一轮写的、还没提交**。换包 = 删他的代码，得先对齐归属再动手。
- **归因后的修正（§15.6）**：这 1,064 行里 `events`/`constants`/`stream` 三份的消费者是 `@xiranite/config` 的锁+原子写路径，不是任何节点的逻辑。那条路径下沉宿主之后它们没有消费者；真有消费者的只剩 `string_decoder`（encodeb 经 `iconv-lite/lib/encodings/internal.js`）与可能还需要核对的 deep-equality。所以「删手写换 polyfill」之前先定 config 的归属，否则是给要搬走的东西配家具。

### 15.4 B 档：库自带非 Node 入口（这条最省，实测过 `package.json`）

门禁点名 comfygure 的 core 闭包拖进三个 Node-only 入口（`liquidjs/dist/liquid.node.js imports node:stream`、`jsonpath-plus imports node:vm`、`fflate imports node:module`）。实测这三个包**都发布了非 Node 入口**：

| 包 | 版本 | 现成入口 |
| --- | --- | --- |
| liquidjs | 10.27.2 | `browser` 字段直接映射：`./dist/liquid.node.js` → `./dist/liquid.browser.mjs`（另有 `.browser.umd.js`） |
| jsonpath-plus | 10.4.0 | `browser: "dist/index-browser-esm.js"`（`exports` 只有 `.` 与 `./package.json`，所以得走 browser 字段） |
| fflate | 0.8.3 | `exports["."]` 分 `node`（`lib/node.cjs` / `esm/index.mjs`）与 browser（`lib/browser.cjs` / `esm/browser.js`），另有 `./browser` 子入口与 `browser` 字段 `./lib/node-worker.cjs` → `./lib/worker.cjs` |

⇒ 这一类缺口**不用写一行 shim**：esbuild 侧选条件或按包别名即可。

代价必须摆在台面上：`XIRANITE_NODE_SOURCE=1` 的 dev 路径是 Bun 直接跑源码，默认按 `node` 条件解析；bundle 若按 `browser` 条件，**同一个节点两侧跑的是不同库入口**，这就破了「一份实现」。复用成立的前提是**两侧把条件钉成同一个**（钉 bundle 侧到 node + 补 shim，或钉 dev 侧到 browser）。这条还没定，是本轮留下的唯一开放架构问题。

### 15.5 C 档：归宿主的那两类，Rust 侧也是现成的（根 `Cargo.lock` 现查）

| 缺口 | 已 vendored 的 crate（位置=根 lock 行号） |
| --- | --- |
| `node:zlib`（comfygure 的 core 直接 import：`packages/nodes/comfygure/src/project.ts:3` 的 `brotliCompress`/`brotliDecompress`/`constants`） | `brotli 9.0.0`（:263）、`brotli-decompressor 6.0.1`（:274）、`flate2 1.1.10`（:1344）、`zlib-rs 0.6.8`（:6503） |
| `crypto.createHash`（我手搓的 SHA-1/SHA-256） | **`sha2 0.10.9`（:4013）**，puller 是 `extism`/`tauri-codegen`/`wry`/`wasmtime-environ` |

⇒ `crates/xiranite-quickjs-executor/src/digest.rs`（**303 行手写**，我当初登记的理由是「本任务不加 crates.io 依赖」）应当换成 `sha2`：这不是新增生态，是复用本仓 lock 里已有的那份。当前实测红点就是这把尺——`cargo test --lib` 65 passed / **8 failed**，其中 4 条是 `digest::tests::*`，SHA-1 空串答成 `6bb138417b02bb41df031acd57f0d0e599bcbae6`，FIPS 值是 `a9993e364706816aba3e25717850c26c9cd0d89d`。另 4 条红在 `fs_operations::tests`（appendText 拒绝顺序、readlink 在 macOS 上 EINVAL、越权路径读成 missing 的断言）与 `proc_operations::tests`（子进程没随 run 回收）。**换 `sha2` 之后仍需实测确认**，别把「应该对」当「已经对」。

### 15.6 缺口的真实分布（`bun run audit:node-bundles` 现读，19 条 WARN）

尾行：`41 retained node(s) required, 44 bundle record(s), 43 core bundle(s) scanned clean (allowlist: findz, owithu, comfygure), 44 core(s) on disk, 19 warning(s)`。

| WARN 家族 | 节点 | 归哪档 |
| --- | --- | --- |
| `assert constants events stream worker_threads`（同一组五元组） | classf、dissolvef、linku、marku、migratef、trename（均 **platform** bundle）；clipm、comfygure 各多带 `node:stream`/`node:zlib` 拼写 | **C 档／宿主**：引入者是 `@xiranite/config` 的锁+原子写，见本节下方归因 |
| `module node:module` | bandia、cleanf、enginev、kisaki、smartzip | C/拒：bundler 已解析，`createRequire` 无消费者 |
| `stream string_decoder` | encodeb | A 档（纯 JS 复用） |
| core 触及 allowlist 外全局 `process`/`Buffer` | lata | 引擎侧注入全局，非 shim |
| manifest 导出名与 bundle 不符 | kisaki（`runKisaki`、`createNodeKisakiRuntime` 不在 bundle 里） | 与 shim 无关，另一条账 |
| `core.ts` 在盘上但没进 `node-runner.generated.ts` | clipm、lata | 注册表欠账，与 shim 无关 |

**结构性结论（五元组已归因，2026-10-05 13:25）**：那组内建**不是节点要的，是 `@xiranite/config` 的原子写路径要的**。

| 缺失内建 | 实际 import 它的文件（按 esbuild meta 反查） |
| --- | --- |
| `assert` | `node_modules/graceful-fs/graceful-fs.js`、`node_modules/signal-exit/index.js` |
| `constants` | `node_modules/graceful-fs/polyfills.js` |
| `events` | `node_modules/signal-exit/index.js` |
| `stream` | `node_modules/graceful-fs/legacy-streams.js` |
| `worker_threads` | `node_modules/write-file-atomic/lib/index.js` |

链条在 trename / classf / linku / dissolvef 四个节点上都收敛到同一个第一方入口：`packages/config/dist/index.js`（`@xiranite/config`）。该包 `package.json` 的 `dependencies` 就是 **`proper-lockfile@4.1.2` + `write-file-atomic@7.0.0`**，用法在 `packages/config/src/index.ts:5`（`import { lock } from "proper-lockfile"`）与 `:7`（`import writeFileAtomic from "write-file-atomic"`）；它的构建是 **`tsc -p tsconfig.json`，不打包**，dist 里保留外部引用，于是 esbuild 把 `proper-lockfile → graceful-fs + signal-exit` 与 `write-file-atomic`（还自带第二份 `signal-exit`）**重复打进每一个用到写路径的 platform bundle**。

三件事因此翻转，我上一版的判断撤回：

1. 五元组归 **C 档／宿主**，不是 A 档。「读配置 + 带锁原子写配置」按定义就是宿主服务——它要的是 `proper-lockfile` 的锁语义和 `write-file-atomic` 的 temp+rename；QuickJS 里既不该有 `worker_threads`，也不该有第二份文件锁实现。
2. §15.3 那 1,064 行手写 shim 里 `events`/`constants`/`stream` 的**消费者就是这条路径**，路径下沉后它们没有消费者。encodeb 的 `stream string_decoder` 是另一个引入者（`iconv-lite/lib/index.js`、`iconv-lite/lib/encodings/internal.js`），那一条才是真正的「第三方纯 JS 库需要 Node polyfill」，归 A 档复用。
3. 「44 个 core 里 43 个干净」不足以当「节点已 platform-free」的证据：**49 个节点源文件（43 个节点）import `@xiranite/config`**，只有走到写路径的那批把锁带进闭包。今天没红的节点将来一加原子写就红——门禁现在能挡住是对的，但正确修法不是补 shim。

**归因为什么上一轮失败（写下来免得再踩）**：`scripts/build-node-bundles.ts:311` 在成功路径末尾 `rm(metaDir)`，meta 全删，门禁报完缺口就没有证据链（我看到的「只有 3 份 meta」是构建中断的残留）。本轮改用**仓库外**的一次 esbuild 复跑（`--bundle --platform=node --metafile` 写到 `../.scratch/attrib/`）反查，**未改脚本**。给 `build:node-bundles` 加一个「保留 meta」的开关是独立的小决定，本轮没替它定。

**这一条待用户拍板**：`@xiranite/config` 的读写是否下沉宿主（我认为该下沉，落点是宿主的一个 config op + 宿主侧锁）。这条定了，A/B 档的分配才定得下来。

### 15.7 这一节不做什么

- 本轮只判定，**不改 shim、不加 npm 包、不引 Rust crate、不动 executor**（用户 2026-10-05 明确：架构还在探索期，不许派实现代理动代码）。
- §14.1 里「CLI 是 clap + cliclack」「wasm 作为 resources」两句是 ADR-0074 之前的措辞，**尚未按 §5/§6 修正**，等 AGENTS.md 那轮重写落定一起收，避免两处口径打架。
- 记一条已犯的错备查：本轮曾在架构未定时派出实现代理，被用户驳回。判据：**用户在问「可以吗/评估一下」时，只查只答**。

### 15.8 打包器换 rolldown 的实测结论：走不通，已回退（2026-10-05 14:24）

用户要求「把节点打包器换成栈里已有的 rolldown」，换完做了全量对照，结论是**这条今天不能用**，已回退到 esbuild（`13a607f5`，复现与排除项同时写进 `scripts/build-node-bundles.ts` 头注释）。

| 测什么 | 结果 |
| --- | --- |
| 构建可用性 | 盘上 30 个节点全部建成，24 个有 host bundle；体积更省（core 1.31 MiB vs esbuild 1.68；platform 5.47 vs 7.20） |
| 求值可用性 | **4/24 的 platform 面求值即抛** `TypeError: __esmMin is not a function`：encodeb、logx、linku、kisaki |
| 缺陷归属 | 拿产物直接给 `node --input-type=module` 与 `bun` 跑，**同样抛**（node 报 `enc_direct.js:217:17`，bun 报 `'__esmMin' is undefined`）⇒ 是 bundler 输出侧，不是 QuickJS 执行器、不是 shim |
| 机制 | rolldown 把 `packages/quickjs-shims/src/host.ts` 的顶层绑定提升成 `var ...` 并用 `var init_host = __esmMin(...)` 初始化，而 `var __esmMin = ...` 的定义在**首次使用之后**（use=217 / def=521）；`var` 只提升声明不提升赋值 |
| 已实测排除 | 升 1.2.12、`output.strictExecutionOrder` true/false、`minify:false`、去掉 `codeSplitting:false`、去掉 prelude 合成入口、把 `zod` 别名到它的 ESM 入口（**encodeb 闭包里 zod 命中 0**，所以「含 zod 才触发」这条收窄不成立） |
| 顺带量到 | rolldown 无 `metafile`（`Invalid key: Expected never`），门禁的 `unresolvedExternals` 得改读 `chunk.imports`；且 `chunk.imports` 会给出 **phantom 项**（logx 记了一条 `timers`，产物里 `timers` 出现 0 次）；esbuild 的 `--inject` 在 rolldown 里没有等价物（`transform` 钩子里前置的 import 会被 tree-shake 掉） |
| 上游 | rolldown/rolldown#10336（2026-07-20 已关）只处理 force-included helper 的去冲突，不解决这个排序 |

回退之后重扫同一批节点，暴露的是**各自真实的缺陷**，不再被坏产物挡住：encodeb 与 logx 恢复可跑（logx 直接 `Matched 0 log event(s).`，经宿主 op 读了真实日志目录）；linku 报 `no setter for property — at node_modules/graceful-fs/graceful-fs.js`，这是 §15.6 那条 `@xiranite/config → proper-lockfile → graceful-fs` 链的**运行时实证**：`graceful-fs` 要 monkey-patch `fs` 的属性，而我们的 shim `fs` 没有可写属性——所以「带锁原子写配置」不属于沙箱内 JS，应归宿主（(a) 那条建议由这条证据支撑）。另有 bandia/cleanf/enginev/smartzip 的 platform 面构建失败：`czkawka-service.ts` 不导出 `file-operations` 要的 trash 四件套（`packages/file-operations/src/platform.ts:3-11`），esbuild 与 rolldown 都会硬报 `No matching export`，需宿主侧补 trash op 或撤那条别名。

> 更正一处我先前说错的话：我说过「esbuild 会把解析不到的当外部、rolldown 才报错」——实测 esbuild 同样报 `✘ [ERROR] No matching export`，那句作废。

## 16. tauri3 这一半今天站在哪里（2026-10-05 实测，回应目标里的「tauri3」）

### 16.1 现状：读 lock 与真跑 `cargo check`，不读文档

| 项 | 实测 |
| --- | --- |
| 桌面 crate | `crates/xiranite-desktop` 存在且是根 workspace 成员（`Cargo.toml:19`） |
| 锁定的版本 | `tauri 2.12.1`、`tauri-build 2.7.1`、`tauri-macros 2.7.1`、`tauri-utils 2.10.1`、`wry 0.57.0`（根 `Cargo.lock`） |
| 依赖声明 | `tauri = { version = "2.12", features = [] }`（`crates/xiranite-desktop/Cargo.toml:31`）、`tauri-build = { version = "2.7", features = [] }`（`:41`） |
| 上游版本线 | crates.io 现查：`max_stable = **2.12.1**`、`newest = **3.0.0-alpha.4**`（发布于 2026-10-01，距今 4 天） |
| JS 侧 | npm `@tauri-apps/api`：`latest = 2.12.1`、`next = 3.0.0-alpha.2`——**v3 内部 Rust 与 JS 自己就不同步** |
| **桌面 crate 能否编译** | `cargo check -p xiranite-desktop -j 1` → **REAL_RC=101**，唯一错误在 `crates/xiranite-node-runtime/src/capabilities.rs:508` 的 `error[E0080]`；desktop 经 `Cargo.toml:30` 依赖 node-runtime |

⇒ **硬事实**：`capabilities.rs:508` 那条 E0080 不解，本地连 tauri2 的桌面 crate 都编不过，tauri3 的验证更没有地基。那条 const-assert 判的是「served capability 必须在 ADR-0068/0070 词表里」，而该词表已被 ADR-0073 作废；但 `capabilities.rs` 此刻是别的 lane 的在途文件（`but status` 里 `MM`），我没动它。
（记一条测量坑：第一次我把命令接在 `| tail` 后面读 `RC=$?`，拿到的是 tail 的 0。真 rc 要重定向后再读 `$?`。）

### 16.2 我们的 Tauri 接触面（全仓就这两处，比想象的小）

- **Rust 侧 = 3 个调用点**：`src/main.rs:67`（`tauri::Builder::default()`）、`:69`（`.invoke_handler(tauri::generate_handler![xiranite_bootstrap])`）、`:70`（`.run(tauri::generate_context!())`）；`src/bootstrap.rs:72-73`（`#[tauri::command]` + `tauri::State<'_, BootstrapState>`）。没有 tray、没有 menu、没有窗口操作、没有插件。
- **TS 侧 = 1 个全局名**：`src/backend/tauriChannel.ts:30` 结构化读 `window.__TAURI__?.core?.invoke`，**不 import `@tauri-apps/api`**（该文件 `:12-13` 写明理由）。配套测试覆盖了「没有 `core`」「invoke 抛错」「baseUrl 不是回环地址」三类拒绝（`tauriChannel.test.ts:16/43/47`）。⇒ npm 侧 v3 只有 alpha.2 这件事**不影响我们**，因为我们不依赖那个包。
- **配置**：`tauri.conf.json`（`$schema: https://schema.tauri.app/config/2`、`productName`、`app.withGlobalTauri: true`、`app.windows`、`app.security`、`build.frontendDist: "frontend"`）+ `capabilities/default.json`（`$schema: https://schema.tauri.app/permissions/capability`、`windows`、`permissions: ["core:default"]`）。

### 16.3 v3 alpha 接不接得住我们（读 `tauri-utils@3.0.0-alpha.3` 源码，不读二手博客）

- 我先怀疑「v3 把配置键改成 snake_case」——**读源码后自己否掉**：v3 的 `AppConfig` 仍带 `#[serde(rename_all = "camelCase", deny_unknown_fields)]`（该文件里 `rename_all` 出现 49 次），所以 `withGlobalTauri` / `frontendDist` / `productName` 这些拼写在 v3 依旧正确；`deny_unknown_fields` 也仍在，写错键是硬失败。
- `window.__TAURI__` 注入这条能力 v3 还在：`with_global_tauri` 的文档原话是 “Whether we should inject the Tauri API on `window.__TAURI__` or not”，并多给一个 `with-global-tauri` alias。⇒ `tauriChannel.ts` 的读法不受影响。
- v3 `AppConfig` 的字段集合：`windows`、`security`、`tray_icon`、`with_global_tauri`、`enable_gtk_app_id`、`app_directories_override`——相对 v2 是 **additive**，没有把我们用的键拿走。
- `tauri-v3.0.0-alpha.4` 的 breaking 清单（GitHub release notes 实读）只有一条方向性内容：移除 `macos-private-api` Cargo feature 与 `app > macOSPrivateApi` 配置项（透明窗与 `fullScreenEnabled` 不再依赖私有 API）。本仓 `features = []` 且 conf 里没有该项 ⇒ **不吃这条**。

⇒ 迁移到 v3 在我们这边的**代码成本接近零**（2 行版本 + 1 行 `$schema`）。成本全在别处：alpha 本身，和 16.1 那条挡住编译门的 E0080。

### 16.4 「完成迁移到 tauri3」今天的真实含义

1. **目标里的 tauri3 目前是 alpha**：stable 线仍是 2.12.1，3.0.0-alpha.4 发布 4 天。把交付物钉在 alpha 上是产品决定（要不要为它放弃稳定线的补丁节奏），我没有替用户定的授权；本轮只把「能不能钉、钉了要动什么」量出来。
2. **顺序约束**：`capabilities.rs:508` 的 E0080 → 桌面 crate 有编译门 → 才谈得上升 tauri 版本。这条 E0080 归 `xiranite-node-runtime` 那条 lane（文件在途），且它的判据本身已被 ADR-0073 作废，属于「词表退役没退干净」的残留。
3. **不建议做**：为「将来升 v3」预置版本切换 flavor 或适配层——AGENTS.md「不为理论兼容堆抽象」直接否掉。
4. 顺带记目标第一半的两条欠账（同一片地基）：`crates/xiranite-extism-adapter` 仍在根 members（`Cargo.toml:17`）并参与编译，wasm/Extism 退役未完；`crates/nodes/dissolvef`、`crates/nodes/linedup` 仍在 members（`:20/:21`），而用户已判「每节点 Rust 归零、dissolvef 不留」。这两条与 §15.6 的 config 归属都还在等 AGENTS.md 那轮重写落定。
