# Xiranite agent instructions

## 目标架构：Rust + Tauri 2 彻底重写（不留兼容层）

- 重写方向由 `docs/adr/0063-rewrite-backend-in-rust-with-tauri2-axum-extism.md` 定版：React 19 产品层与既有 HTTP/Operation 协议保留，业务后端改为 Rust + Tokio + Axum，插件执行只用 Extism，桌面宿主用 Tauri 2 取代 Wails/Go；Bun 只做开发与构建工具，不进入成品。**这是彻底迁移：不兼容旧前端、不做双栈并行、不保留过渡中间件。**
- **Plugin API 是稳定契约，Extism 只是当前适配器**（`docs/adr/0068-keep-the-plugin-api-wit-migratable-with-extism-as-adapter.md`）：分层固定为 Xiranite Plugin API → Extism Adapter → `plugin.wasm`，业务代码与插件清单只引用 API 概念，不得直接依赖 Extism ABI、线性内存所有权或 `extism:host/env`。跨边界类型必须能用 WIT 自然表达（string/bool/定宽整数/float/record/variant/enum/list/option/result/不透明 handle），禁止 `usize`/`isize`/裸指针/Rust trait object/lifetime/serde 技巧/Extism 专属结构；JSON 只是适配器内部的编码，`OpaquePayload` 不许当万能接口。大数据走 host 分配的 `FileHandle`/`OperationHandle` + 分块能力调用，不在单次调用里来回复制巨块。Host function 按能力命名空间（`xiranite.fs.*`、`xiranite.operation.checkpoint/update/emit`、`xiranite.process.run`、`xiranite.scheduler.acquire/release`、`xiranite.log`、`xiranite.now`），每个都有类型化请求与响应；插件生命周期与 Operation 生命周期分离（一个插件服务多个 operation，跨边界调用一律带 `operation_id`）；错误必须是 `PluginError { code, message, details? }` 且能力失败返回 result 信封而不是 trap；清单区分 `pluginVersion`/`pluginApiVersion`/`runtimeVersion`，Xiranite 版本不等于 Plugin API 版本。不提前实现 Component Model、不引入 WIT 工具链、不为理论兼容堆抽象——任何新增接口先回答「这能不能自然转成 WIT」，否则重新设计而不是用 Extism 机制焊死。
- Wails、Go、Deno Desktop、Bun 内嵌运行时、独立 backend 子进程、backend restart、Windows process containment、external node launch 与 node app packaging 都属于**待删除的旧层**：禁止在其上新增能力、新增测试或新写适配器；只允许为让删除后仍能构建而做的最小收敛。
- 重写在本仓原地进行，写在 GitButler 分支 `xiranite-rust-rewrite` 上（同一工作树，不另建新仓）；随宿主替换逐条改写本文件中以 Wails/Bun 为前提的规则，不得让旧规则与新架构并存。
- 保留哪些节点由 `docs/xiranite-target-node-manifest.json` 单一真源决定，`bun run audit:target-node-manifest` 是门禁：名单、`xiranite.build.toml` 与 `packages/nodes/` 目录三者漂移即红。每个保留节点的 WASM 可行性必须由 `bun run audit:node-feasibility`（`packages/tauri-migrate` 的 ast-grep 分析器）产出，再用 `bun run audit:target-node-manifest -- --apply-feasibility artifacts/node-wasm-feasibility.json` 回填；`--strict` 下仍写 `pending-audit` 即失败，禁止凭节点名口头判定能否插件化。已有更专业独立项目的节点不再复刻：`arcthumb`/`czkawka`/`xlchemy` 已删，`neoview` 也已由用户判定出局（阅读器能力归独立的 neoview 仓库），依据与边界见 `docs/adr/0064-drop-nodes-covered-by-standalone-projects.md`；`enginev` 与 `trename` 明确**保留并 Rust 重写**；`clipm` 与 `lata` 搁置不删。
- 节点出局不等于其脚下的原生能力出局，但**只为某个已出局节点存在的能力不算能力**：回收站 trash/restore/list（`native/czkawka-core`）仍供给 `packages/file-operations`，必须作为 `xiranite-core` 宿主服务保留；`native/arcthumb-core` 的缩略图此前只服务 NeoView，NeoView 出局后它没有存活消费者，随该节点一起评估删除，不得当成通用能力硬留。消费点逐条见 ADR-0064。
- **语法树是迁移的事实源**（`docs/adr/0067-use-ast-inventories-as-migration-source-of-truth.md`）：凡「前端不用改」「HTTP 协议平移不缩水」「某节点可 WASM 化」的断言，都必须有 `packages/tauri-migrate` 的 ast-grep 产物与差集门禁背书；残留判定按 import 说明符/成员表达式扫描，不用裸 grep 字符串。

## 构建与依赖复用

