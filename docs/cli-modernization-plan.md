# CLI 与节点命令行后续计划

本文专门记录 Xiranite 节点 CLI 尚未完成的工作、工具选择、迁移规则和验收方式。全局应用现代化路线见 [modernization-strategy.md](modernization-strategy.md)。

## 本轮交接重点

CLI guided mode 的目标不是给所有命令套同一个 `Entry / Run / Script` 模板。后续实现必须以原始 Python/Taskfile/Rich/Typer 源码体验为基准，先复刻原工具的操作节奏，再用 TypeScript、Clack 和现有 runtime 做体验优化。

核心要求：

- 每个节点迁移前必须先阅读 `docs/aestivus.md` 中的来源映射，并查看对应源项目的 CLI、Taskfile、README、adapter 和前端节点交互。
- guided mode 必须按工具个性设计：`repacku` 是任务选择 + 剪贴板路径，`linedup` 是约定文件/剪贴板/文本过滤，`rawfilter` 是目录扫描与 plan/execute，`marku` 是 Markdown 模块选择，不能做成同一套三行说明外壳。
- 减少手动输入是 guided 的第一目标。优先使用当前目录、剪贴板、默认文件名、配置自动发现、历史/预设、select/multiselect/confirm/spinner；路径或长文本手动输入只能作为 fallback。
- 保持美观，但美观服务于操作。Clack 是普通 guided 默认选择；rich panel 只用于工具状态、结果 summary、错误和少量上下文，不放通用架构说明；Ink 只用于确实需要常驻布局、实时刷新或复杂键盘导航的 TUI。
- 显式子命令仍使用 `citty`，面向脚本化和 JSON 输出；无参数 TTY 才进入 guided。
- 不得破坏原本架构：`core.ts` 纯逻辑，`platform.ts` 承担原生能力，`cli.ts` 不导入 React UI 或 `@xiranite/ui`，`Component.tsx` 仍是无壳内容并通过 `host.actions.run` 请求宿主执行。

## 实时 ToDo

更新时间：2026-07-07

