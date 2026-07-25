# Melo deck 与 Folia Player 集成契约

## 目标

Melo deck 仍是 Xiranite 标准节点。Folia 提供新的 GUI 播放内核、完整本地播放能力、播放器表面和全部歌词可视化；顶栏、底栏和浮窗只是同一节点状态的特殊投影，标准全屏仍由 Xiranite 节点容器管理。

本契约用于约束首次集成和后续上游同步。实现不得把 Folia 整个应用、在线服务或 Electron 窗口模型嵌入 Xiranite。

## 原组件直接复用

- Melo deck 的可见播放器表面必须直接渲染 Folia 上游 React 组件：顶栏展开态使用 `RemoteControlApp`，底栏使用 `FloatingPlayerControls`，浮窗使用 `UnifiedPanel`；普通节点和标准全屏使用 `Home`、`Grid3D`、`LocalGrid3DView`、`GridMap`、`GridView`、`SearchWorkspace`、`VisualizerRenderer` 与 `FloatingPlayerControls` 组成的原版应用表面。
- Xiranite 只维护受控状态、命令、主题、字体、i18n、文件 URL 和节点容器适配；不得在 Xiranite 或 player 包内复制、改写或重新拼装一套“Folia 风格”的同类 JSX/CSS。
- 上游组件不能受控复用时，应在 Folia 源码中增加可选的 controlled/embedded 契约，让 Folia 原应用和 Xiranite 消费同一组件实现；无适配属性时必须保持原 Electron 行为。
- `@hibernalglow/folia-player` 可以通过同一 checkout 的相对路径引用 Folia 上游组件。组件所需的浏览器运行依赖必须声明在 player 包中，不得依赖 Folia Electron 应用偶然安装的依赖。
- Electron 窗口控制、在线账号、视频导出等宿主专属能力留在 Folia 原入口。嵌入模式隐藏不适用的操作，不伪造成功状态。
- 直接组件复用必须用有曲目、封面和同步歌词的 Vitest Browser Mode 用例验收，并断言真实上游组件已挂载；空状态截图、静态结构检查或仅类型检查不构成视觉完成。

## 播放器所有权

- 一个工作区只挂载一个 GUI 播放内核和一个 `<audio>`。
- 所有 Melo deck 卡片、顶栏、底栏和浮窗显示并控制同一曲目、队列、歌词和进度。
- 启动时恢复上次活动曲目和已保存队列，但保持暂停，不自动播放；这与 Folia 原应用的 `last_song` / `last_queue` 会话恢复语义一致，不恢复播放秒数。
- Folia 是默认 GUI 引擎；现有 `MusicPlayerSurface` 作为 `legacy` 引擎保留。
- `[nodes.melodeck].player_engine` 在 `folia` 与 `legacy` 之间切换。切换时暂停并重挂载，不承诺无缝保留当前秒数。
- CLI/TUI 继续使用现有 mpv 与歌词实现，不依赖 Folia player 包。

## 表面映射

### 常驻顶栏

- 收起态继续使用 Xiranite 原有灵动岛组件、封面、当前歌词或状态与 wave 特效，不用 Folia 另做触发器，也不改变原有宽窄响应式占位。
- 收起态从当前封面提取局部主色，以高色度渐变、内描边和轻微投影染色灵动岛；文字和控件继续使用 Xiranite 对比色 token。没有封面或取色失败时回退到标准顶栏主题。
- 宽窗口常驻显示封面、歌名或当前歌词以及 wave。
- 窄窗口显示封面、wave 和包裹封面的环形进度，不强占标题栏空间。
- 点击收起态后必须由同一个 `DynamicIsland` 容器平滑展开，不得在标题栏下另弹一张独立卡片。
- 展开态直接使用 Folia Remote Control 的封面双栏卡片；播放器主体以外不再叠加 ambient、popover 或第二层卡片背景。
- 进度条和封面始终显示；控制区 hover 时显示时间与播放操作，空闲 800ms 后切换为歌词。
- 卡片尺寸在内容切换时保持稳定；点击外部收起。
- 展开态不增加底栏、底边、外层背景或第二层卡片；右上角直接显示底栏、浮窗、标准全屏、隐藏和更多五个 20px 透明图标，不使用按钮底色、胶囊或边框。
- “更多”只承载顶栏波形调整；波形子菜单包含“无波形”和全部真实动画预览。预览模块只在更多菜单打开后加载，菜单关闭即卸载预览节点。波形选择继续写入 Melo deck 的 `visualizer_style`，播放引擎切换不进入该菜单，仍由节点或浮窗设置提供。

### 底栏