- Native Rust build, test, and Clippy tasks must run serially with one Cargo job. Use `RUSTC_WRAPPER=sccache` whenever `sccache` is available, but do not make it a required Cargo configuration. Limit task-scoped Clippy to `cargo clippy -p <crate> --all-targets --no-deps -j 1 -- -D warnings`. Native package build scripts must auto-detect `sccache` and fall back cleanly when it is unavailable.
- Keep Xiranite's Node-API wrappers in the shared `native/` Cargo workspace. Prefer versioned crates.io dependencies for upstream Rust cores; import core source locally only when Xiranite must maintain real core changes. Do not add Git crate or fork dependencies unless the user explicitly reauthorizes them. Preserve upstream attribution and licenses when importing source.
- 添加新功能或审查现有手写实现时，先检查成熟且维护活跃的包或框架是否已经覆盖通用能力。若 API、许可证、平台兼容性、运行时/包体成本和维护状态可接受，且性能无损或只有经过基准证明的轻微下降，优先复用该依赖，减少重复基础设施代码；不得用依赖替代 Xiranite 的领域语义、平台 adapter 或已证明的性能热路径。引入前记录关键取舍和验证结果，后续相同能力不得重新手写；不要仅因流行或代码行数更少而增加依赖。
- **UI 组件与功能依赖复用原则**：
  1. **UI 组件禁止重复手搓**：新增或重构前端 UI 组件时，严禁自行手写基础通用控件（按钮、卡片、输入框、下拉菜单、标签栏、模态框等）；优先参考成熟组件库与设计系统规范，采用统一的 Design Tokens、交互状态（Hover/Active/Focus/Disabled）、动画与复合控件布局范式，保持工业级质量与视觉一致性。
  2. **所有新功能优先使用已有 crate**：任何新功能开发前必须系统调研 crates.io 现有生态；若存在多个候选 crate，必须从 API 人机工学、许可证契约、平台兼容性（原生 Windows 与 wasm32 WebGPU 双端支持）、维护活跃度、二进制体积与运行时性能等维度做技术对比，选择最合适的一个并在文档中记录决策理由。

- 版本控制写操作一律走 GitButler：重写的提交放在分支 `xiranite-rust-rewrite` 上，用 `but commit -b xiranite-rust-rewrite -m "<message>" <path>...` 只提交本任务拥有的文件；提交前 `but status`/`but diff` 确认归属，不得混入或清空其他任务未提交的改动。回退只用 `but undo`，禁止 `git reset --hard`、禁止 push、禁止删分支。

- 在合适的时候提交当前任务中由自己修改的部分，避免暂存区堆积；不得混入用户或其他任务的改动。
- 优先使用 Git Bash；不可用时再使用 PowerShell 7，并确保 UTF-8 编码。
- 前端组件、交互、布局与视觉回归统一使用 Vitest Browser Mode，测试命名为 `*.browser.test.tsx`，通过 `bun run test:browser -- <测试文件>` 直接挂载目标组件；禁止为普通前端验证新增 Playwright spec 或临时 Playwright 探针。`@vitest/browser-playwright` 只作为 Vitest 的浏览器 provider，不使用 Playwright test runner。纯逻辑和无需真实布局的状态测试继续使用普通 Vitest；真正的宿主跨进程/原生窗口行为（Tauri Core 进程、窗口、托盘、文件拖放）用 Rust 集成测试验证，旧的 Wails/Go 跨进程测试随旧层一起删除，不在其上补新用例。遗留 Playwright 用例仅保留兼容，触达相关功能时优先迁移到 Vitest Browser Mode。详细规范见 `docs/frontend-testing.md`。尽量不要使用应用内 Browser，只有用户明确要求时才使用。
- Windows 开发机内存预算有限：build、typecheck、普通 Vitest、Vitest Browser Mode、遗留 Playwright、性能审计和原生构建必须严格串行，前一进程完全退出后才能启动下一项；Vitest 使用 `--maxWorkers=1`。即使工具支持并行调用也不得并发执行这些重任务，避免 esbuild/Vitest/浏览器/原生编译共同触发系统提交内存耗尽。
- 正式编译、运行与发布门禁的对象改为 **Tauri 2 + Rust 宿主（Windows 优先）**；Wails/Go/Bun 那套门禁随旧层退役，不再作为新增能力的落点。非 Windows 构建暂不作为交付阻塞项，但共享 TypeScript、包契约与 host adapter 不得硬编码 Windows API 或封死后续 Linux/macOS host 实现，平台专属能力必须隔离在 adapter/desktop 边界；Rust 侧同理，平台专属代码必须落在明确的 target 边界内。
- 迁移期不得为了「旧前端还能跑」而保留双栈或加代理层：Axum 侧按 ADR-0063 直接提供 `/operations` 族协议，前端只在 `runtime/{web.ts,tauri.ts}` 换 transport。任何「先留着以后删」的兼容中间件都必须先在 ADR 里成为一条被否决的替代方案，否则不许落盘。
- 测试、性能探针或临时诊断需要 HTTP 后端时，必须使用 `bun scripts/test-backend.ts --ttl-seconds <秒数>`，或在同一进程中使用该文件导出的 `startIsolatedTestBackend()` 并在 `finally` 中 `await close()`；禁止用裸 `startBackend()`、`bun --eval` 或临时脚本连接默认 `%LOCALAPPDATA%/Xiranite/xiranite.db` 后无限等待。隔离 helper 默认在首次加载 backend 前设置 `XIRANITE_NODE_SOURCE=1`，节点诊断不得无意使用可能过期的 `dist`；只有明确验证生产构建产物时才可预先设置 `XIRANITE_NODE_SOURCE=0`。测试后端必须使用独立临时数据目录、设置有限 TTL，并在结束后确认监听端口与进程均已退出。正常开发会话使用 `bun run dev:*`，结束时运行 `bun run dev:stop`。Rust/Axum 后端起来后，同一条纪律改成「用带独立临时数据目录与有限 TTL 的一次性宿主，并在 `finally` 关闭」，`scripts/test-backend.ts` 与 Bun 侧隔离 helper 随旧后端一起删除，不得两套并存。
- 只有明确要复现真实用户数据库问题且获得用户授权时，诊断脚本才可访问默认 `xiranite.db`；必须只做最小操作、输出底层错误 cause，并用 `try/finally` 关闭 repository/backend，不得把一次性真实库写入脚本留在仓库中。

