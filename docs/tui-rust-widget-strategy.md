# Rust TUI 组件策略：基础控件一律来自库，节点只写自己的组合

- Date: 2026-10-04
- Status: accepted design document（选型已实测，未落代码）
- 约束来源: `AGENTS.md`「UI 组件禁止重复手搓」、`docs/adr/0069-keep-node-cli-tui-gui-triad-with-clap-ratatui-react.md`
  （独立的是 Face，共享的是 Runtime）、`docs/adr/0068-keep-the-plugin-api-wit-migratable-with-extism-as-adapter.md`
- 取代: `packages/cli-runtime/src/tui/opentui/` 里的 23 个 OpenTUI/React 组件（`@opentui/core`、`@opentui/react`、
  `sharp`、`sixel` 随旧层一起删除）

## 0. 怎么读这份文档

第 2 节是生态实测数字（版本/最近发布/下载量/license/MSRV），第 3 节划清 ratatui 自带与必须外购的边界，
第 4 节把今天 23 个 TUI 组件逐个映射到库，第 5 节单独回答「文件树」与「文件对比」，
第 6 节是可门禁的规则，第 7 节是 Tauri（GUI）与 TUI 的分工，第 8 节是 Yazi crate 复用判断与 OpenTUI
交互设计沿用，第 9 节是落地顺序与未决项。

关于探测方式的一条事实：`https://crates.io/api/v1/crates/<name>` **必须带 `User-Agent`**，
否则请求直接失败并显示成 `error sending request for url (...)`。本文件所有数字都是带 UA 现采的。

## 1. 决定

- TUI 用 `ratatui` + `crossterm`，**基础控件不自建**：输入框、多行编辑器、文件树、表格、列表、标签页、
  进度条、滚动条、弹窗、Markdown、ANSI、图片、diff 全部由下表库提供。
- `crates/xiranite-tui-runtime` 只做四件事：主题与 token、Layout 组合、按键映射、把节点定义映射成控件；
  再加 operation 事件订阅桥和 `TestBackend` 快照脚手架。
- 每个节点的 `crates/nodes/<id>/src/tui.rs` 自己决定画面（ADR-0069），共享库不提供「现成的某个节点的界面」。

## 2. 生态实测（2026-10-04，crates.io API）

| crate | 稳定版 | 最近发布 | 下载量 | 用途 |
| --- | --- | --- | --- | --- |
| `ratatui` | 0.30.2 | 2026-06-19 | 56.6M | 入口 crate：Backend、layout、buffer |
| `ratatui-core` | 0.1.2 | 2026-06-19 | 23.2M | 0.30 拆出的核心类型（`Buffer`/`Rect`/`Style`/traits） |
| `ratatui-widgets` | 0.3.2 | 2026-06-19 | 21.9M | 0.30 拆出的内置控件集合；正常入口仍是 `ratatui` |
| `crossterm` | 0.29.0 | 2025-04-05 | 202M | 终端事件、原始模式、鼠标 |
| `tui-input` | 0.15.5 | 2026-09-26 | 2.15M | 单行输入状态机 |
| `ratatui-textarea` | 0.9.2 | 2026-06-12 | 733k | 多行编辑器（`tui-textarea` 的维护分支，原版 0.7.0/2024-10 已停更） |
| `tui-tree-widget` | 0.24.1 | 2026-08-09 | 1.72M | 文件树控件（展开/折叠/选中），依赖 `ratatui ^0.30` |
| `tui-popup` | 0.7.7 | 2026-09-24 | 838k | 弹窗/确认层 |
| `tui-scrollbar` | 0.2.8 | 2026-09-24 | 1.44M | 带分数拇指的滚动条（内置 `Scrollbar` 的增强版） |
| `tui-markdown` | 0.3.10 | 2026-09-25 | 507k | Markdown → `ratatui::Text`（帮助页） |
| `ansi-to-tui` | 8.0.1 | 2026-01-10 | 6.22M | ANSI 序列 → `Text`（日志/命令输出着色） |
| `ratatui-image` | 11.1.0 | 2026-09-17 | 982k | 图片控件：sixel / kitty / iterm2 / 真彩回退 |
| `similar` | 3.2.0 | 2026-08-17 | 210M | diff 引擎（行/词/字符） |
| `throbber-widgets-tui` | 0.11.1 | 2026-06-19 | 958k | 等待动画 |
| `tui-prompts` | 0.6.8 | 2026-09-24 | 189k | **ratatui 内的交互式提示控件**（select/confirm/multi-select/input），补上「TUI 里要弹一个选择器」这块；`tui-select` 实测不存在（404），此项即其替代 |
| `yazi-adapter` | 26.5.6 | 2026-05-05 | 80k | Yazi 的图片协议适配层（sixel/kitty/iterm2 选择），参考实现；主选仍是 `ratatui-image` |
| `tauri` / `tauri-build` | 2.12.1 / 2.7.1 | 2026-10-01 | 34.1M / 33.7M | 统一 GUI 的桌面宿主，见 §9 |
| 模糊匹配 | — | — | — | `fuzzy-matcher` 0.3.7（2020-10，33.6M 下载，skim 在用）、`nucleo` 0.5.0（helix 的匹配器）、`strsim` 0.11.1。长列表过滤不自写算法 |
| `tuirealm` + `tui-realm-stdlib` + `tui-realm-treeview` | 4.1.0 | 2026-05-02 | 243k / 177k / 45k | React 式 TUI 框架（**不采用**，见 §6.3） |