- 使用 Folia 底部播放条的布局和动效。
- Folia 播放条本身就是底栏投影，不再套 Melo deck 背景卡、ambient 层或第二层边框；节点同款操作栏只作为高层悬浮 chrome。
- 封面融合进主播放按钮；播放或暂停图标作为封面蒙层。
- hover 时显示完整控制；移出约 300ms 后收紧到约 48px。
- 紧凑态保留封面播放按钮、歌名、单行当前歌词和贴底进度。
- 收紧只改变视觉占位，不改变播放、拖动进度或模式状态。

### 普通节点与浮窗

- 普通节点无论内容区宽度或高度都保持 Folia 原版应用表面，不切换为 `UnifiedPanel`；窄宽和矮高适配完全交给 Folia 原组件自身的响应式布局。
- 节点首次挂载默认显示原版 Home，点击原版播放条后进入歌词 renderer，歌词页返回按钮回到 Home。嵌入模式左上角品牌显示 `Meloddeck`，且只有本地来源，因此隐藏无切换价值的顶部来源 tab，同时保留搜索、地图选歌、GridView 选曲、导入和刷新入口。
- Home 的地图、分类、导入和刷新控制保持浮层，可以覆盖轮播画布或卡片经过的区域，但不得与搜索框互相贴靠或遮挡；窄容器下操作组自动换到第二行，独立 Folia 的原始位置保持不变。
- Home 与歌词页不得各自重建播放器。`VisualizerRenderer` 在 Home 下继续挂载并关闭歌词正文，只负责渲染 Folia 原版的封面驱动背景；Home 作为半透明上层覆盖其上。
- Folia `UnifiedPanel` 卡片本身就是浮窗，不再放入 760px Melo deck 玻璃窗口、ambient 层、独立标题行或第二层卡片。嵌入属性只改变定位和尺寸，不改变 Folia 独立应用的默认行为。
- 节点同款操作栏叠在卡片顶部；整张卡片、操作栏所在整行和展开后的拖动图标都可启动同一套 Motion 拖动，位置继续持久化。
- 浮窗支持临时收起为 Folia 原生圆形入口，外层以 layout spring 同步缩到 48px；圆形入口外圈显示当前播放进度，点击恢复完整卡片。临时收起不卸载播放器，也不等同于隐藏 dock。
- 卡片外层透明并允许阴影与进度环溢出；圆角裁剪只由 Folia 卡片自身负责，避免底部阴影被矩形外壳截成尖角。
- 节点容器缩放不得重建共享 `<audio>`，切换页面，或重置当前曲目、队列、进度和播放状态。

### 标准全屏

- 全屏通过工作区标准 `ComponentCard` 状态实现，继续使用节点顶部工具栏。
- 标准全屏与普通节点使用同一个 Folia 原版应用表面，只由 Xiranite 标准节点容器改变几何尺寸。
- 顶栏或浮窗请求全屏时复用当前 Melo deck 卡片；没有实例时创建规范实例。
- “更多”菜单提供“全屏时同步打开浮窗”选项，默认关闭。关闭时进入标准全屏会收起全局浮窗；开启时才保留浮窗投影。
- 工具栏下方内容区渲染 Folia 原版 Home、全部歌词 renderer、背景和 `FloatingPlayerControls`；歌词页同时保留原版 `UnifiedPanel` 右下角按钮及弹出卡片，卡片内返回主页动作接回 Home。原版歌词返回按钮进入 Home，点击原版播放条返回歌词页。
- 不保留 Melo deck 自建的全局 fixed 全屏层，也不复制 Folia 的窗口控制 chrome。

## 首次功能范围

接入：

- 多个本地音乐根目录、扫描与元数据
- 曲库封面后台预取；非活动曲目只读取元数据与封面，活动曲目再完整加载歌词
- 队列、循环、音量、ReplayGain 和输出设备
- 封面、歌词匹配、逐字歌词、翻译与和声
- Folia 全部歌词 renderer、背景模式及其设置
- Remote Control、底部播放条和 UnifiedPanel

暂不接入：

- 在线音乐源与账号系统
- AI 主题生成
- 视频导出
- Discord、OBS 与 Stage
- Electron 专属窗口能力

这些能力可以继续存在于 Folia 原应用，但必须位于独立入口，不进入 Melo deck 首次 bundle。

## 主题与字体

- Xiranite 主题是基础视觉事实源，并实时转换为 Folia `DualTheme`。
- `backgroundColor` 映射 `--background`。
- `primaryColor` 映射 `--foreground`。
- `accentColor` 映射 `--primary`。
- `secondaryColor` 映射 `--muted-foreground`。
- Folia sans/mono 字体分别映射 `--font-app-sans` 与 `--font-app-mono`，并跟随用户字体覆盖。
- Melo deck 不允许单独覆盖基础颜色和字体。
- 主题集成只能通过 Folia 的 `DualTheme`、`isDaylight` 和字体参数完成；不得让 `.xiranite-node-surface`、自定义主题的通用 button/card 选择器或其他宿主 CSS 改写 Folia 内部 DOM。
- Xiranite 继续负责外层节点边框、工具栏和全屏容器；Folia 内部按钮、卡片、玻璃层、层级、动画和封面背景完全由 Folia 自己的组件与样式维护。
- Folia 的动画强度、关键词着色、歌词图标、背景后处理和 renderer tuning 原样保留。
- 封面取色可以作为局部可视化输入，但不得覆盖 Xiranite 控件主题。

