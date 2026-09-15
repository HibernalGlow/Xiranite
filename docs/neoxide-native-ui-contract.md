# Neoxide 原生界面与复用契约

用户于 2026-09-14 确认：在原 mImageViewer 核心上额外提供一套 egui UI，基本一比一复刻 XR NeoView 节点的 Web 体验，同时保留 mImageViewer 特性。此约束延续 [ADR-0060](adr/0060-preserve-neoxide-core-for-ui-redesign.md)。独立客户端和国际化的后续完整验收仍以 ADR-0061、ADR-0062 为准。

同日追加确认：同一套 UI 必须在 WASM 上渲染。浏览器入口显式启用 eframe/wgpu 的 WebGPU 路径，不同时启用默认 Glow；共享界面不依赖 Win32、文件系统或数据库。浏览器通过宿主/服务契约消费原核心能力，原生平台继续走原生 GPU 快路径。

## 不可替换的核心

`vendor/neoxide/vendor/mimageviewer` 是原媒体应用的事实源。新的桌面入口必须进入它的应用生命周期，复用原文件浏览器、Reader、历史、收藏、多页签/多窗口、解码、预取、调整、AI、PDF/ZIP、动画、视频、缓存、写入队列和宿主窗口行为。不得以 `image::open`、同步 `read_dir`、独立的页签模型或独立的内存历史/收藏列表模拟这些能力。NeoView 卡片只是原控件的布局容器和视觉皮肤；渲染新外壳不能提前返回并跳过原有 worker、对话框、任务取消或退出处理。

新界面保留经典界面和原生工具入口。没有完成迁移的原生功能直接调用现有实现；不得放置看似可用的空按钮或把这种转接称为完成 Web 控件复刻。媒体 GPU 快路径由原宿主拥有，不把帧像素来回复制到另一个 UI 引擎。

## 可复用边界

| 层 | 允许依赖 | 责任 |
| --- | --- | --- |
| 领域核心 / workspace model | Rust 标准库、serde、已采用的纯核心 crate | 稳定 ID、布局规则、状态转换、可序列化命令与结果；不读用户配置 |
| egui 复合组件 | 领域模型、egui、组件库 | 泳道、导航、Card、交互和主题；由调用者提供内容 |
| NeoView 风格外壳 | 复合组件、只读视图模型、宿主回调 | 按 Web 清单组织视图，发出动作 |
| mImageViewer adapter | 原 App、原命令、外壳 | 转发既有能力，维持原资源所有权和生命周期；文件浏览器、Reader、历史、收藏和页签均以原 App 状态为唯一事实源 |
| Node-API adapter | 同一份可复用 Rust 核心、napi-rs | 留在 Xiranite `native/` Cargo workspace；不引入第二份阅读引擎 |

`crates/neoxide-core` 和 `tauri/` 中此前添加的简化读取实现不是 mImageViewer 的替代品。接入 Xiranite 前必须逐项核实真实核心能力，不能因导出了同名 DTO 就宣布原生核心迁移完成。当前 UI 工作不写 Xiranite 或 NeoView 的真实数据库。

### 上游同步边界

`vendor/neoxide/vendor/mimageviewer` 是独立的上游 Git 子模块。Neoxide 只在确实无法通过公开 API 完成适配时，向该子模块增加带 `neoxide-host` feature gate 的窄扩展；扩展必须保持 `mimageviewer::run()` 默认路径字节级不变，不能修改解码、缓存、worker 或持久化实现。同步上游时优先将这类扩展作为可重复 cherry-pick 的单独提交处理；所有可复用的泳道、Card、WASM host、Node-API adapter 和配置逻辑仍放在主仓库 `crates/`、`native/` 与 `docs/`。

## 组件选型（2026-09-14）

| 候选 | 结论与依据 |
| --- | --- |
| crates.io `egui-shadcn = 0.5.0`（FerrisMind/shadcn-rs） | MIT，支持 egui 0.33；已有按钮、输入、菜单、Card 和主题。使用精确版本，关闭可选 plot。API 尚不稳定，限制在 UI crate 内。其 chrono/regex/lucide 依赖需纳入最终包体记录。与 pjankiewicz 的同名 GitHub 项目不同。 |
| `hello_egui = 0.10.0` | MIT；其 `egui_flex 0.5` / `egui_dnd 0.14` 对应 egui 0.33。按需开启 flex/dnd，不引入全家桶、Tokio、网络或图片加载器。布局/拖拽留在 UI 边界。 |
| `hello_egui 0.13` | 当前上游使用 egui 0.36；本轮不升级已有 egui 0.33 补丁链。 |
| `egui_tiles 0.14` / `egui_dock` | 适合平铺或 IDE 停靠，但 pane/tab tree 语义不等于 Web 的有序泳道、44px 折叠、独占和横向定位；不替换泳道领域状态。 |
| `pjankiewicz/egui-shadcn` | egui 0.33 + egui_flex 0.5，MIT；核查版本 0.1.0 未在 crates.io 发布。优先采用已发布的兼容组件库，不添加 Git crate 依赖。 |

以上为 manifest/API/许可证核查，不能当作运行性能或 Windows/WASM 已通过的证据。最终验证记录须区分纯逻辑、离屏截图、原生构建与真实窗口/视频行为。

## 复刻基准与验收

详细来源见 [NeoView 外壳逐控件清单](neoxide-ui-reference.md)。至少覆盖：

- `ReaderSwimlaneWorkspace`：有序泳道、真实标题栏、44px 折叠、按实际相邻关系缩放、最小宽度、独占与返回、窄窗口可达、稳定状态。
- `ReaderLaneNavigator`：图标定位、激活状态、按比例适应、添加/删除自定义泳道及停靠；不能拿文件名字母跳转轨代替泳道导航。
- `ReaderSidebar` / `ReaderPanelBar`：正确左右默认入口、选中态、滚动内容、普通与独占 Card 的层级。
- 阅读工具条与底栏：只向原核心发出真实动作；状态来自核心，不在 UI 另建播放、阅读或调整状态机。
- 原生功能：打开、翻页、PDF/压缩包、调整/预设/AI、动画/视频、书签、历史、设置、任务与退出仍可到达。
- 文件浏览器卡片：沿用 mImageViewer 的多选、排序、搜索、ZIP/PDF 虚拟目录、缩略图和批量操作，并支持多个原生阅读上下文以页签呈现；页签切换不得复制或重建 Reader 状态。
- Reader 卡片：沿用 mImageViewer 的分页、缩放、旋转、适应模式、见开/方向、动画/视频和全屏路径；卡片标题栏只转发原有命令。
- 历史与收藏卡片：直接绑定 mImageViewer 的历史/收藏查询、排序、续读和写入队列，禁止在 Neoxide UI 中维护第二份数据。

通用组件使用无 I/O fixture 和 egui_kittest 验证交互与截图；Web 几何需要刷新时使用 Vitest Browser Mode。所有重型检查严格串行、Cargo `-j 1`，可用时使用 sccache。真实桌面输入和用户数据不属于离屏测试。

## `.neoxide` 设置边界

`.neoxide/config.toml` 是 Neoxide 自己的模块化设置入口。它保留原 NeoView 的 section 化配置方式：核心设置（原 mImageViewer 设置的镜像与 I18N 文案）、阅读输入绑定、卡片/泳道看板和客户端外壳分别位于独立 section。原 mImageViewer 的设置数据库、历史和收藏仍由 mImageViewer 持有；Neoxide 只保存外壳布局和专项设置，并通过 adapter 提交原核心支持的选项。新 section 必须通过 `SectionPatch` 注册和校验，不能把整份配置压成一个不可扩展的结构。