- [x] `bun run audit:node-runtime-risks` 当前 24/24 clean：stale render logs、stale `host.getData` logs、`setRunning(false)` 未放入 `finally`、缺少 `host.actions.run` fallback、PowerShell 非交互/进度污染均已横向修复并审计。
- [x] Playwright 真实浏览器测试当前 32/32 passed，其中真实节点点击覆盖所有 24 个保留节点；`recycleu` 使用限定 C 盘回收站 fixture，`enginev` 使用真实 Wallpaper Engine 路径 `E:\SteamLibrary\steamapps\workshop\content\431960` 加载本地预览图，并断言图片源是 token 保护的 backend `/local-files` 直通 URL，同时直接 GET `img.src` 验证返回 `image/*` 与非空字节；后端 Vitest 已补 `/local-files` 授权、MIME 与真实字节响应测试。
- [x] 节点真实点击套件默认串行执行：Playwright `workers` 默认为 1，避免真实文件、回收站、本地后端和图片直通测试在并发 worker 下互相抢资源；需要临时并发时使用 `XIRANITE_E2E_WORKERS` 覆盖。
- [x] 节点真实点击套件的页面启动等待已从 `networkidle` 改为 `domcontentloaded` + banner/main 可见性断言，避免 Local Backend、operation stream 或图片直通请求让测试误判页面未就绪。
- [x] `audit:node-tests` 已把 `tests/e2e` 纳入 real-run 标记来源；24/24 节点 real-run 均为 yes。
- [x] `migratef` 已补齐 Component 测试：覆盖路径输入、mode、`host.actions.run("migratef")`、dry-run plan、进度日志、result 与复制日志。
- [x] `enginev` 已补齐 CLI + Component 测试：CLI 用真实 Wallpaper Engine fixture 跑 `scan --json`；Component 锁住本地 preview 图片 URL 生成链路。
- [x] `encodeb` 已补齐 CLI + Component 测试，并修复 `--json` 模式进度输出污染；真实 fixture 使用当前 suspicious 字符集合内的文件名。
- [x] `findz` 已补齐 CLI + Component 测试，覆盖真实文件搜索、`host.actions.run("findz")`、结果渲染和复制。
- [x] `formatv` 已补齐 CLI + Component 测试，覆盖真实视频文件扫描、纯 JSON 输出、`host.actions.run("formatv")`、结果渲染和复制。
- [x] `bandia` 已补齐 CLI + Component 测试，覆盖真实文件夹 dry-run 压缩、EFU 导出、压缩模式普通源路径、目标结果渲染和复制。
- [x] `dissolvef` 已补齐 CLI + Component 测试，覆盖真实 nested dissolve/undo、纯 JSON 输出、plan 参数、日志和结果渲染。
- [x] `kavvka` 已补齐 CLI + Component 测试，覆盖真实目录关键词扫描、真实 sibling 移动到 `#compare`、默认 dry-run、结果渲染和复制。
- [x] `lata` 已补齐 CLI + Component 测试，覆盖真实 Taskfile 自动发现、真实 shell 执行、纯 JSON 输出、plan 参数、日志和任务渲染。
- [x] `linku` 已补齐 CLI + Component 测试，覆盖真实目录 symlink/junction、真实 `linku.toml`、纯 JSON 输出、`move_link` 参数和 progress 日志。
- [x] `movea` 已补齐 CLI + Component 测试，覆盖真实目录 scan、真实 JSON plan 移动、纯 JSON 输出、scan 参数、日志和结果渲染。
- [x] `mvz` 已补齐 CLI + Component 测试，覆盖真实 entry 文件、dry-run extract/rename、纯 JSON 输出、默认 dry-run、结果渲染和复制。
- [x] `owithu` 已补齐 CLI + Component 测试，覆盖真实 TOML preview、纯 JSON 输出、register 参数和 progress 日志；测试不写注册表。
- [x] `scoolp` 已补齐 CLI + Component 测试，覆盖真实 Scoop bucket manifest、真实 cache backup、真实 sync TOML dry-run、纯 JSON 输出、cache 参数、progress 日志和复制日志。
- [x] `seriex` 已补齐 CLI + Component 测试，覆盖真实 series 文件 plan、真实移动执行、纯 JSON 输出、plan 参数、progress 日志和复制日志。
- [x] `trename` 已补齐 CLI + Component 测试，覆盖真实目录 scan、真实 rename/undo/history、纯 JSON 输出、scan 参数、progress 日志、JSON 回填和复制。
- [x] `cli-runtime` 已删掉与 `citty` 重叠的手写 `parseArgs/flag*`，新增 `renderCliEvent/writeCliEvent` 统一节点运行事件输出；22 个节点 CLI 的显式命令进度输出已从手写 `[xx%]` 切到 runtime 进度条，`repacku` 原有 `renderProgressBar` 路线保留。
- [x] `repacku` guided 首屏已建立真实 pseudo-tty 视觉测试：Vitest 通过 `node-pty`/Windows ConPTY 系统调用 Bun CLI，捕获 ANSI 到 `artifacts/cli/repacku/guided-entry.ansi`，再用 `@xterm/headless` + `@xterm/addon-serialize` 渲染 HTML，并由 Playwright 输出 `guided-entry.png`；测试断言无 raw control-code 泄漏。
- [x] CLI 视觉捕获已抽成 `scripts/cli-visual-testing.ts`，并新增 `scripts/capture-cli-ui.ts` 手动捕获入口；手动入口必须用 Node 父进程运行 `node --experimental-strip-types scripts/capture-cli-ui.ts ...`，再由 helper 启动 Bun CLI，避免 Bun 父进程 + `node-pty` 在 Windows ConPTY 下残留句柄。
- [x] CLI 引导框架规则已纠偏：普通 guided 默认使用 Clack，Ink 只保留给需要常驻布局/实时刷新/复杂键盘导航的 TUI；`cli-runtime` 不再新增共享 Ink 组件。
- [x] `linedup` 已按原版 `source.txt/filter.txt/output.txt` 习惯重写 guided 流程：core 新增 `analyzeReadLines/findDuplicateLines/explainRemovals` 纯逻辑；cli 复刻原版 rich panel 状态展示（读取统计、发现重复行、过滤统计、移除行/因为包含、被移除/保留的行数、处理完成）；4 种模式（preset-files / clipboard-source / custom-files / inline-text），剪贴板优先；13/13 测试通过。
- [x] `rawfilter` 已从过渡 Ink 迁到 Clack：参考 repacku `GUIDED_TASKS` 模式，内置 5 个任务（basic / name-only / trash-only / shortcuts / plan-only），剪贴板优先，path 直粘优先；10/10 测试通过。
- [x] `marku` 已从过渡 Ink 迁到 Clack：复刻原版 `_interactive_wizard` 体验，`selectRich` 选模块 + `selectRich` 选模式（files/text/exit）+ 剪贴板优先；移除所有 Ink/React 导入；11/11 测试通过。
- [x] `cleanf` 已从过渡 Ink 迁到 Clack：复刻原版 `run_interactive` 体验，core 新增 `PRESET_COMBINATIONS`（advanced/upscale/complete）+ `CleanfPresetCombination` 接口；guided 流程为路径选择（剪贴板/手动）→ 模式选择（预设组合/自定义序号/默认）→ 排除关键词 → 最终确认 → 先 preview 后删除，preview 含统计面板；8/8 测试通过。
- [ ] 每个新增 CLI 测试必须通过 `runProgram()` 或等价导出入口走真实 CLI 解析，真实文件 fixture 放在 `artifacts/test-runs/<node>` 并清理。
- [x] 当前测试矩阵为 24/24 complete；严格审计、包测试、构建与 Chromium desktop Playwright 真实点击回归均已通过；当前全仓 Vitest 为 91/91 files、270/270 tests。
- [ ] 每个新增 Component 测试必须用 React Testing Library + happy-dom 渲染无壳 Component，验证输入、按钮、`host.actions.run`、进度/日志/result 写回。