## 代码结构与 AI 可读性

- 维护中的源码单文件上限为 1000 个物理行，800 行开始预警。适用范围包括 `src/`、`packages/`、`scripts/`、`cmd/`、`native/` 和 `examples/` 中的 TS/TSX/JS/JSX/Rust/Go/CSS/Svelte/Vue 等源码；`vendor/`、生成物、构建产物、迁移快照、测试附件和资源文件不计入。使用 `bun run check:source-size` 检查当前改动，使用 `bun run audit:source-size` 查看全仓库债务。
- 已经超过 1000 行的历史文件不要求在本任务中一次性重写，但新文件不得超过上限；修改历史超长文件时不得继续增加行数，并应在边界清晰时拆出类型、状态、适配器、服务、路由或测试模块。复杂功能若确实不能拆分，必须在变更说明中记录理由和后续拆分点。
- 每个模块只负责一个清晰的领域边界。入口文件负责组装，领域语义留在领域模块，平台差异留在 adapter/desktop 边界，持久化、HTTP、UI 和纯逻辑不要互相穿透。公共入口保持薄，避免把整个功能堆进一个组件、控制器或 `index` 文件。
- 代码必须便于下一次 AI 定位：使用完整、稳定、可搜索的领域命名；避免无意义缩写、隐式全局状态、跨文件复制的魔法字符串和过度压缩的一行表达式。类型、输入输出契约、错误边界和副作用应靠近实现或集中在明确的 contract 文件中。
- 前端遵守“纯 TS 核心、框架薄适配”原则：领域逻辑、数据转换、校验、状态机、选择器和策略优先写成不依赖 React/Svelte/Vue 的纯 TS 模块；框架层负责视图、生命周期、事件绑定和组件组合。公共 contract 不得反向依赖具体前端框架，方便未来替换框架。
- 框架可替换性不以牺牲性能、美观、组件模块化或编写便利为代价。不要为了抽象而抽象，不要把成熟的组件库能力重新手写，不要在渲染热路径增加通用 adapter、重复对象创建或额外订阅；性能敏感代码必须保留现有快路径，并用实际基准或渲染测试证明没有回归。
- 前端新增依赖必须说明它解决的具体问题，以及 API、许可证、包体、运行时开销、维护状态和替换成本；能用现有依赖或纯 TS 清晰解决时，不新增框架绑定依赖。框架专属依赖集中在 UI/adapter 边界，不能渗透到共享 domain、contract 和平台无关服务。
- 注释只解释原因、约束、兼容性或不明显的生命周期；不要用注释复述代码。需要复杂推理时，先拆成有名字的纯函数或小模块，再补一段短的设计注释。
- AI 修改代码前必须先阅读目标文件的消费者、相关类型/协议和最近的测试；修改后必须说明改动边界、验证命令和未验证风险。禁止为了“顺手整理”大范围格式化、重命名或改写无关文件。
- 新增或修改前端交互、布局和视觉行为继续遵守 Vitest Browser Mode 规则；纯逻辑使用普通 Vitest，跨进程/宿主行为使用 Go 或集成测试。完整约定见 `docs/code-quality.md`。