## 配置与存储

- `[nodes.melodeck]` 是用户配置的唯一事实源。
- 新配置使用版本化的 `playback`、`visualizer`、`surfaces` 与 `library` 分区。
- `surfaces.follow_fullscreen_with_floating` 保存全屏与浮窗联动偏好，缺省值为 `false`。
- `playback.active_track_id` 保存最后活动曲目；队列继续由 `saved_tracks` 保存。找不到旧曲目时回退到队列首曲，且不自动播放。
- 现有 `source_path`、`saved_tracks`、`mode`、`floating_offset`、`visualizer_style`、`volume`、`mpv_path` 和 `ipc_path` 非破坏迁移。
- 现有单路径迁移为 `library_roots = [source_path]`，读取端继续兼容旧字段。
- Folia host storage adapter 只保存不适合 TOML 的元数据、封面、歌词与自定义背景缓存。
- Xiranite 中不使用 Folia 原有的配置 localStorage 键，也不保存浏览器 `FileSystemHandle`。
- 本地文件由 Xiranite 后端扫描并提供稳定 URL。

## i18n

- Folia player 保留自己的翻译资源和 key。
- Xiranite adapter 将资源注册到共享 i18n 实例的 `folia-player` namespace。
- 包不得创建第二个 i18next 实例。

## 仓库与上游同步

- `HibernalGlow/folia-major` 的 `main` 跟随原项目上游。
- 长期分支 `xiranite-player` 维护 `@hibernalglow/folia-player`、host adapter 契约和必要的核心拆分。
- Xiranite 通过 `vendor/folia-major` submodule 固定具体 commit，并通过包名导入，不直接引用 Folia 内部路径。
- Xiranite 专属 TOML、后端文件服务、workspace 和主题 adapter 留在 Xiranite 主仓库。
- 更新流程：同步 `upstream/main`，更新 fork `main`，合并进 `xiranite-player`，运行包测试，再更新 Xiranite gitlink。
- 不使用 `.gitignore` 隐藏上游已跟踪源码。
- 包及其修改保留 Folia 的 AGPL-3.0 信息。

## 验收门禁

- 当前正式支持和阻塞发布的目标是 Windows/Wails 与 Windows GitHub Actions；非 Windows 构建暂不要求通过，但 player 包、配置协议和 host adapter 保持平台中立，不在共享 React/TypeScript 代码中直接绑定 Windows API。
- GitHub Actions 必须递归检出 submodule，且 `bun install --frozen-lockfile` 必须能将 `vendor/folia-major/packages/player` 解析为本地 workspace 包；workspace 链接保留 player 对同一 Folia checkout 上游源码的相对引用。

- 以有曲目、有封面、有同步歌词的真实填充状态验收，不以空卡或编译通过代替。
- 验证宽顶栏、窄顶栏、底栏紧凑/展开、普通节点在窄/宽/矮容器中的原版应用、浮窗和标准全屏。
- 验证所有表面同步同一播放进度，且任一时刻只有一个 GUI `<audio>`。
- 验证 Xiranite 主题与字体切换后所有 Folia 表面和 renderer 实时更新。
- 验证 Home 下原版 Visualizer 背景仍在渲染、歌词正文已隐藏，且 Folia 内部控件未被 Xiranite 节点通用样式覆盖。
- Browser Mode 主流程必须覆盖：紧凑节点默认进入 Home → 验证嵌入品牌与控制/卡片不重叠 → 放大节点 → 地图选歌 → GridView 聚焦并点击原版播放按钮 → 原版播放条进入歌词 → 返回 Home → 再次进入歌词 → 同时缩窄并降低节点；全程保持原版应用、当前页面、当前曲目和唯一一个 `<audio>`。
- Browser Mode 必须用至少两首初始无 `coverUrl` 的曲目验证：恢复的活动曲目走完整 hydration、其他曲目在未选择和未播放时走受限并发 preview hydration、所有封面最终可见、播放器保持暂停且仍只有一个 `<audio>`。
- 验证切换到 legacy 引擎后原播放器仍可用，CLI/TUI 测试不受影响。
- 重任务严格串行：focused Vitest、类型检查、构建、Vitest Browser Mode；仅真正的 Wails 跨进程行为使用宿主集成测试。
