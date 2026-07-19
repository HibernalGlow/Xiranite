# Xiranite agent instructions

- 在合适的时候提交当前任务中由自己修改的部分，避免暂存区堆积；不得混入用户或其他任务的改动。
- 优先使用 Git Bash；不可用时再使用 PowerShell 7，并确保 UTF-8 编码。
- 前端验证优先编写可重复的自动化脚本或使用 Playwright。尽量不要使用应用内 Browser，因为它的交互和维护成本较高；只有用户明确要求时才使用 Browser。
- Windows 开发机内存预算有限：NeoView 的 build、typecheck、Vitest、Playwright、性能审计和原生构建必须严格串行，前一进程完全退出后才能启动下一项；Vitest 使用 `--maxWorkers=1`。即使工具支持并行调用也不得并发执行这些重任务，避免 esbuild/Vitest/原生编译共同触发系统提交内存耗尽。
- NeoView 数据边界：节点设置沿用其他节点的配置机制，写入 `xiranite.config.toml` 的 `[nodes.neoview]`；`xiranite.db` 只存放 Xiranite 项目自身的工作区和 XR 运行数据，NeoView 迁移不得在其中新增 Reader 业务表。NeoView 的缩略图、阅读进度、历史、书签及兼容业务数据继续使用原 `%APPDATA%/NeoView/thumbnails.db`，通过 `xr_` 命名空间独立表和可回滚 schema migration 非破坏性扩展；不得修改旧表、索引、`metadata.version`、`user_version` 或 journal 设置，确保新旧 NeoView 可同时使用该库且不得另建第二个 NeoView 主库。
- NeoView TOML 规范写入保留 `[nodes.neoview]` 根表和 `[nodes.neoview.reader]`、`[nodes.neoview.panels]` 等一级业务分区，分区内更深对象与对象数组使用 inline table/inline array；读取端必须继续兼容旧深层嵌套表、全量 `config = { ... }` envelope 和迁移期混合格式，混合冲突时 `config` 优先。验收与告警命令见 `docs/neoview-config-format.md`。
- NeoView Card 迁移必须先建立旧源码逐控件清单，再实现和验收；逐项覆盖菜单、选项值、字段、快捷键、状态、持久化、生命周期、性能和 GUI/CLI/TUI 共用契约。UI 默认保持旧版层级、控件、图标语义、标签、信息密度、交互状态与响应式几何，任何有意偏离必须写明替代契约。事实源和门禁见 `migration/neoview/card-acceptance-contract.json`、对应 Card compatibility JSON 与 `docs/neoview-card-functional-checklist.md`，不得用 Card 标题、能力摘要、后端 API 或 smoke UI 代替完整清单。
- 每张 NeoView Card 在编写生产 React 实现前，必须先用 `svelte/compiler` 与 OXC AST 生成可重复的 TSX 原型并审阅；原型至少冻结 DOM/组件层级、图标 import、class、条件块、循环、控件类型/属性、事件和 unsupported 节点。随后使用终端脚本生成旧版 `1920x1080` characterization 截图，再基于原型实现并记录有意偏离。AST 原型不能直接视为完成实现，生产源码不得 import `migration/neoview/frontend/tsx-scaffold`。