## 目标

- 每个节点包都可以作为独立 npm 包安装。
- 命令名可统一改前缀，不在源码和 Taskfile 中散落硬编码命令名。
- 无参数 TTY 启动进入按原工具体验设计的富文本引导式流程。
- guided mode 应尽量让用户用方向键、回车、确认、剪贴板和默认值完成操作，少打路径和长参数。
- 显式子命令保持普通 CLI 体验，适合脚本化。
- CLI 不渲染 Xiranite React UI，不导入 `Component.tsx`。
- `core.ts` 是 UI 和 CLI 共享的纯逻辑。
- `platform.ts` 承担文件系统、shell、剪贴板、网络、系统能力。
- `lata` 只作为真正的 Taskfile runner 存在，其他节点不应为了“Taskfile 调自己”而依赖 `lata`。

## 当前已完成的部分

- 命令名前缀从 `xiranite-` 缩短到 `x`。
- `nodeCliName(nodeId)` 和 `sync-cli-bins` 已用于生成 `package.json#bin`。
- `install-cli-shims.ts` 可安装 Windows shim，让 `xrepacku` 等命令从任意目录启动。
- `repacku` guided mode 已改为内置 TypeScript task table，不再生成或调用 Taskfile。
- `repacku` guided mode 已直接调用 `runRepacku()` 和 `createNodeRepackuRuntime()`。
- `repacku` 已移除对 `@xiranite/node-lata` 的依赖。
- `repacku` 的路径粘贴误判问题已修到 guided choice 解析层，粘贴真实目录会直接作为默认任务路径执行。
- `repacku` 的 7z listfile/中文路径问题已通过直接 core/platform 执行路线验证过一次，避免 Taskfile shell hop。
- `repacku` guided 任务选择已迁到 Clack `select`，保留路径直粘入口。
- 测试栈已统一为 Vitest + React Testing Library + happy-dom + MSW + Playwright。
- `test:unit`、`test:e2e`、Playwright 配置与 MSW 测试工具入口已建立；`test:unit` 明确排除 `tests/e2e`，避免 Vitest 误跑 Playwright spec；Playwright 产物写入 `artifacts/playwright*`。
- 全仓测试 import 已从 `bun:test` 迁到 `vitest`，节点包测试脚本统一限定到 `src`，避免 `dist/*.test.js` 污染测试。
- `scripts/audit-node-tests.ts` 已改为检查 core / CLI / Component / 真实运行标记 / Vitest script / 禁止 `bun:test`。
- `repacku` 已建立 core / CLI / Component 测试样板：CLI 测试通过 `runProgram()` 直接调用，Component 测试使用 React Testing Library + happy-dom，真实文件 fixture 放在 `artifacts/test-runs` 并清理。
- `repacku` platform 已去掉 `Bun.file/Bun.write`，改为 Node `fs/promises`，保证独立包不依赖 Bun 全局。
- `linedup` 已建立第二个完整测试样板：CLI 覆盖非交互引导拒绝、JSON 脚本模式、真实文件输入输出；Component 覆盖剪贴板、过滤、复制和下载。
- `rawfilter` 已建立第三个完整测试样板：CLI 覆盖非交互引导拒绝、中文路径 fixture、JSON plan；Component 覆盖 `host.actions.run`、日志/result 写回和复制计划。
- `marku` 已建立第四个完整测试样板：CLI 覆盖非交互引导拒绝、inline JSON、真实文件输入输出；Component 覆盖 `host.actions.run`、日志/result 写回和复制输出。
- `sleept` 已建立第五个完整测试样板：CLI 覆盖非交互引导拒绝、status JSON、countdown dry-run JSON；Component 覆盖宿主执行、stats 刷新和 live/dry 参数传递。
- `cleanf` 已建立第六个完整测试样板：CLI 覆盖非交互引导拒绝、中文路径 preview JSON；Component 覆盖宿主执行、预览结果和日志复制。
- 横向修复：仍使用 unavailable native action 的节点 Component 已统一改为 `host.actions?.run ?? unavailable fallback`，后续补各节点 Component 测试时必须锁住宿主调用。
- 默认 backend node runner 已改为执行时实时转发事件，前端 `host.actions.run` 的 operation stream 不再等节点结束后才回放日志。
- 新增 backend 真实节点集成测试：通过本地 HTTP backend + Eden node client + operation stream，用真实中文/空格路径和 fixture 文件验证 `cleanf`、`rawfilter`、`marku`、`repacku`、`sleept`；`linedup` 通过真实文件 CLI 测试补齐 real-run 标记。
- 当前审计状态：`bun run audit:node-tests` 为 6/24 complete；complete 现在必须包含 core / CLI / Component / real-run，剩余 18 个保留节点仍缺 CLI/Component/real-run 覆盖。