CLI 侧配套（同一天现采）：`clap` 4.6.7、`cliclack` 0.5.6（2026-08-10，3.72M，「inspired by the Clack」）、
`inquire` 0.9.4（2026-02-24，21.5M）。

### 实测不存在（404，别再找）

`ratatui-molecules`、`rtoolbox-tui`、`askama-tui`/`askama_tui`、`tui-scrollwidget`、`pulse-bar`、
`tui-realm`（真名是 `tuirealm`）。另外 **crates.io 上的 `yazi` 是 DEFLATE/zlib 压缩库**，与文件管理器
Yazi 无关（后者在 `github.com/sxyazi/yazi`，内部 crate 形如 `ya-*`，不是可复用的控件库）。

## 3. ratatui 自带 vs 必须外购

`ratatui::widgets`（= `ratatui-widgets` 0.3.2）文档列出的内置控件：`Block`、`BarChart`、`Canvas`、`Chart`、
`Clear`、`Fill`、`Gauge`、`LineGauge`、`List`、`Paragraph`、`Scrollbar`、`Sparkline`、`Table`、`Tabs`、
`Calendar`/`Monthly`。

内置里**没有**的、因此必须由上表库承担的：文本输入、多行编辑、树形浏览、弹窗、Markdown、ANSI 解析、
图片、spinner、diff 呈现。这条边界就是「不许手搓」与「允许自己画」的分界线：
在 ratatui 的 `Block`/`Layout` 之上做组合是允许且必须的；实现一个输入框的光标/选区/剪贴板是禁止的。

## 4. 今天 23 个 OpenTUI 组件的逐一映射

来源清单：`packages/cli-runtime/src/tui/opentui/*.tsx` 的导出符号。

