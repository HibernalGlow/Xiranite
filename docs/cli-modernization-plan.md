# CLI 与节点命令行后续计划

本文专门记录 Xiranite 节点 CLI 尚未完成的工作、工具选择、迁移规则和验收方式。全局应用现代化路线见 [modernization-strategy.md](modernization-strategy.md)。

## 目标

- 每个节点包都可以作为独立 npm 包安装。
- 命令名可统一改前缀，不在源码和 Taskfile 中散落硬编码命令名。
- 无参数 TTY 启动进入富文本引导式体验。
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

## 仍未完成的问题

### 1. 富文本终端 UI 还没有形成统一标准

之前部分 CLI 只是“能交互”，但视觉上不像 Python Rich/Typer 的体验：

- 面板、标题、提示、错误和 summary 不统一。
- 进度条仍有手写痕迹。
- 部分输出在 PowerShell 编码环境里容易被误判为乱码。
- 还没有自动截图或 ANSI snapshot 验证。

决策：

- `citty` 负责命令解析和子命令。
- `@clack/prompts` 负责 prompt、confirm、select、spinner 等引导式交互。
- `consola` 只作为日志层候选，不作为交互 UI 框架。
- `Inquirer.js` 作为复杂 prompt 备选，但默认优先 Clack。
- `Ink` 只用于需要常驻终端布局的 CLI，不作为所有节点的默认方案。
- 不再手写 prompt loop、错误框、选择器和 spinner，除非库能力确实覆盖不了。

### 2. CLI runtime 需要瘦身

当前 `packages/cli-runtime/src/index.ts` 里仍有若干手写基础设施：

- `parseArgs` 与 `citty` 能力重叠。
- `stripAnsi` 应替换为成熟包。
- `shellQuote` 应替换为成熟包或避免 shell 字符串拼接。
- `renderProgressBar` 可替换为 `cli-progress` 或 Clack spinner/任务状态。
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

用户要求每个命令行都实际系统调用并截图看效果。这不应该靠人工临时截图，而应该固化成测试工具。

推荐方案：

- 新增 `scripts/capture-cli-ui.ts`。
- 使用 `node-pty` 在 Windows 走 ConPTY 启动 CLI。
- 记录原始 ANSI 输出到 `artifacts/cli/<node>/<case>.ansi`。
- 使用 `ansi-to-html` 转成 HTML。
- 使用 Playwright 对 HTML 截图，输出 `artifacts/cli/<node>/<case>.png`。
- 保存 baseline，后续做视觉 diff 或人工审阅。

每个 CLI 至少捕获：

- `x<node>` 无参数 guided 首页。
- 默认路径粘贴流程。
- 一个成功执行 summary。
- 一个错误输入提示。
- `--help`。
- `--json` 或非交互脚本输出。

### 4. 命令名变量化仍需收口

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

### 5. 不再用 Taskfile 调回同一个 CLI

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

### 6. CLI 和 Component 的边界还要继续审计

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

- 不再自己维护一套完整 `parseArgs`。
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

`cli.ts` 内部推荐：

```ts
const CLI_NAME = nodeCliName("<node-id>")

const GUIDED_TASKS = [
  {
    name: "default",
    description: "...",
    input: { action: "...", ... },
  },
]
```

无参数行为：

- TTY: 进入 guided mode。
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
| 架构 | `bun scripts/validate-node-architecture.ts --node <id>` 通过 |

## 迁移顺序

第一批：以 `repacku` 收敛标准

1. 完成 `repacku` CLI runtime 清理。
2. 完成 `repacku` guided UI 截图验证。
3. 完成 `repacku` 前端 Component 调用真实宿主执行验证。
4. 写入验证脚本，防止以后回退到 Taskfile/lata 自调用。

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
- `reinstallp`
- `recycleu`
- `linku`
- `owithu`

这些节点更依赖平台能力。必须明确 platform runtime，避免在 `core.ts` 中直接访问系统。

第四批：网络和长任务节点

- `weibospider`
- `trename`
- 其他 crawler/metadata 节点

这些节点依赖流式进度、取消、重试、网络错误恢复。应等 Node Runner streaming 完成后再做完整体验优化。

## repacku 后续待办

- 修复源码中所有被 PowerShell 显示成乱码但实际可能为 UTF-8 的文案检查方式，统一用 UTF-8 工具读取。
- 确认 `GUIDED_TASKS` 文案在终端中显示正常。
- 将 guided selector 从手写列表迁到 Clack `select`，保留直接粘贴路径能力。
- 将 progress 输出切换到统一 runtime progress API。
- 给 `xrepacku` 增加 pseudo-tty 截图测试。
- 验证 `xrepacku` 从非项目目录启动。
- 验证 `xrepacku compress --path <中文路径> --types image --minCount 1`。
- 验证 `xrepacku guided` 的路径粘贴、剪贴板 fallback、退出、错误输入。
- 验证前端 Repacku Component 的 `host.actions.run` 在 Wails 下能真实执行并更新日志/进度/result。

## 验证命令

单节点：

```powershell
bun --filter @xiranite/node-repacku test
bun --filter @xiranite/node-repacku build
bun scripts/validate-node-architecture.ts --node repacku
```

全仓：

```powershell
bun run typecheck
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
- 只看源码不运行 CLI。