## 仍未完成的问题

### 1. guided CLI 体验需要按源代码重做

之前部分 CLI 只是“能交互”，甚至出现了所有命令共用 `Entry / Run / Script` 说明模板的问题。这不是目标。目标是复刻并优化原工具体验：

- 先读原始 Python CLI、Taskfile、README、adapter 和旧前端节点，确认用户原本怎么操作。
- 保留原本高频路径：剪贴板路径、当前目录约定文件、预设任务、默认确认、dry-run/preview 安全路径。
- 用 Clack 的 `select`、`multiselect`、`confirm`、`text`、`spinner` 改善体验，减少手动输入。
- 面板、标题、提示、错误和 summary 可以统一基础风格，但不能统一成同一个通用说明壳。
- 进度条和日志应走成熟组件或 runtime event formatter，避免手写 `[xx%]`。
- 部分输出在 PowerShell 编码环境里容易被误判为乱码，必须用真实 pseudo-tty 截图和 PNG 判断效果。
- 除 `repacku` 与 `linedup` guided 首屏外，还没有把自动 ANSI snapshot/截图验证推广到全部 CLI 的 Clack 最终形态。

决策：

- `citty` 负责命令解析和子命令。
- `@clack/prompts` 负责 prompt、confirm、select、spinner 等引导式交互。
- `consola` 只作为日志层候选，不作为交互 UI 框架。
- `Inquirer.js` 作为复杂 prompt 备选，但默认优先 Clack。
- `Ink` 只用于需要常驻终端布局的 CLI，不作为所有节点的默认方案。
- 不再手写 prompt loop、错误框、选择器和 spinner，除非库能力确实覆盖不了。
- 不再新增通用 `Entry / Run / Script` 模板；如果需要首屏说明，也必须是该工具自己的任务状态、默认来源和安全提示。

### 2. CLI runtime 需要瘦身

当前 `packages/cli-runtime/src/index.ts` 已先收掉一部分手写基础设施：

- `parseArgs` 与 `flagString/flagNumber/flagBoolean` 已删除；节点显式命令继续统一走 `citty defineCommand`。
- `renderCliEvent/writeCliEvent` 已作为节点运行事件输出入口，显式命令进度输出不再散落手写 `[xx%]`。
- `renderProgressBar` 已修复纯文本下 filled/empty 同字符导致看不出比例的问题，并补 Vitest 覆盖中文宽度、ANSI-free 宽度和 event formatter。
- `stripAnsi` 应替换为成熟包。
- `shellQuote` 应替换为成熟包或避免 shell 字符串拼接。
- 剩余过渡 Ink 节点内部的 `setLines([xx%])` 还没有统一到 runtime event formatter，迁到 Clack 时应结合 pseudo-tty 截图一起改。
- `rich` wrapper 可以保留很薄的一层，也可以直接暴露 chalk/picocolors。

推荐拆分：

```text
packages/cli-runtime/src/
  command.ts       citty 封装、runMain、错误处理
  naming.ts        NODE_CLI_PREFIX、nodeCliName、normalizeNodeCliName
  prompts.ts       clack 封装
  output.ts        consola/chalk/boxen/宽度处理
  progress.ts      spinner/progress 标准接口
  testing.ts       pseudo-tty 测试辅助
```

### 3. guided CLI 需要截图级验证

用户要求每个命令行都实际系统调用并截图看效果。这不应该靠人工临时截图，也不应把手动命令 smoke 当验收，而应该固化成测试工具。

推荐方案：

- 已新增 `scripts/cli-visual-testing.ts` 与 `scripts/capture-cli-ui.ts`。
- 手动捕获脚本使用 Node 父进程运行：`node --experimental-strip-types scripts/capture-cli-ui.ts --node <node> --cli <path> --case <case> --wait <text>`；不要用 Bun 作为父进程直接跑 `node-pty`。
- 使用 `node-pty` 在 Windows 走 ConPTY 启动 CLI。
- 记录原始 ANSI 输出到 `artifacts/cli/<node>/<case>.ansi`。
- 使用 `@xterm/headless` + `@xterm/addon-serialize` 按真实终端语义渲染 HTML，避免普通 ANSI-to-HTML 工具不理解光标移动和清屏序列。
- 使用 Playwright 对 HTML 截图，输出 `artifacts/cli/<node>/<case>.png`。
- 保存 baseline，后续做视觉 diff 或人工审阅。
- 所有产物必须写入 `artifacts/` 或其他 `.gitignore` 覆盖目录，测试结束后能清理的 fixture 必须清理。