| 现在的组件 | 文件 | Rust 来源 |
| --- | --- | --- |
| `WorkbenchPanel` | `workbench-controls.tsx` | `Block` + `Layout` 组合（容器，不算重造） |
| `WorkbenchHeaderActions` | 同上 | `Tabs` + 焦点环由 runtime 主题给出 |
| `WorkbenchField` | 同上 | 按 `InteractionFieldKind` 分派到下面各行 |
| `WorkbenchButton` / `ClickTarget` | 同上 | `List` item（键盘优先），不画像素按钮 |
| `ExecutionActions` | 同上 | `List` + `tui-popup` 承载危险确认 |
| `ActionTabs` | `action-tabs.tsx` | `Tabs` |
| `Select` | `select.tsx` | `List` + `ListState`（长列表用 `fuzzy` 匹配） |
| `TextInput` | `text-input.tsx` | `tui-input` |
| `MultilineEditor` / `PathListInput` | `multiline-editor.tsx` | `ratatui-textarea` |
| `TerminalSlider` | `slider.tsx` | `LineGauge` + 键处理 |
| `ProgressBar` | `progress-bar.tsx` | `Gauge`（等待态配 `throbber-widgets-tui`） |
| `PreviewTable` | `preview-table.tsx` | `Table` + `TableState` |
| `PathDiff` | `path-diff.tsx` | 见 §5.2 |
| `TerminalImagePreview` | `image-preview.tsx` | `ratatui-image`；`terminal-image-decode-service.ts` 整块删掉 |
| `TerminalHelpScreen` | `help-screen.tsx` | `tui-markdown` + `Paragraph` + `tui-scrollbar` |
| `TerminalTaskQueueScreen` | `task-queue-screen.tsx` | `Table` + 订阅 `xiranite-node-runtime` 的事件 |
| `ActionLauncher` | `action-launcher.tsx` | runtime 的组合层（定义 → 动作列表） |
| `OpenTuiTerminalApp` / `TerminalRoot` / `runner` | `app.tsx`/`runner.tsx` | `crossterm` 事件循环 + runtime 的 app trait |
| `TerminalPreferencesScreen` | `app.tsx` | runtime 的组合层 |
| `TerminalChromeActionsProvider` | `chrome-actions.tsx` | 不需要：Tauri/终端窗口菜单由宿主负责 |

## 5. 两个新明确要求

### 5.1 文件树

- 控件：`tui-tree-widget` 0.24.1（1.72M 下载，2026-08-09 发布，依赖 `ratatui ^0.30`）。这是 `trename`
  Web 侧 `src/nodes/trename/FileTreePanel.tsx`（20 处 `@opentui/core` 引用）在 TUI 里的对应物。
- **遍历不写在 UI 层**：目录枚举/懒加载走 `xiranite.fs.*` 能力（`fs.list` / `fs.stat`，ADR-0068 的能力表），
  节点 TUI 只请求「这个目录的子项」，展开时才请求。理由：遍历是宿主能力，重复实现会让插件与 TUI 各持一份
  目录语义，且 Windows 长路径/隐藏文件规则必须只有一处。
- 交互模型抄 Yazi（见 §7），不抄它的代码。

### 5.2 文件对比 / 路径 diff

- 路径 before/after 的配对语义是 `trename` 的业务，属于插件：diff 结果由 `<id>.wasm` 产出并通过
  `xiranite.operation.emit` 的 `data` 侧车送上来（`z.unknown()` 的结构化负载）。
- 内容级 diff 一律用 `similar` 3.2.0，不自写 LCS。
- 呈现用 `Table`（左右两栏）或 `Paragraph` + `ansi-to-tui` 上色；滚动共用 `tui-scrollbar`。
- 冲突面板 = `Table` + `TableState` + 一个 `tui-popup` 详情。

## 6. 规则（评审与门禁口径）

1. **禁止重造**：输入框、textarea、树、表格、列表、标签页、gauge、滚动条、弹窗、markdown、ANSI、图片、
   diff 算法这十三类，出现在 `xiranite-tui-runtime` 或任何节点 crate 里即 review reject，必须换成上表库。
2. **允许并鼓励**：主题/token、`Layout` 切分、按键映射、把节点定义映射成控件的适配代码、`TestBackend`
   快照脚手架。
3. **不采用 `tuirealm`**：它自带组件协议与事件模型（"inspired by React"），与 ratatui 的 immediate-mode
   写法冲突，且我们的共享层只需要控件不需要框架；`tui-realm-treeview` 也已被 `tui-tree-widget` 覆盖。
4. **模板引擎不做**：`askama-tui` 在 crates.io 不存在，ratatui 的 `Layout` + 组合足以表达我们的画面，
   不引入 DSL。
