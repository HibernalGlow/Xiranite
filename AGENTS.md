# Xiranite agent instructions

## Neoxide / mImageViewer 界面与核心复用

- Neoxide 是原 mImageViewer 核心之上的另一套 egui UI。以 XR NeoView 节点的实际 Web 源码和截图为基准，尽量一比一还原层级、密度、图标语义、控件状态、泳道和交互；保留 mImageViewer 的全部原有能力及可到达入口，禁止用简化图片浏览器替换原核心。
- 媒体解码、缓存、预取、调整、AI、持久化和原生 GPU 路径继续由原核心负责。可复用的领域契约与纯逻辑不得依赖 egui/eframe/Tauri/Wails；UI 和宿主是薄适配层，便于以后由 `native/` 工作区中的 napi-rs 包装供 Xiranite NeoView 节点复用同一份 Rust 能力。
- 通用控件优先复用版本兼容的成熟 crate（包括 egui-shadcn、hello_egui 生态），统一 Design Tokens；不要为迁就最新 UI 包而破坏现有 egui/wgpu 原生补丁。记录版本、许可证、平台、包体、运行时和替换成本。
- 泳道、导航栏、可折叠 Card 等成熟复合组件须提供独立、可复用的 crate/API、稳定 ID、受控状态、事件与示例，不得绑定 NeoView 的文件系统、数据库或全局 App。原则与验收边界见 `docs/neoxide-native-ui-contract.md`。
- 同一套 Neoxide egui UI 必须能在原生 Windows 与 WASM/WebGPU 上渲染。UI 依赖图不得引入文件系统、数据库、Win32 或本机解码；浏览器通过宿主/服务适配层获取媒体和结构化结果，不能另写一套 Web UI。WASM 构建必须实际验证。