每个 CLI 至少捕获：

- `x<node>` 无参数 guided 首页。
- 默认路径粘贴流程。
- 一个成功执行 summary。
- 一个错误输入提示。
- `--help`。
- `--json` 或非交互脚本输出。

### 4. 节点测试验收矩阵

每个仍保留的节点必须按同一套测试框架验收，不能用“手动跑过命令”替代：

- 测试框架统一使用 Vitest；测试文件从 `vitest` 导入 `describe/test/expect/vi` 等 API。
- `core.test.ts`：覆盖纯逻辑、边界输入、失败路径、dry-run/undo/计划类输出。
- `cli.test.ts`：通过导出的 `runProgram()` 或 `cli.run()` 调用 CLI，覆盖 `--help`、`--json`、非交互错误、至少一个成功脚本化流程；需要真实文件时使用 `artifacts/test-runs/<node>` 并清理。
- `Component.test.tsx`：用 React Testing Library + happy-dom 渲染无壳 Component，mock `NodeHostApi`，覆盖输入、按钮、`host.actions.run` 调用、进度事件、结果/日志写回。
- HTTP/RPC 相关测试使用 MSW mock 网络边界，不直接打真实外部服务。
- 需要 TTY 富文本视觉时，使用 pseudo-tty + ANSI snapshot/截图测试，输出到 `artifacts/cli/<node>`。
- 真实浏览器、窗口尺寸、截图/视觉回归使用 Playwright，放在 `tests/e2e`，不混入节点 npm 包自身测试。
- 测试不得写入未忽略路径，不得依赖系统 TEMP 中包含 `tmp/temp/cache/logs` 等会触发节点黑名单的路径。

### 5. 命令名变量化仍需收口

目前 `nodeCliName()` 已解决包内显示名和 `bin` 生成，但还要继续检查：

- 文档中是否仍硬编码旧 `xiranite-*`。
- CLI 帮助文本是否硬编码 `xrepacku` 之类命令名。
- Taskfile 或示例命令是否仍使用原版 Python 命令名。
- Windows shim 文件名是否随 `NODE_CLI_PREFIX` 更新。
- 外部安装路径是否已加入用户 PATH。

原则：

- 源码里展示当前命令名时调用 `nodeCliName(nodeId)`。
- 文档可以举例，但要说明来自 `NODE_CLI_PREFIX`。
- 机器生成的 `package.json#bin` 不手改。
- 后续如果要去掉前缀，只改 `NODE_CLI_PREFIX`，再运行同步和 shim 安装脚本。

### 6. 不再用 Taskfile 调回同一个 CLI

原 `repacku` 的 Taskfile 本质是：

```yaml
image-only: repacku compress --clipboard --types image --delete-after
gallery-pack: repacku compress --clipboard --gallery --delete-after
gallery-and-single: repacku compress --clipboard --gallery --single --delete-after
single-pack: repacku compress --clipboard --single --delete-after
```

这种 Taskfile 没有独立业务价值，只是把参数组合藏在 YAML 里。迁移到 Xiranite 后应改成 TypeScript task table。

规则：

- 如果 Taskfile 只调用当前 CLI，加参数组合，必须内置成 TS guided task。
- 如果 Taskfile 编排多个外部工具，或者确实是用户项目任务入口，才交给 `lata`。
- 节点包不得依赖 `lata` 来启动自己的 guided mode。
- guided task 必须最终调用本包 `core.ts + platform.ts`，不要 shell 回自己的二进制。

### 7. CLI 和 Component 的边界还要继续审计

节点包必须遵守：

- CLI 不导入 `Component.tsx`。
- CLI 不导入 `@xiranite/ui`。
- CLI 不导入 Xiranite app 路径。
- Component 不导入 `platform.ts`。
- Component 不直接做文件系统、shell、注册表、网络 crawler。
- Component 只能通过 `host.actions?.run` 请求宿主执行原生能力。
- `core.ts` 不导入 React、Ink、DOM、Bun、process、node:*。

需要把这些规则继续放进 `scripts/validate-node-architecture.ts`：

- 非 `lata` 节点不得依赖 `@xiranite/node-lata`。
- 非 `lata` 节点不得包含包内 `Taskfile.yml`。
- 非 `lata` 节点不得 import `runLataTaskSelector`。
- 源码不得硬编码 `xiranite-*` 旧命令名。

## CLI 工具选择

### citty

保留。它适合当前需求：

- 子命令和 typed args 足够轻。
- unjs 生态小而稳定。
- 和 Bun/ESM 兼容自然。

