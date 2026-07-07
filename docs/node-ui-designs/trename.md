# Trename 节点 UI 迁移设计说明

## 基本判断

Trename 是“先扫描生成重命名 JSON，再由用户编辑/导入 JSON，最后校验、执行、撤销”的批量重命名工具。它不适合继续做成一张以大文本框为中心的表单卡片；主界面应该围绕“路径、计划、冲突、执行、历史”组织。

本次迁移目标：

- 节点包 `@xiranite/node-trename` 改为 headless：默认入口只导出 `def` 和 `core`，不再导出 React `Component`。
- 主应用新增 `src/nodes/trename/entry.ts` 和 app-owned `Component.tsx`。
- UI 直接使用主应用 shadcn / app components，不再依赖 `@xiranite/ui`。
- 文件树和结果预览必须使用可视化组件，不再退化为纯文本 `pre` 或单个 textarea。

## 核心任务

1. 扫描一个或多个目录，生成 rename JSON。
2. 导入已有 rename JSON。
3. 显示文件树、待翻译项、已准备重命名项、冲突项。
4. 校验目标路径冲突。
5. dry-run 或真实执行重命名。
6. 查看历史并撤销批次。

## 最常用路径

```text
选择/粘贴目录
-> 扫描
-> 在文件树和 JSON 预览里确认结构
-> 用户外部编辑 JSON 或粘贴回 JSON
-> 校验冲突
-> dry-run
-> 真实执行
-> 必要时撤销
```

## 危险操作

- `rename` 且 `dryRun = false`：会真实改名，必须明确确认。
- `undo`：会按历史批次反向移动路径，也需要确认。
- 多路径扫描：容易误把不同根目录混入同一批次，需要显示路径数量和 base path。

危险操作策略：

- 默认 `dryRun = true`。
- 真实执行按钮使用 destructive/confirm flow。
- 执行确认弹窗必须显示：ready 数、conflict 数、basePath、是否 dry-run、undoPath。
- `undo` 在历史列表里按批次操作，不放成一个不明确的全局按钮。

## 需要预览的数据

- 扫描路径列表。
- basePath。
- rename JSON 分段。
- 文件树：
  - 目录 / 文件图标。
  - pending / same / ready 状态点。
  - `src -> tgt` 的目标名提示。
- 冲突列表：
  - target_exists
  - duplicate_target
  - illegal_chars
  - invalid_extension
  - source_not_found
- 执行结果：
  - 成功 / 失败 / 跳过数量。
  - 操作列表 `originalPath -> newPath`。
- undo history：
  - batch id
  - timestamp
  - description
  - undone 状态
  - operation count

## 运行中用户最关心的信息

- 当前阶段：扫描中 / 待编辑 / 校验中 / dry-run / 执行中 / 完成 / 失败。
- 当前进度百分比和最新事件。
- 当前扫描路径或正在处理的目录名。
- 是否仍处于 dry-run。
- 冲突数是否为 0。

## 成功后用户下一步

- 扫描成功：复制/下载 JSON，或直接进入校验。
- 校验成功：执行 dry-run 或真实重命名。
- dry-run 成功：确认后真实执行。
- 真实执行成功：查看历史、复制结果、必要时撤销。

## 失败时用户需要什么帮助

- 错误消息不要只放日志末尾，要在状态条显式显示。
- 冲突列表要支持按类型聚合，点击后显示源路径和目标路径。
- source_not_found / target_exists 这类错误要显示最小可用路径，不要只显示 JSON 行。
- 如果 backend 不可用，提示切换桌面模式或 CLI，不要让按钮静默失败。

## Surface 布局

### collapsed

显示：

- Trename 图标。
- 状态 badge。
- 一条关键信息：
  - idle：`选择目录`
  - scanned：`总计 N / 待翻译 M / 就绪 K`
  - conflict：`冲突 C`
  - running：`扫描 42%` 或 `重命名 42%`
- 快捷主按钮：
  - idle：扫描
  - ready：校验
  - validated：dry-run

不显示：

- 完整 JSON。
- 高级选项。
- 历史列表。

### compact

适合普通小卡片。

布局：

- 顶部：标题、状态、主要计数、运行按钮。
- 第一行：路径输入 + 粘贴/选择。
- 第二行：模式 segmented control：`普通扫描 / 漏扫模式 / 导入 JSON`。
- 关键开关：`包含根目录`、`隐藏文件`、`dry-run`。
- 下方用 tabs：`树` / `冲突` / `日志`。

要求：

- 所有关键功能可达，但低频参数进 Popover。
- 不增加常驻配置侧栏。
- JSON 文本编辑入口用 Dialog/Sheet 打开，不常驻挤占卡片。

### portrait

适合 Bento 窄高卡片和偏手机竖屏。

布局：

