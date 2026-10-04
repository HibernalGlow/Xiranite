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

1. rquickjs 在 Xiranite 的 Windows(MSVC x64) 上编译与运行——上游平台表把这一组合标为 experimental（虽然 shipped+tested），
   姊妹项目 Rossi 在 Windows 上发货了，但那是在 `bindgen` + fork 补丁的前提下；本仓要按自己的依赖集（不开 bindgen）实测。
   发布门禁是 Windows，这条只能实机验，也是整个方案的否决点。
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