使用边界：

- 不再自己维护一套完整 `parseArgs`；当前工作区内只剩安装脚本的局部 shim 参数解析。
- 每个节点的显式命令都用 citty `defineCommand`。

### Clack

作为 guided mode 默认选择。

适合：

- select、text、confirm。
- 轻量 spinner。
- 现代 CLI 视觉。
- 无需 React runtime。

不适合：

- 多区域常驻布局。
- 实时表格或复杂 TUI。

### Ink

保留为高级模式，不默认铺开。

适合：

- 需要像应用一样持续更新的终端 UI。
- 多列布局、键盘导航、实时列表。

限制：

- 不能复用节点的 `Component.tsx`。
- 不能导入 `@xiranite/ui`。
- 只能作为 CLI 内部终端渲染层。

### consola

适合作为日志层，不适合作为 guided UI 主框架。

用途：

- info/warn/error/success 统一格式。
- 非交互模式输出。
- 调试开关和日志级别。

### Inquirer.js

作为备选。它生态成熟，但视觉风格不如 Clack 现代。只有当 Clack prompt 类型不够时再使用。

## 标准 CLI 结构

每个节点包推荐保持：

```text
src/
  core.ts          纯逻辑
  platform.ts      Bun/Node/native runtime
  cli.ts           citty + guided mode
  Component.tsx    shell-less UI content
  index.ts         NodeEntry + public exports
```

结构统一，交互不统一。`cli.ts` 内部必须有 `const CLI_NAME = nodeCliName("<node-id>")`，但 guided flow 要按源工具设计：

- 任务型工具可以有 `GUIDED_TASKS`，例如 `repacku` 把原 Taskfile 的常用任务内置成 TS task table。
- 文件过滤/清理工具应优先自动发现当前目录、剪贴板、默认文件名、dry-run/preview 状态。
- 模块型工具应优先让用户用 select/multiselect 选择模块和预设，而不是手打模块名。
- 长任务应使用 spinner/progress/log summary，而不是把用户带进多行手写输入循环。
- 只有当自动发现和选择都不足时，才用 `text` prompt 请求路径、token 或长文本。

无参数行为：

- TTY: 进入按该工具源代码体验设计的 guided mode。
- 非 TTY: 退出码 2，并输出明确用法。

显式命令行为：

- 正常返回码 0。
- 参数错误返回码 2。
- 执行失败返回码 1。
- `--json` 输出机器可读 JSON，不混入富文本。

## 验证矩阵

每个节点 CLI 迁移完成前至少验证：

| 类型 | 场景 |
| --- | --- |
| 命令名 | `x<node> --help` 可在任意目录运行 |
| 无参数 | TTY 下进入 guided mode |
| 非交互 | 非 TTY 无参数退出码 2 |
| 参数命令 | 主要子命令可执行 |
| JSON | `--json` 无 ANSI 富文本 |
| 路径 | 支持空格、括号、`@`、中文、长路径 |
| 剪贴板 | `--clipboard` 和 guided clipboard fallback 正常 |
| 取消 | Ctrl+C 不留下半执行状态 |
| 宽度 | 80/100/120 columns 不破版 |
| 编码 | PowerShell、Windows Terminal、cmd 下不出现业务输出 mojibake |
| 破坏性操作 | dry-run 或确认机制清晰 |
| 构建 | `bun --filter @xiranite/node-<id> build` 通过 |
| 测试 | `bun --filter @xiranite/node-<id> test` 通过 |
| 真实运行 | 平台节点必须通过 backend HTTP + operation stream + 真实 fixture；纯逻辑节点必须有真实文件或真实文本数据测试 |
| 架构 | `bun scripts/validate-node-architecture.ts --node <id>` 通过 |
| 审计 | `bun run audit:node-tests -- --strict` 通过 |

## 迁移顺序

第一批：以 `repacku` / `linedup` 收敛标准

1. 完成 `repacku` CLI runtime 清理。
2. 完成 `repacku` guided UI 截图验证。
3. 完成 `repacku` 前端 Component 调用真实宿主执行验证。
4. 完成 `linedup` 的 CLI/Component 样板扩展，用作纯逻辑节点参考。
5. 写入验证脚本，防止以后回退到 Taskfile/lata 自调用。

第二批：文件系统批处理节点

- `cleanf`
- `crashu`
- `migratef`
- `rawfilter`
- `findz`
- `movea`
- `formatv`
- `encodeb`

这些节点风险集中在路径、编码、dry-run、删除或移动操作。必须优先补 core tests 和真实临时目录测试。

第三批：系统和包管理节点

- `scoolp`
- `recycleu`
- `linku`
- `owithu`

这些节点更依赖平台能力。必须明确 platform runtime，避免在 `core.ts` 中直接访问系统。

第四批：网络和长任务节点