5. **新增依赖必须回填本文件**：写清它解决什么、API/许可证/平台/体积/维护状态，以及同一能力此前为什么不够
   （AGENTS.md 的依赖复用条款）。同一能力不得第二次重复调研。
6. **验收**：`ratatui::backend::TestBackend` 固定尺寸快照 + 每个节点自己的
   `docs/<node>-tui-visual-review.md`；两者一致才算该节点的 TUI 端口完成。

## 7. Tauri 也在这套选型里（GUI 与 TUI 分工）

Tauri 不是被 ratatui 顶替的选项，而是**另一个面**：本文件只管终端 TUI，统一 GUI 继续走 Tauri。

| 面 | 宿主 | 控件来源 | 数据通路 |
| --- | --- | --- | --- |
| GUI（唯一桌面应用 Xiranite） | `tauri` 2.12.1 + `tauri-build` 2.7.1（2026-10-01 现采） | 现有 React 19 + `src/components` 设计系统，不动 | HTTP → `xiranite-api`（ADR-0065 loopback + bearer token） |
| TUI（每节点一个可执行文件） | `crossterm` 0.29.0 + `ratatui` 0.30.2 | 本文件 §2 的库 | 进程内 → `xiranite-node-runtime` → Extism → `<id>.wasm` |
| CLI（每节点一个可执行文件） | `clap` 4.6.7 + `cliclack` 0.5.6 | Clack 风格 1:1 复刻 | 同上 |

因此三面对同一个插件的调用是同一份 `xiranite-node-runtime`，Tauri 只多承担窗口/托盘/文件拖放这些桌面职责；
`src/nodes/<id>/*.tsx` 不引入任何 ratatui 依赖，`crates/nodes/<id>/src/tui.rs` 也不引入 Tauri 依赖。

## 8. 参考产品与交互设计沿用

### 8.1 Yazi 的 crate 复用（实测，用户提出的点）

Yazi 确实把支撑层发布成了 crates.io 上的 `yazi-*` crate（不是只有 App）：

| crate | 版本 | 最近发布 | 下载量 | license | MSRV | ratatui 依赖 |
| --- | --- | --- | --- | --- | --- | --- |
| `yazi-adapter` | 26.5.6 | 2026-05-05 | 80k | MIT | 1.95.0 | `^0.30.0` ✅ 与 0.30.2 兼容 |
| `yazi-fs` | 26.5.6 | 2026-05-05 | 80k | MIT | 1.95.0 | 无（不依赖 ratatui） |
| `yazi-shared` | 26.5.6 | 2026-05-05 | 106k | MIT | 1.95.0 | 无 |
| `yazi-config` | 26.5.6 | 2026-05-05 | 101k | MIT | 1.95.0 | `^0.30.0` |
| `yazi-macro` / `yazi-codegen` / `yazi-ffi` / `yazi-tty` / `yazi-shim` / `yazi-build` | 26.9.1 | 2026-09-01 | 27k–76k | MIT | 1.95.0 | 无 |

版本是 calver（跟着 Yazi 发布走），且 Yazi 的**界面/控件层并没有发布**（`yazi-rs` 实测 404；crates.io
上的 `yazi` 是同名的 DEFLATE 压缩库）。因此可复用的判断：

- **图片预览**：主选仍是 `ratatui-image` 11.1.0（专职 widget、982k 下载、MIT、MSRV 1.86）；
  `yazi-adapter` 作为「要和 Yazi 的协议行为完全一致」时的替代，代价是 MSRV 提到 1.95、calver 跟随 Yazi、
  并带入它自己的 actor/emitter 约定。
- **文件系统扫描与缓存**：`yazi-fs` 不依赖 ratatui，可以只出现在 `xiranite-core` 的 `xiranite.fs.*` 能力实现里
  评估复用；**绝不允许出现在 UI 层或节点 crate 里**（§5.1 的边界）。
- 其余 `yazi-*` 与我们的需求无交集，不引入。