- Native Rust build, test, and Clippy tasks must run serially with one Cargo job. Use `RUSTC_WRAPPER=sccache` whenever `sccache` is available, but do not make it a required Cargo configuration. Limit task-scoped Clippy to `cargo clippy -p <crate> --all-targets --no-deps -j 1 -- -D warnings`. Native package build scripts must auto-detect `sccache` and fall back cleanly when it is unavailable.
- Keep Xiranite's Node-API wrappers in the shared `native/` Cargo workspace. Prefer versioned crates.io dependencies for upstream Rust cores; import core source locally only when Xiranite must maintain real core changes. Do not add Git crate or fork dependencies unless the user explicitly reauthorizes them. Preserve upstream attribution and licenses when importing source.
- 添加新功能或审查现有手写实现时，先检查成熟且维护活跃的包或框架是否已经覆盖通用能力。若 API、许可证、平台兼容性、运行时/包体成本和维护状态可接受，且性能无损或只有经过基准证明的轻微下降，优先复用该依赖，减少重复基础设施代码；不得用依赖替代 Xiranite 的领域语义、平台 adapter 或已证明的性能热路径。引入前记录关键取舍和验证结果，后续相同能力不得重新手写；不要仅因流行或代码行数更少而增加依赖。
- **UI 组件与功能依赖复用原则**：
  1. **UI 组件禁止重复手搓**：新增或重构 egui / 前端 UI 组件时，严禁自行手写基础通用控件（按钮、卡片、输入框、下拉菜单、标签栏、模态框等）；优先参考成熟组件库与设计系统规范（如 [`egui-shadcn`](https://github.com/pjankiewicz/egui-shadcn)、[`ouroboros-ui`](https://github.com/Type-zero-labs/ouroboros-ui)），采用统一的 Design Tokens、交互状态（Hover/Active/Focus/Disabled）、动画与复合控件布局范式，保持工业级质量与视觉一致性。
  2. **所有新功能优先使用已有 crate**：任何新功能开发前必须系统调研 crates.io 现有生态；若存在多个候选 crate，必须从 API 人机工学、许可证契约、平台兼容性（原生 Windows 与 wasm32 WebGPU 双端支持）、维护活跃度、二进制体积与运行时性能等维度做技术对比，选择最合适的一个并在文档中记录决策理由。

- 提交当前任务的修改时优先使用 `bun run commit "<message>" <path>...`，仅列出本任务拥有的文件；脚本使用 `git commit --only`，不得混入或清空其他任务已经暂存的内容。

- 在合适的时候提交当前任务中由自己修改的部分，避免暂存区堆积；不得混入用户或其他任务的改动。
- 优先使用 Git Bash；不可用时再使用 PowerShell 7，并确保 UTF-8 编码。
- 前端组件、交互、布局与视觉回归统一使用 Vitest Browser Mode，测试命名为 `*.browser.test.tsx`，通过 `bun run test:browser -- <测试文件>` 直接挂载目标组件；禁止为普通前端验证新增 Playwright spec 或临时 Playwright 探针。`@vitest/browser-playwright` 只作为 Vitest 的浏览器 provider，不使用 Playwright test runner。纯逻辑和无需真实布局的状态测试继续使用普通 Vitest；真正的 Wails 跨进程/原生窗口行为使用 Go 或宿主集成测试。遗留 Playwright 用例仅保留兼容，触达相关功能时优先迁移到 Vitest Browser Mode。详细规范见 `docs/frontend-testing.md`。尽量不要使用应用内 Browser，只有用户明确要求时才使用。
- Windows 开发机内存预算有限：NeoView 的 build、typecheck、普通 Vitest、Vitest Browser Mode、遗留 Playwright、性能审计和原生构建必须严格串行，前一进程完全退出后才能启动下一项；Vitest 使用 `--maxWorkers=1`。即使工具支持并行调用也不得并发执行这些重任务，避免 esbuild/Vitest/浏览器/原生编译共同触发系统提交内存耗尽。
- 当前只维护 Windows/Wails 的正式编译、运行与发布门禁；非 Windows 构建暂不作为交付阻塞项，但共享 TypeScript、包契约与 host adapter 不得硬编码 Windows API 或封死后续 Linux/macOS host 实现，平台专属能力必须隔离在 adapter/desktop 边界。
- 测试、性能探针或临时诊断需要 HTTP 后端时，必须使用 `bun scripts/test-backend.ts --ttl-seconds <秒数>`，或在同一进程中使用该文件导出的 `startIsolatedTestBackend()` 并在 `finally` 中 `await close()`；禁止用裸 `startBackend()`、`bun --eval` 或临时脚本连接默认 `%LOCALAPPDATA%/Xiranite/xiranite.db` 后无限等待。隔离 helper 默认在首次加载 backend 前设置 `XIRANITE_NODE_SOURCE=1`，NeoView 诊断不得无意使用可能过期的 `dist`；只有明确验证生产构建产物时才可预先设置 `XIRANITE_NODE_SOURCE=0`。测试后端必须使用独立临时数据目录、设置有限 TTL，并在结束后确认监听端口与进程均已退出。正常开发会话使用 `bun run dev:*`，结束时运行 `bun run dev:stop`。
- 只有明确要复现真实用户数据库问题且获得用户授权时，诊断脚本才可访问默认 `xiranite.db`；必须只做最小操作、输出底层错误 cause，并用 `try/finally` 关闭 repository/backend，不得把一次性真实库写入脚本留在仓库中。
- NeoView 数据边界：节点设置沿用其他节点的配置机制，写入 `xiranite.config.toml` 的 `[nodes.neoview]`；`xiranite.db` 只存放 Xiranite 项目自身的工作区和 XR 运行数据，NeoView 迁移不得在其中新增 Reader 业务表。NeoView 的缩略图、阅读进度、历史、书签及兼容业务数据继续使用原 `%APPDATA%/NeoView/thumbnails.db`，通过 `xr_` 命名空间独立表和可回滚 schema migration 非破坏性扩展；不得修改旧表、索引、`metadata.version`、`user_version` 或 journal 设置，确保新旧 NeoView 可同时使用该库且不得另建第二个 NeoView 主库。
- NeoView TOML 规范写入保留 `[nodes.neoview]` 根表、一级业务分区及最多一层相关项分组；`card_state` 等集合在二级表中每个相关对象一行 inline table，对象数组每个对象一行，禁止把整个集合压成单个超长行。读取端必须继续兼容旧深层嵌套表、全量 `config = { ... }` envelope 和迁移期混合格式，混合冲突时 `config` 优先。验收与告警命令见 `docs/neoview-config-format.md`。
- NeoView Card 迁移必须先建立旧源码逐控件清单，再实现和验收；逐项覆盖菜单、选项值、字段、快捷键、状态、持久化、生命周期、性能和 GUI/CLI/TUI 共用契约。UI 默认保持旧版层级、控件、图标语义、标签、信息密度、交互状态与响应式几何，任何有意偏离必须写明替代契约。事实源和门禁见 `migration/neoview/card-acceptance-contract.json`、对应 Card compatibility JSON 与 `docs/neoview-card-functional-checklist.md`，不得用 Card 标题、能力摘要、后端 API 或 smoke UI 代替完整清单。
- 每张 NeoView Card 在编写生产 React 实现前，必须先用 `svelte/compiler` 与 OXC AST 生成可重复的 TSX 原型并审阅；原型至少冻结 DOM/组件层级、图标 import、class、条件块、循环、控件类型/属性、事件和 unsupported 节点。随后使用终端脚本生成旧版 `1920x1080` characterization 截图，再基于原型实现并记录有意偏离。AST 原型不能直接视为完成实现，生产源码不得 import `migration/neoview/frontend/tsx-scaffold`。
- NeoView 配置协议新增或解析代码变更时，开发态由 dev supervisor 监听 `packages/nodes/neoview/src` 并自动重启后端、更新 backend manifest；不得因此手动重建 `dist`，也不得重启 Vite 或桌面窗口。Reader 配置接口优先使用显式 `section` + `patch` 协议，由 section registry 统一登记、校验和分派，再交给共用配置服务持久化与广播；旧的 section 对象格式必须继续兼容。

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