- `trename`
- 其他 crawler/metadata 节点

这些节点依赖流式进度、取消、重试、网络错误恢复。应等 Node Runner streaming 完成后再做完整体验优化。

已裁剪节点：

- `reinstallp`：低频 Python 本地包重装工具，不再作为 Xiranite 节点维护。
- `weibospider`：低频且维护成本高的微博抓取工具，不再作为 Xiranite 节点维护。

## repacku 后续待办

- 已完成：guided selector 从手写列表迁到 Clack `select`，保留直接粘贴路径能力。
- 已完成：新增 Vitest `cli.test.ts`，通过 `runProgram()` 覆盖非交互错误和 JSON dry-run 成功路径；fixture 位于 `artifacts/test-runs`。
- 已完成：新增 Vitest `Component.test.tsx`，用 React Testing Library + happy-dom 覆盖剪贴板粘贴、`host.actions.run` 调用、进度事件和 result/log 写回。
- 已完成：`platform.ts` 去掉 `Bun.file/Bun.write`，改为 Node `fs/promises`。
- 修复源码中所有被 PowerShell 显示成乱码但实际可能为 UTF-8 的文案检查方式，统一用 UTF-8 工具读取。
- 已完成：`GUIDED_TASKS` 文案已在真实 pseudo-tty 首屏截图中验证，截图产物位于 `artifacts/cli/repacku/guided-entry.png`。
- 显式命令 progress 输出已切换到统一 runtime event/progress API；剩余过渡 Ink guided 内部行状态仍待迁到 Clack 后统一。
- 已完成：`xrepacku guided` 首屏 pseudo-tty 截图测试已接入 `bun --filter @xiranite/node-repacku test`。
- 用测试框架验证 `xrepacku` 从非项目目录启动。
- 用测试框架验证 `xrepacku compress --path <中文路径> --types image --min-count 1`。
- 用 pseudo-tty 测试验证 `xrepacku guided` 的路径粘贴、剪贴板 fallback、退出、错误输入。
- 在桌面集成测试中验证前端 Repacku Component 的 `host.actions.run` 在 Wails 下能真实执行并更新日志/进度/result。

## linedup 当前状态

- 已完成：`core.test.ts` 覆盖去重、过滤、diff row；新增 `findDuplicateLines`、`analyzeReadLines`、`explainRemovals` 测试。
- 已完成：Vitest `cli.test.ts` 覆盖非交互 guided 拒绝、inline JSON 输出、真实文件输入输出。
- 已完成：Vitest `Component.test.tsx` 使用 React Testing Library + happy-dom 覆盖剪贴板、过滤、复制和下载。
- 已完成：`cli.visual.test.ts` 使用真实 pseudo-tty 捕获无参数 guided 首屏，验证 Clack prompt 与 artifacts 输出。
- 已完成：Clack guided 已按原版 `source.txt/filter.txt/output.txt` 习惯重写，core 新增 `analyzeReadLines/findDuplicateLines/explainRemovals` 纯逻辑，cli 复刻原版 rich panel 状态展示（读取统计、发现重复行、过滤统计、移除行/因为包含、被移除/保留的行数、处理完成），4 种模式（preset-files / clipboard-source / custom-files / inline-text），剪贴板优先；13/13 测试通过。
- 已完成：`bun --filter @xiranite/node-linedup test`、`build`、`validate-node-architecture` 均通过。
- 待补：路径输入、成功 summary、错误输入、`--help` 的截图级用例仍需扩展。

## rawfilter 当前状态

- 已完成：Component 修复为调用 `host.actions?.run`，不再固定返回 unavailable native action。
- 已完成：Vitest `cli.test.ts` 覆盖非交互 guided 拒绝、中文路径 fixture、JSON plan 输出。
- 已完成：Vitest `Component.test.tsx` 使用 React Testing Library + happy-dom 覆盖剪贴板、`host.actions.run`、进度日志、result 写回和复制计划。
- 已完成：Clack guided 已从过渡 Ink 迁到 Clack，参考 repacku `GUIDED_TASKS` 模式，内置 5 个任务（basic / name-only / trash-only / shortcuts / plan-only），剪贴板优先，path 直粘优先；移除所有 Ink/React 导入；10/10 测试通过。
- 已完成：`bun --filter @xiranite/node-rawfilter test`、`build`、`validate-node-architecture` 均通过。
- 待补：plan summary、错误输入、`--help` 的截图级用例仍需扩展；执行模式的破坏性移动需要更完整的 dry-run/确认策略测试。

## marku 当前状态