本机工具链对照：`rustc 1.98.1`，`crates/*/Cargo.toml` 声明 `rust-version = "1.96"`，均 ≥ 1.95.0，
所以 Yazi 系 crate 在 MSRV 上不构成障碍。

### 8.2 交互设计沿用 OpenTUI（用户提出的点）

`@opentui/core` 实测：MIT，0.4.5，仓库 `https://github.com/anomalyco/opentui`（`packages/core`）。它是
TS/React 实现，Rust 侧没有可搬的代码，**可搬的是交互规范**。从
`packages/cli-runtime/src/tui/opentui/app.tsx` 现读的键位与焦点模型：

| 行为 | 现在的实现 | 位置 |
| --- | --- | --- |
| 焦点环 | `tab` / `shift+tab` → `session.moveFocus(controlIds, ±1)` | `:95-97` |
| 返回/退出 | `escape` | `:88` |
| 空闲退出 | `q`（非编辑文本且 `phase !== "running"`） | `:107` |
| 激活 | `return` / `space` | `:116` |
| 标签组内移动 | 焦点在 `section-tabs` 时 `left/up` = −1、`right/down` = +1 | `:99-105` |
| 结果区标签 | `tab-status` / `tab-logs`，`ClickTarget` 分 `focused` 与 `selected` 双态 | `:224-225`、`:394-395` |
| 文本字段编辑 | `up/right` = +1、`down/left` = −1；`backspace`/`delete` 删；单字符 `key.sequence` 追加 | `:368-383` |
| 滚动 | `scrollbox flexGrow={1}` + 显式 scrollbar 前景/背景色取主题色 | `:230` |

规则：`xiranite-tui-runtime` 的键映射层以上表为准——**同一套焦点顺序与键位语义必须保留**，
并且 `focused`（焦点在哪）与 `selected`（已选中/已激活）两种状态要分开建模；节点的 `tui.rs` 只在需要额外
键位时扩展，不重新定义这些公共含义。不沿用：React 调和与 JSX、flexbox 引擎、`@opentui` 的 sixel/sharp
解码路径（换 `ratatui-image`）。画面布局的权威仍然是各节点 `docs/<node>-tui-visual-review.md`，本节只管交互。

### 8.3 交互模型参考

- **Yazi**（`github.com/sxyazi/yazi`，Rust + tokio + ratatui）：按目录懒加载、预览面板与主体分离、
  模式化按键、子进程预取。crate 复用判断见 §8.1。
- 待补：用户提到的第二个参考（记作 ashe）在本机三次检索中未定位到仓库
  （GitHub `ashe terminal file manager` 0 命中、`ashe in:name tui` 只命中无关项目、crates.io 无同名 crate）。
  需要链接再补进本节，不凭猜测引入依赖。

## 9. 落地顺序与未决项

顺序：先 `xiranite-node-runtime`（§1 的订阅桥是 TUI 的前提）→ `xiranite-tui-runtime`（主题 + 事件循环 +
上表库的薄封装）→ 第一个节点 `trename`（它的 Rust core 已在仓库外存在）→ 其余节点按 ADR-0069 逐节点复刻。

未决：

- `ratatui-image` 的后端 feature 组合（sixel/kitty/iterm2/proxy）与 Windows 终端实测范围，落代码时现采；
  若行为需要与 Yazi 完全一致，则按 §8.1 换 `yazi-adapter`。
- ~~长列表模糊匹配用 `tui-select`?~~ 实测 `tui-select` 不存在（404）。TUI 内的交互式选择器用 `tui-prompts` 0.6.8，
  模糊匹配走 `fuzzy-matcher`/`nucleo`；具体选哪个在 `trename` 的目录选择上实测后回填本文件。
- 目录遍历能力的分页语义（`fs.list` 一次返回多少、排序在哪层、是否带缓存）要在 ADR-0068 的能力表里补一条，
  不能由 UI 猜；`yazi-fs` 只作为 core 侧实现的参考，不进 UI 层。
- 根 workspace 的 `target/` 与 `native/` 的构建互不干扰性要实测一次（`native` 已列 `exclude`）。