- 上方：路径、模式、关键开关、主按钮。
- 中段：统计 + 文件树。
- 下方：冲突/日志/历史 tabs。

规则：

- 日志和历史必须下沉到下方。
- 文件树优先保留可视高度，避免只剩一行。
- 按钮可以图标化，但必须有 tooltip。

### regular

适合中等卡片。

布局：

- 左侧：输入和关键选项。
- 右侧：文件树/冲突 tabs。
- 底部：状态条 + 最新日志。

### expanded / workspace

适合大 Bento、浮窗、全屏。

布局：

- 顶部工具条：
  - 扫描
  - 导入
  - 校验
  - dry-run
  - 真实执行
  - 复制/下载 JSON
- 左侧面板：
  - 路径列表。
  - 扫描模式。
  - 排除扩展名 / 排除模式 / maxLines。
- 主区域：
  - 文件树画廊式/数据库式视图。
  - 可切换 JSON editor。
- 右侧或下方：
  - 冲突列表。
  - undo history。
  - 运行日志。

大高度要求：

- 当卡片接近整屏高度时，核心开关、当前状态、执行按钮必须在首屏可见。
- 只有文件树、冲突列表、历史、日志允许局部滚动。

## 组件选择

优先使用：

- `@/components/ui/button`
- `@/components/ui/badge`
- `@/components/ui/tabs`
- `@/components/ui/dialog`
- `@/components/ui/popover`
- `@/components/ui/alert-dialog`
- `@/components/ui/scroll-area`
- `@/components/ui/tooltip`
- `@/components/ui/textarea`
- `@/components/ui/input`
- Magic UI `file-tree` 或同类 shadcn-like 文件树组件。

不允许：

- `@xiranite/ui`
- 包内 `CardShell`
- 固定 `min-h-[320px]`
- 固定多列 `grid-cols-[...]` 压缩所有尺寸
- 纯文本树作为最终 UI

## 组件拆分

建议文件：

```text
src/nodes/trename/
  entry.ts
  Component.tsx
  constants.ts
  types.ts
  controls.tsx
  FileTreePanel.tsx
  JsonEditorDialog.tsx
  ResultPanels.tsx
  HistoryPanel.tsx
  Component.test.tsx
```

`Component.tsx` 控制在 800 行以内，理想状态只负责状态编排和 surface 分支。

## 状态字段

主应用 card state：

```ts
interface TrenameCardState {
  pathText?: string
  basePath?: string
  jsonText?: string
  mode?: "normal" | "leak"
  includeHidden?: boolean
  includeRoot?: boolean
  compact?: boolean
  dryRun?: boolean
  excludeExts?: string
  excludePatterns?: string
  maxLines?: number
  batchId?: string
  undoPath?: string
  phase?: "idle" | "scanning" | "ready" | "validating" | "renaming" | "completed" | "error"
  progress?: number
  progressText?: string
  result?: TrenameData | null
  logs?: string[]
}
```

配置字段可保存到统一 TOML：

- pathText
- basePath
- mode
- includeHidden
- includeRoot
- compact
- dryRun
- excludeExts
- excludePatterns
- maxLines
- undoPath

不建议保存到配置：

- jsonText
- result
- logs
- progress

## 运行接口

Component 只能调用：

```ts
host.actions.run<TrenameInput, TrenameData>("trename", input, onEvent)
```

不得直接访问文件系统、shell、Bun、Node API。

## 测试路径

### 包级

- `bun --filter @xiranite/node-trename test`
- `bun --filter @xiranite/node-trename build`
- `bun scripts/validate-node-architecture.ts --node trename`

### React

- collapsed / compact / portrait / regular / expanded / workspace 都能渲染。
- idle 状态显示路径输入和扫描入口。
- 有 JSON/result 时显示文件树和统计。
- conflict 结果显示冲突 tab。
- dry-run off 时点击 rename 出确认弹窗。
- undo history 存在时显示撤销入口。

### 浏览器 QA

```bash
bun run qa:card -- trename matrix --screenshot
```

验收：

- Bento matrix 中右上角 portrait 为窄高形态。
- 文件树在 compact/portrait/expanded 中都是可视结构，不是纯文本。
- 日志在 portrait 下方。
- 大卡片不需要滚动才能看到路径、dry-run、校验、执行按钮。

## 迁移步骤

1. 新建 `src/nodes/trename/entry.ts` 和 app-owned UI 文件。
2. 将 `packages/nodes/trename/src/index.ts` 改为 headless。
3. 删除包内 `Component.tsx`、`Component.test.tsx`、React/UI 依赖。
4. 生成 registry，使主应用加载 `@/nodes/trename/entry`。
5. 补 React 测试和 QA matrix。
6. 跑包级测试、架构验证、typecheck、视觉 QA。