- 已完成：Component 修复为调用 `host.actions?.run`，不再固定返回 unavailable native action；旧 `xiranite-marku` 文案已移除。
- 已完成：Vitest `cli.test.ts` 覆盖非交互 guided 拒绝、inline JSON、真实文件输入输出。
- 已完成：Vitest `Component.test.tsx` 使用 React Testing Library + happy-dom 覆盖剪贴板、`host.actions.run`、进度日志、result 写回和复制输出。
- 已完成：Clack guided 已从过渡 Ink 迁到 Clack，复刻原版 `_interactive_wizard` 体验，`selectRich` 选模块 + `selectRich` 选模式（files/text/exit）+ 剪贴板优先；移除所有 Ink/React 导入；11/11 测试通过。
- 已完成：`bun --filter @xiranite/node-marku test`、`build`、`validate-node-architecture` 均通过。
- 待补：模块输入、成功 summary、错误输入、`--help` 的截图级用例仍需扩展；文件写入和 undo 的真实目录端到端用例还需扩大。

## sleept 当前状态

- 已完成：Component 修复为宿主优先执行；无宿主时才退回浏览器 dry-run。
- 已完成：CLI `--json` 修复为纯 JSON，不再混入进度文本。
- 已完成：Vitest `cli.test.ts` 覆盖非交互 guided 拒绝、status JSON、countdown dry-run JSON。
- 已完成：Vitest `Component.test.tsx` 使用 React Testing Library + happy-dom 覆盖 `host.actions.run`、stats 刷新和 live/dry 参数传递。
- 已完成：`bun --filter @xiranite/node-sleept test`、`build`、`validate-node-architecture` 均通过。
- 待补：pseudo-tty guided 截图测试；真实系统电源动作只能通过 dry-run 和宿主 mock 验证，不能在自动测试中触发。

## cleanf 当前状态

- 已完成：CLI `--json` 修复为纯 JSON，不再混入进度文本。
- 已完成：Vitest `cli.test.ts` 覆盖非交互 guided 拒绝、中文路径 fixture、preview JSON。
- 已完成：Vitest `Component.test.tsx` 使用 React Testing Library + happy-dom 覆盖剪贴板、`host.actions.run`、预览结果写回和日志复制。
- 已完成：backend 集成测试通过真实中文/空格路径 fixture 验证 `cleanf` 可经本地 HTTP backend 与 operation stream 返回真实 preview 结果。
- 已完成：Clack guided 已从过渡 Ink 迁到 Clack，复刻原版 `run_interactive` 体验，core 新增 `PRESET_COMBINATIONS`（advanced/upscale/complete）+ `CleanfPresetCombination` 接口；guided 流程为路径选择（剪贴板/手动）→ 模式选择（预设组合/自定义序号/默认）→ 排除关键词 → 最终确认 → 先 preview 后删除，preview 含统计面板；8/8 测试通过。
- 已完成：`bun --filter @xiranite/node-cleanf test`、`build`、`validate-node-architecture` 均通过。
- 待补：preview summary、错误输入、`--help` 的截图级用例仍需扩展；删除模式需要扩大 dry-run 与确认策略测试，自动测试不得删除 fixture 根外路径。

## 验证命令

单节点：

```powershell
bun --filter @xiranite/node-repacku test
bun --filter @xiranite/node-repacku build
bun scripts/validate-node-architecture.ts --node repacku
bun --filter @xiranite/node-linedup test
bun --filter @xiranite/node-linedup build
bun scripts/validate-node-architecture.ts --node linedup
bun --filter @xiranite/node-rawfilter test
bun --filter @xiranite/node-rawfilter build
bun scripts/validate-node-architecture.ts --node rawfilter
bun --filter @xiranite/node-marku test
bun --filter @xiranite/node-marku build
bun scripts/validate-node-architecture.ts --node marku
bun --filter @xiranite/node-sleept test
bun --filter @xiranite/node-sleept build
bun scripts/validate-node-architecture.ts --node sleept
bun --filter @xiranite/node-cleanf test
bun --filter @xiranite/node-cleanf build
bun scripts/validate-node-architecture.ts --node cleanf
```

全仓：

```powershell
bun run typecheck
bun run test:unit
bun run test:e2e
bun run audit:node-tests
bun run test:packages
bun run build:packages
bun run build
```

shim：

```powershell
bun scripts/install-cli-shims.ts --no-posix
```

外部目录验证：

```powershell
Set-Location $env:TEMP
xrepacku --help
```

## 不再接受的实现方式

- guided CLI 只是纯文本菜单。
- Taskfile 调回本包 CLI。
- 源码硬编码旧命令名前缀。
- CLI 导入节点 `Component.tsx`。
- `core.ts` 直接访问 Node/Bun/文件系统/shell。
- `--json` 混入 ANSI 或富文本。
- 没有真实路径、中文路径、带空格路径验证就声称完成。
- 只用 Component mock 或 fake runner 证明“前端可用”，没有走真实 backend/client/operation stream。
- 只看源码不运行 CLI。
