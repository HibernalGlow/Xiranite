# NeoView 最新功能迁移清单

> 由 `migration/neoview/feature-compatibility.json` 生成。功能证据只取冻结的最新源码 `a4c4e07401e0e0c3e4d77edba096f6fd5b3e0c45`，不再逐提交追踪。不要手工编辑本文件。

## 覆盖摘要

- 功能：30
- 最新后端命令：319，全部已映射
- 最新功能源码：670，全部已映射
- 状态：pending=30，preserved=0，host-replaced=0，import-only=0，removed-with-approval=0
- 完成规则：没有行为测试 ID 的 feature 不得从 `pending` 改为完成状态；性能敏感项还必须具有可复现 benchmark。

## 推进表

| # | ID | 功能 | 状态 | 端 | 命令 | 源文件 | 必须保留的行为 |
| ---: | --- | --- | --- | --- | ---: | ---: | --- |
| 1 | `book-open-close-reload` | 打开、关闭与重新加载书籍 | pending | gui/cli/tui | 7 | 20 | 目录、图片文件和压缩包自动识别<br>失败不破坏当前会话<br>reload 保留可恢复页<br>关闭释放书籍资源 |
| 2 | `file-browser-navigation` | 文件与文件夹浏览、标签页和树导航 | pending | gui/cli/tui | 31 | 111 | 列表/网格/树视图<br>面包屑前进后退<br>多标签与主页<br>虚拟列表<br>目录流取消<br>文件夹预览和评分 |
| 3 | `file-operations` | 文件复制、移动、删除、重命名、回收站与撤销 | pending | gui/cli/tui | 25 | 44 | 批量与单项操作结果逐项报告<br>冲突和只读失败<br>回收站与永久删除<br>取消和撤销<br>系统资源管理器定位 |
| 4 | `archive-index-stream-mutate` | 压缩包索引、流式读取、预热、提取与条目删除 | pending | gui/cli/tui | 27 | 27 | ZIP/ZIP64/CBZ<br>RAR/7z solid 与 non-solid<br>嵌套与加密<br>当前页优先流<br>CRC/损坏包<br>条目删除后索引失效<br>取消无子进程残留 |
| 5 | `page-index-navigation` | 页面构建、排序、跳转与边界行为 | pending | gui/cli/tui | 29 | 39 | 自然排序与媒体优先级<br>LTR/RTL<br>首尾跳转和随机页<br>五种尾页行为<br>generation 取消和旧结果零回写 |
| 6 | `page-layout-modes` | 单页、双页、全景、宽页与连续阅读布局 | pending | gui | 3 | 86 | 封面和末页单页<br>宽页拆分或成对<br>不同尺寸双页对齐<br>全景组合<br>连续长图虚拟窗口<br>旋转后重排 |
| 7 | `zoom-rotate-magnifier` | 缩放、适应窗口、旋转、拖动与放大镜 | pending | gui | 1 | 17 | fit/fill/宽/高/原始/左右对齐<br>有界缩放<br>拖动与捏合<br>临时 fit<br>顺逆旋转<br>放大镜尺寸与倍率 |
| 8 | `image-decode-formats` | 图片格式、方向、尺寸与浏览器直出/转换 | pending | gui/cli/tui | 21 | 37 | JPEG/PNG/WebP/GIF/APNG/AVIF/JXL/SVG<br>EXIF 方向<br>ICC/透明度<br>坏图<br>超大图<br>浏览器直出和转换 fallback |
| 9 | `animated-image-video` | 动图、视频、字幕和播放控制 | pending | gui | 11 | 21 | 动图自动播放与暂停<br>视频进度/音量/倍速<br>字幕轨道<br>切页停止与恢复<br>FFmpeg 缺失诊断<br>视频缩略图 |
| 10 | `preload-stream-scheduler` | 预读、渐进加载、流传输和全局调度 | pending | gui/cli/tui | 26 | 22 | View/Ahead/Background 优先级<br>方向感知预读<br>渐进批次<br>背压<br>快速翻页取消<br>多节点资源配额 |
| 11 | `thumbnail-system` | 统一缩略图生成、持久化、数据库维护与迁移 | pending | gui/cli/tui | 49 | 48 | 原数据库位置沿用<br>只读 schema/WAL 探测<br>批量命中与生成<br>失败记录<br>清理/vacuum/统计<br>V1/V3/V4 兼容迁移<br>视频和归档缩略图 |
| 12 | `cache-lifecycle` | 内存、磁盘、索引和资源缓存生命周期 | pending | gui/cli/tui | 32 | 15 | 真实字节预算<br>pin 和方向淘汰<br>mtime/hash 失效<br>损坏恢复<br>80% hysteresis<br>session close/hibernate 回收 |
| 13 | `super-resolution` | 超分模型、预览、队列、缓存与保存 | pending | gui/cli/tui | 65 | 50 | OpenComic system CLI 探测<br>Upscayl daemon<br>waifu2x/realcugan<br>IllustrationJaNai/MangaJaNai<br>tile/scale/TTA/GPU<br>AVIF/JXL 无损输入<br>取消和保存 |
| 14 | `metadata-dimensions-properties` | 文件信息、图片属性、尺寸扫描和系统元数据 | pending | gui/cli/tui | 14 | 15 | 尺寸/格式/大小/时间<br>批量尺寸扫描<br>归档 entry 属性<br>取消扫描<br>系统 shell 元数据 fallback |
| 15 | `emm-ratings-tags-translation` | EMM 数据库、评分、标签、收藏和翻译 | pending | gui/cli/tui | 34 | 42 | 自动/手动数据库路径<br>评分读写<br>收藏与手动标签<br>collect tag 统计<br>翻译字典<br>批量同步和错误恢复 |
| 16 | `history-bookmarks-progress` | 历史、书签、阅读进度和数据洞察 | pending | gui/cli/tui | 1 | 20 | 记录和恢复进度<br>历史大小与自动清理<br>书签排序/搜索<br>历史与文件树联动<br>热力图和连续阅读统计 |
| 17 | `search-sort-filter-library` | 搜索、排序、过滤、黑名单和快速库 | pending | gui/cli/tui | 9 | 16 | 名称/路径/标签搜索<br>自然排序和正逆序<br>媒体类型过滤<br>排除路径<br>快速库目标<br>大目录流式搜索取消 |
| 18 | `input-bindings-radial-voice` | 键盘、鼠标、触摸、区域、径向菜单和语音控制 | pending | gui/tui | 1 | 38 | 上下文键绑定<br>鼠标单击/双击/按住<br>九宫格区域<br>手势录制<br>冲突管理<br>径向菜单<br>语音命令启停 |
| 19 | `panels-toolbar-shell` | 左右边栏、顶部工具栏、底栏、面板和通知 | pending | gui | 1 | 173 | 顶部标题/工具栏自动隐藏<br>底部缩略图/进度栏自动隐藏<br>左右侧栏独立显隐/固定/浮动<br>四边 hover 触发区和显示/隐藏延迟<br>左右侧栏拖拽宽度/高度/位置/对齐<br>面板排序和跨左右边栏移动<br>关闭边栏不挂载重面板<br>通知样式/位置/占位<br>重启恢复 |
| 20 | `theme-background-empty-state` | 主题接管、阅读背景和空页面背景 | pending | gui | 1 | 14 | 旧主题字段仅导入报告<br>Xiranite 主题接管<br>solid/ambient/aurora/spotlight 阅读背景<br>空页图片/视频背景设置 |
| 21 | `settings-import-export-backup` | 设置、完整导入导出、备份、Gist 和 TOML 统一 | pending | gui/cli/tui | 12 | 45 | 全部非主题字段可识别<br>模块选择<br>merge/overwrite<br>幂等导入<br>完整备份<br>Gist 同步<br>GUI/CLI/TUI 共用 TOML<br>运行时只写 TOML<br>未知字段报告 |
| 22 | `startup-window-cli-lifecycle` | 启动参数、窗口状态、托盘、卡片窗口和生命周期 | pending | gui/cli | 7 | 11 | CLI 路径打开<br>窗口大小/位置恢复<br>最小化托盘<br>卡片窗口恢复<br>单实例导航<br>宿主关闭释放所有进程 |
| 23 | `slideshow` | 幻灯片自动翻页 | pending | gui/tui | 0 | 3 | 开始/暂停<br>间隔<br>循环/随机<br>淡入淡出<br>切书和手动操作协调 |
| 24 | `ai-ollama-translation` | Ollama、AI 面板和翻译服务 | pending | gui/cli | 7 | 24 | 服务探测和模型列表<br>生成请求<br>配置保存<br>取消/错误<br>翻译缓存 |
| 25 | `performance-benchmark-diagnostics` | 性能设置、基准、系统监控和诊断 | pending | gui/cli | 21 | 44 | 冷/热基准<br>算法对照<br>系统 CPU/RSS/GPU 观测<br>任务队列状态<br>报告导出<br>基准不污染用户缓存 |
| 26 | `image-effects-transitions` | 图片裁边、颜色滤镜、页面过渡和悬停滚动 | pending | gui | 0 | 10 | 自动/手动裁边<br>颜色滤镜开关与参数<br>页面切换动画<br>长图悬停滚动和速度<br>切页后清理上一页效果状态 |
| 27 | `card-windows-tabs` | 卡片注册、卡片布局、独立窗口和通用标签页 | pending | gui | 0 | 15 | 卡片注册和动态渲染<br>折叠/排序/显隐<br>卡片独立窗口<br>标签创建/切换/关闭/恢复<br>未知卡片配置兼容 |
| 28 | `playlist-quick-library` | 播放列表和快速库 | pending | gui/cli/tui | 0 | 3 | 创建/删除/重命名播放列表<br>添加和移除书籍<br>播放列表顺序<br>快速库目标增删和打开<br>最终 HEAD 中占位入口需 characterization 后补齐 |
| 29 | `ipc-protocol-transport` | 旧 IPC、内置协议、批处理和 Worker 数据传输迁移 | pending | gui/cli/tui | 3 | 24 | 控制面只传小对象<br>图片字节走 loopback HTTP<br>无 Base64/大 JSON 主链<br>批处理有界<br>取消和背压<br>旧协议设置可导入但不保留双实现 |
| 30 | `platform-clipboard-shell` | 剪贴板和系统集成能力 | pending | gui/cli | 10 | 7 | 复制图片/路径/文本<br>打开方式<br>资源管理器定位<br>快捷方式解析<br>Windows 能力缺失降级 |

## 逐项验收

### 打开、关闭与重新加载书籍（`book-open-close-reload`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`startup.openLastFile`、`startup.openLastFolder`
- 数据：recent books、last file、last folder
- 行为：目录、图片文件和压缩包自动识别；失败不破坏当前会话；reload 保留可恢复页；关闭释放书籍资源
- 测试：`neoview.session.lifecycle`、`neoview.book.detect`、`neoview.book.directory`、`neoview.book.streaming`、`neoview.book.archive`、`neoview.book.single-image`、`neoview.book.cancellation`、`neoview.epub.manifest`、`neoview.epub.stream`、`neoview.epub.validation`、`neoview.epub.cancellation`、`neoview.epub.reader-e2e`、`neoview.control.session`、`neoview.control.validation`、`neoview.control.nested-archive`、`neoview.control.encrypted-archive`、`neoview.http.e2e`、`neoview.react.control`、`neoview.react.smoke`、`neoview.react.lifecycle`、`neoview.react.cbz-e2e`、`neoview.headless.session`、`neoview.cli.inspect`、`neoview.cli.reader-e2e`、`neoview.tui.reader`
- 性能基准：无专项
- 已知差异：无

### 文件与文件夹浏览、标签页和树导航（`file-browser-navigation`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`fileBrowser.sortField`、`fileBrowser.sortOrder`、`folderPanelSettings.homePath`
- 数据：folder tabs、navigation history、quick folders、tree pins
- 行为：列表/网格/树视图；面包屑前进后退；多标签与主页；虚拟列表；目录流取消；文件夹预览和评分
- 测试：`neoview.browser.navigation`、`neoview.browser.cancel`、`neoview.browser.http`、`neoview.file-tree.opendir`、`neoview.file-tree.readdirp`、`neoview.file-tree.scan-limit`、`neoview.file-tree.ignore`、`neoview.file-tree.scheduler`、`neoview.file-tree.watcher`、`neoview.file-tree.watcher-native`、`neoview.folder.file-tree-service`、`neoview.folder.watch-http`、`neoview.folder.watch-cancellation`、`neoview.folder.search-stream`、`neoview.folder.search-glob`、`neoview.folder.search-validation`、`neoview.folder.search-http`、`neoview.folder.search-http-cancellation`、`neoview.folder.search-session-close`、`neoview.memory-pressure.file-tree`
- 性能基准：无专项
- 已知差异：无

### 文件复制、移动、删除、重命名、回收站与撤销（`file-operations`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`archive.allowFileOperations`、`archive.confirmBeforeDelete`
- 数据：operation undo log
- 行为：批量与单项操作结果逐项报告；冲突和只读失败；回收站与永久删除；取消和撤销；系统资源管理器定位
- 测试：`neoview.file-operations.results`、`neoview.file-operations.cancel`、`neoview.file-operations.validation`、`neoview.file-operations.platform`、`neoview.file-operations.trash-adapter`、`neoview.file-operations.scheduler`、`neoview.file-operations.http`、`neoview.file-operations.confirmation`、`neoview.file-operations.http-validation`、`neoview.file-operations.cli`、`neoview.file-operations.tui`、`neoview.file-operations.undo-journal`、`neoview.file-operations.undo-partial`、`neoview.file-operations.undo-bounded`、`neoview.file-operations.undo-discard`、`neoview.file-operations.undo-platform`、`neoview.file-operations.undo-stale`、`neoview.file-operations.undo-http`、`neoview.file-operations.undo-sqlite`、`neoview.file-operations.undo-cross-process`、`neoview.file-operations.system-service`、`neoview.file-operations.system-platform`、`neoview.file-operations.system-scheduler`、`neoview.file-operations.system-http`
- 性能基准：无专项
- 已知差异：trash restore 仍未实现；已启动的系统文件操作不可强制中断，取消只阻止尚未 admission 的项

### 压缩包索引、流式读取、预热、提取与条目删除（`archive-index-stream-mutate`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`performance.archiveTempfileThresholdMB`、`archive.allowFileOperations`、`archive.confirmBeforeDelete`
- 数据：archive index、materialization leases
- 行为：ZIP/ZIP64/CBZ；RAR/7z solid 与 non-solid；嵌套与加密；当前页优先流；CRC/损坏包；条目删除后索引失效；取消无子进程残留
- 测试：`neoview.archive.conformance`、`neoview.archive.security`、`neoview.archive.index-payload-bytes`、`neoview.archive.zip-index-snapshot`、`neoview.archive.sevenzip-index-snapshot`、`neoview.archive.zip-metadata`、`neoview.archive.zip64`、`neoview.archive.streaming`、`neoview.archive.cancellation`、`neoview.archive.crc`、`neoview.archive.duplicates`、`neoview.archive.unicode`、`neoview.archive.encrypted`、`neoview.archive.empty-corrupt`、`neoview.archive.large-index`、`neoview.book.archive`、`neoview.asset.archive-stream`、`neoview.asset.cancellation`、`neoview.image.probe-archive`、`neoview.epub.stream`、`neoview.epub.validation`、`neoview.epub.cancellation`、`neoview.epub.reader-e2e`、`neoview.archive.materialize-lease`、`neoview.archive.materialize-limits`、`neoview.archive.materialize-cancellation`、`neoview.archive.nested`、`neoview.archive.nested-limits`、`neoview.control.nested-archive`、`neoview.control.encrypted-archive`、`neoview.archive.credentials`、`neoview.archive.credential-validation`、`neoview.archive.credential-lifecycle`、`neoview.archive.encrypted-nested-entry`、`neoview.sevenzip.encrypted-boundary`、`neoview.sevenzip.capability`、`neoview.sevenzip.capability-errors`、`neoview.sevenzip.index`、`neoview.sevenzip.index-errors`、`neoview.sevenzip.security`、`neoview.sevenzip.system-index`、`neoview.sevenzip.provider`、`neoview.sevenzip.cancellation`、`neoview.sevenzip.materialize-lease`、`neoview.sevenzip.reader-e2e`、`neoview.sevenzip.solid-streaming`、`neoview.sevenzip.solid-budget`、`neoview.sevenzip.solid-crc`、`neoview.sevenzip.solid-crc-errors`、`neoview.sevenzip.solid-cancellation`、`neoview.sevenzip.solid-reader-cancellation`、`neoview.sevenzip.solid-materialize-lease`、`neoview.sevenzip.solid-reader-e2e`、`neoview.sevenzip.solid-nested-e2e`、`neoview.sevenzip.solid-nested-budget`、`neoview.sevenzip.solid-cache-singleflight`、`neoview.sevenzip.solid-cache-incomplete`、`neoview.sevenzip.solid-cache-lru`、`neoview.sevenzip.solid-cache-fingerprint`、`neoview.sevenzip.solid-cache-reuse`、`neoview.sevenzip.solid-session-cache`、`neoview.memory-pressure.solid-trim`、`neoview.memory-pressure.solid-http`
- 性能基准：`archive-entry-ttfb`、`solid-adjacent-page`、`solid-cross-session`
- 已知差异：ZIP/7z provider 快照报告逻辑 descriptor UTF-8/定宽字段 payload 与活跃 extraction，不把该值冒充 V8 对象总 heap；RAR/7z 密码在无安全 stdin/native transport 前继续拒绝，不进入 argv

### 页面构建、排序、跳转与边界行为（`page-index-navigation`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`book.readingDirection`、`book.tailOverflowBehavior`、`book.lockedSortMode`、`book.lockedMediaPriority`
- 数据：page index、current page、frame snapshot
- 行为：自然排序与媒体优先级；LTR/RTL；首尾跳转和随机页；五种尾页行为；generation 取消和旧结果零回写
- 测试：`neoview.frame.boundaries`、`neoview.session.navigation`、`neoview.book.directory`、`neoview.book.archive`、`neoview.epub.manifest`、`neoview.epub.reader-e2e`、`neoview.control.session`、`neoview.page-list.catalog`、`neoview.page-list.virtual`、`neoview.page-list.search`、`neoview.page-list.thumbnail-mode`、`neoview.page-list.retry`、`neoview.react.smoke`、`neoview.react.cbz-e2e`、`neoview.headless.navigation`、`neoview.cli.pages`、`neoview.cli.frame`、`neoview.tui.navigation`
- 性能基准：`reader-hot-page-turn`
- 已知差异：无

### 单页、双页、全景、宽页与连续阅读布局（`page-layout-modes`）

- 状态：`pending`
- 端：gui
- 设置：`book.doublePageView`、`view.pageLayout`、`image.longImageScrollMode`、`view.autoRotate`
- 数据：view state、per-book layout
- 行为：封面和末页单页；宽页拆分或成对；不同尺寸双页对齐；全景组合；连续长图虚拟窗口；旋转后重排
- 测试：`neoview.frame.layout`、`neoview.image.probe-layout`、`neoview.image.probe-orientation`
- 性能基准：`layout-switch`、`continuous-scroll`
- 已知差异：无

### 缩放、适应窗口、旋转、拖动与放大镜（`zoom-rotate-magnifier`）

- 状态：`pending`
- 端：gui
- 设置：`view.defaultZoomMode`、`view.magnifier`、`view.mouseCursor`
- 数据：zoom state、rotation state
- 行为：fit/fill/宽/高/原始/左右对齐；有界缩放；拖动与捏合；临时 fit；顺逆旋转；放大镜尺寸与倍率
- 测试：待补
- 性能基准：`zoom-input-latency`
- 已知差异：无

### 图片格式、方向、尺寸与浏览器直出/转换（`image-decode-formats`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`image.supportedFormats`、`image.nativeJxl`、`performance.protocolDirectEnabled`、`performance.directUrlThresholdMB`
- 数据：dimension cache、decoded image cache
- 行为：JPEG/PNG/WebP/GIF/APNG/AVIF/JXL/SVG；EXIF 方向；ICC/透明度；坏图；超大图；浏览器直出和转换 fallback
- 测试：`neoview.asset.security`、`neoview.asset.range`、`neoview.asset.archive-stream`、`neoview.asset.cancellation`、`neoview.http.e2e`、`neoview.react.smoke`、`neoview.react.cbz-e2e`、`neoview.react.presentation-img`、`neoview.react.presentation-direct`、`neoview.react.predecode`、`neoview.image.probe-formats`、`neoview.image.probe-orientation`、`neoview.image.probe-errors`、`neoview.image.probe-streaming`、`neoview.image.probe-budget`、`neoview.image.probe-cancellation`、`neoview.image.probe-fallback`、`neoview.image.probe-archive`、`neoview.image.probe-layout`、`neoview.image.transform-query`、`neoview.image.transform-validation`、`neoview.image.transform-route`、`neoview.image.transform-sharp`、`neoview.image.transform-cancellation`、`neoview.image.transform-http`
- 性能基准：`image-decode`、`image-first-frame`、`reader-hot-page-turn`
- 已知差异：无

### 动图、视频、字幕和播放控制（`animated-image-video`）

- 状态：`pending`
- 端：gui
- 设置：`image.autoPlayAnimatedImages`、`image.videoFormats`、`image.videoMinPlaybackRate`、`image.videoMaxPlaybackRate`、`image.videoPlaybackRateStep`
- 数据：video playback state、subtitle tracks
- 行为：动图自动播放与暂停；视频进度/音量/倍速；字幕轨道；切页停止与恢复；FFmpeg 缺失诊断；视频缩略图
- 测试：`neoview.media-progress.coalesce`、`neoview.media-progress.validation`、`neoview.media-progress.close-flush`、`neoview.media-progress.read-your-write`、`neoview.media-progress.sqlite`、`neoview.media-progress.http`、`neoview.media-progress.composition`、`neoview.headless.media-progress`
- 性能基准：`video-startup`
- 已知差异：播放器、音量、倍速和字幕 UI 尚未迁移；当前纵切只完成共享运行时进度恢复与写回

### 预读、渐进加载、流传输和全局调度（`preload-stream-scheduler`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`performance.preLoadSize`、`performance.adaptivePreload`、`performance.preDecodeCacheSize`、`performance.progressiveLoad`、`image.preloadCount`、`book.preloadPages`
- 数据：priority queues、request dedup
- 行为：View/Ahead/Background 优先级；方向感知预读；渐进批次；背压；快速翻页取消；多节点资源配额
- 测试：`neoview.scheduler.interactive-slot`、`neoview.scheduler.cancellation`、`neoview.scheduler.host-injection`、`xiranite.scheduler.priority`、`xiranite.scheduler.pools`、`xiranite.scheduler.telemetry`、`neoview.image.transform-cancellation`、`neoview.cache.singleflight`、`neoview.cache.waiter-cancellation`、`neoview.memory-pressure.hysteresis`、`neoview.memory-pressure.critical`、`neoview.memory-pressure.route`、`neoview.sevenzip.scheduler`、`neoview.archive.materialize-lease`、`neoview.archive.materialize-cancellation`、`neoview.preload.telemetry`、`neoview.preload.telemetry-generation`、`neoview.preload.telemetry-http`、`neoview.preload.performance-telemetry`、`neoview.preload.viewport-admission`、`neoview.preload.viewport-validation`、`neoview.preload.viewport-session`、`neoview.preload.resource-admission`、`neoview.preload.resource-context`、`neoview.preload.resource-context-compat`、`neoview.preload.context-http`、`neoview.react.predecode`、`neoview.thumbnail.react-list`、`neoview.thumbnail.scheduler-priority`、`terminal.image.decode.cancellation`、`terminal.image.decode.scheduler`
- 性能基准：`scheduler-contention`、`cancel-latency`、`reader-hot-page-turn`、`reader-loopback-pipeline`
- 已知差异：HTTP 已接入 viewport/resource context 与 TTFB/decode/retained bytes/active lease 上报；React 实时采集与 preload plan 消费仍待接入

### 统一缩略图生成、持久化、数据库维护与迁移（`thumbnail-system`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`system.thumbnailDirectory`
- 数据：%APPDATA%/NeoView/thumbnails.db、thumbnail V1/V3/V4 records、WAL/SHM
- 行为：原数据库位置沿用；只读 schema/WAL 探测；批量命中与生成；失败记录；清理/vacuum/统计；V1/V3/V4 兼容迁移；视频和归档缩略图
- 测试：`neoview.thumbnail.legacy-path`、`neoview.thumbnail.schema`、`neoview.thumbnail.inspect-cli`、`neoview.thumbnail.blob`、`neoview.thumbnail.read`、`neoview.thumbnail.asset-route`、`neoview.thumbnail.http`、`neoview.thumbnail.http-e2e`、`neoview.thumbnail.react-list`、`neoview.thumbnail.react-e2e`、`neoview.thumbnail.coordinator.singleflight`、`neoview.thumbnail.coordinator.generation`、`neoview.thumbnail.coordinator.memory`、`neoview.thumbnail.coordinator.context-release`、`neoview.thumbnail.coordinator.prime-ttl`、`neoview.thumbnail.generate.singleflight`、`neoview.thumbnail.persist.batch`、`neoview.thumbnail.persist-metadata`、`neoview.thumbnail.writer.busy-retry`、`neoview.thumbnail.writer.busy-exhausted`、`neoview.thumbnail.failure.retry`、`neoview.thumbnail.failure.backoff`、`neoview.thumbnail.batch-prewarm`、`neoview.thumbnail.library.describe`、`neoview.thumbnail.library.singleflight`、`neoview.thumbnail.folder.reuse`、`neoview.thumbnail.library.http`、`neoview.thumbnail.library.release`、`neoview.thumbnail.library.cancellation`、`neoview.thumbnail.video.provider`、`neoview.thumbnail.video.cancellation`、`neoview.thumbnail.video.ffmpeg-e2e`、`neoview.thumbnail.video.page`、`neoview.thumbnail.video.file-cover`、`neoview.thumbnail.video.archive-entry`、`neoview.thumbnail.video.archive-cover`、`neoview.thumbnail.video.archive-e2e`、`neoview.thumbnail.video.archive-cancel`、`neoview.thumbnail.store-lazy`、`neoview.thumbnail.store-unavailable`、`neoview.thumbnail.store-close-race`、`neoview.thumbnail.store-close-idle`、`neoview.thumbnail.store-composition-lazy`、`neoview.thumbnail.maintenance.online`、`neoview.thumbnail.maintenance.invalid-paths`、`neoview.thumbnail.maintenance.http`、`neoview.thumbnail.maintenance.bounded`、`neoview.thumbnail.maintenance-cli`
- 性能基准：`thumbnail-hit`、`thumbnail-batch`、`thumbnail-codecs`、`reader-hot-page-turn`
- 已知差异：嵌套归档页在旧版键语义得到可靠证明前不提供旧数据库 thumbnailUrl；本地与归档内嵌视频缩略图均使用 fluent-ffmpeg；归档 entry 通过 PageContent 流直接输入 ffmpeg，不生成中间视频文件；在线维护仅提供统计与有界清理；VACUUM/TRUNCATE checkpoint 继续要求外部 writer 停止且先创建可验证备份

### 内存、磁盘、索引和资源缓存生命周期（`cache-lifecycle`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`performance.cacheMemorySize`
- 数据：memory LRU、persistent cache、cache index DB
- 行为：真实字节预算；pin 和方向淘汰；mtime/hash 失效；损坏恢复；80% hysteresis；session close/hibernate 回收
- 测试：`neoview.cache.weighted-lru`、`neoview.cache.byte-budget`、`neoview.cache.soft-trim`、`neoview.cache.singleflight`、`neoview.cache.oversized-bypass`、`neoview.cache.waiter-cancellation`、`neoview.cache.failure-retry`、`neoview.cache.lifecycle`、`neoview.cache.presentation-lease`、`neoview.cache.presentation-lease-pressure`、`neoview.cache.frame-retention`、`neoview.diagnostics.snapshot`、`neoview.folder.listing-payload-bytes`、`neoview.memory-pressure.file-tree`、`neoview.memory-pressure.hysteresis`、`neoview.memory-pressure.critical`、`neoview.memory-pressure.l2-trim`、`neoview.memory-pressure.route`、`neoview.memory-pressure.solid-trim`、`neoview.memory-pressure.solid-http`、`neoview.http.e2e`、`neoview.sevenzip.solid-cache-singleflight`、`neoview.sevenzip.solid-cache-incomplete`、`neoview.sevenzip.solid-cache-lru`、`neoview.sevenzip.solid-cache-fingerprint`、`neoview.sevenzip.solid-cache-reuse`、`neoview.sevenzip.solid-session-cache`、`terminal.image.decode.byte-budget`、`neoview.tui.decode-cache`
- 性能基准：`cache-memory-budget`、`presentation-retention`、`presentation-retention-real-image`、`solid-cross-session`
- 已知差异：L2 已复用引用计数 lease 保留 response 与 current/near frame 实际生成的每页最新 presentation；diagnostics 从 L1/L2/L3/solid owner 单次快照派生统一 memory/disk/lease 视图且不复制计数器；固定字节 corpus 的硬预算/淘汰与真实 JPEG→WebP loopback 冷/热/导航释放基准均已接入，current listing 预算降级、跨进程 lease 与更多格式/尺寸/压力 corpus 校准仍待完成

### 超分模型、预览、队列、缓存与保存（`super-resolution`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`image.enableSuperResolution`、`image.superResolutionModel`、`image.currentImageUpscaleEnabled`、`upscalePanelSettings`
- 数据：model manifests、upscale cache、system CLI paths
- 行为：OpenComic system CLI 探测；Upscayl daemon；waifu2x/realcugan；IllustrationJaNai/MangaJaNai；tile/scale/TTA/GPU；AVIF/JXL 无损输入；取消和保存
- 测试：待补
- 性能基准：`upscale-cold`、`upscale-warm`
- 已知差异：无

### 文件信息、图片属性、尺寸扫描和系统元数据（`metadata-dimensions-properties`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：无
- 数据：dimension cache、folder size cache
- 行为：尺寸/格式/大小/时间；批量尺寸扫描；归档 entry 属性；取消扫描；系统 shell 元数据 fallback
- 测试：`neoview.image.probe-streaming`、`neoview.image.probe-budget`、`neoview.image.probe-cancellation`、`neoview.metadata.http`、`neoview.metadata.client`、`neoview.metadata.cards`、`neoview.metadata.cancel`、`neoview.folder.size-platform`、`neoview.folder.size-budget`、`neoview.folder.size-batch`、`neoview.folder.size-cancellation`、`neoview.folder.size-http`、`neoview.cli.inspect`、`neoview.cli.reader-e2e`、`neoview.tui.reader`
- 性能基准：`dimension-scan`
- 已知差异：目录递归大小已提供 generation-bound 后台批量 service/HTTP/Headless 契约；前端合并重排和滚动锚点仍待接入

### EMM 数据库、评分、标签、收藏和翻译（`emm-ratings-tags-translation`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`emmMetadata`
- 数据：EMM databases、translation dictionary、manual tags、folder ratings
- 行为：自动/手动数据库路径；评分读写；收藏与手动标签；collect tag 统计；翻译字典；批量同步和错误恢复
- 测试：待补
- 性能基准：`emm-batch-query`
- 已知差异：无

### 历史、书签、阅读进度和数据洞察（`history-bookmarks-progress`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`history`、`book.rememberProgress`、`historySettings`
- 数据：history、bookmarks、reading heatmap、streak
- 行为：记录和恢复进度；历史大小与自动清理；书签排序/搜索；历史与文件树联动；热力图和连续阅读统计
- 测试：`neoview.progress.restore`、`neoview.progress.flush`、`neoview.progress.sqlite`、`neoview.library.contract`、`neoview.library.bookmark`、`neoview.library.bookmark-dedupe`、`neoview.library.bookmarks`、`neoview.library.http`、`neoview.library.headless`、`neoview.library.headless-composition`、`neoview.library.cli`、`neoview.library.tui`、`neoview.library.cleanup-invalid`、`neoview.library.cleanup-cancel`、`neoview.library.path-status`
- 性能基准：无专项
- 已知差异：无

### 搜索、排序、过滤、黑名单和快速库（`search-sort-filter-library`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`system.excludedPaths`、`book.lockedSortMode`、`book.lockedMediaPriority`
- 数据：search history、excluded paths、quick library
- 行为：名称/路径/标签搜索；自然排序和正逆序；媒体类型过滤；排除路径；快速库目标；大目录流式搜索取消
- 测试：`neoview.folder.listing-payload-bytes`、`neoview.memory-pressure.file-tree`、`neoview.folder.search-history-service`、`neoview.folder.search-history-validation`、`neoview.folder.search-history-sqlite`、`neoview.folder.search-history-http`、`neoview.folder.search-history-composition`、`neoview.folder.search-history-headless`、`neoview.folder.search-history-cli`、`neoview.folder.search-history-tui`、`neoview.folder.search-history-codec`、`neoview.folder.search-history-codec-raw`、`neoview.folder.search-history-import`、`neoview.folder.search-history-import-cli`
- 性能基准：`file-search`
- 已知差异：当前目录 listing 为 session owner 保留以维持首屏/选择稳定；内存压力只释放可重建 tree metadata、目录大小任务和 random seed，listing payload 可观测但尚未按预算降级

### 键盘、鼠标、触摸、区域、径向菜单和语音控制（`input-bindings-radial-voice`）

- 状态：`pending`
- 端：gui、tui
- 设置：`bindings`、`keybindings`、`radialMenus`、`voiceControl`
- 数据：binding maps、radial menus、voice command dictionary
- 行为：上下文键绑定；鼠标单击/双击/按住；九宫格区域；手势录制；冲突管理；径向菜单；语音命令启停
- 测试：待补
- 性能基准：`input-dispatch`
- 已知差异：无

### 左右边栏、顶部工具栏、底栏、面板和通知（`panels-toolbar-shell`）

- 状态：`pending`
- 端：gui
- 设置：`panels`、`uiState`、`panelsLayout`、`panelViewModes`、`view.notification`、`view.switchToast`
- 数据：panel layout、sidebar tabs、toast queue
- 行为：顶部标题/工具栏自动隐藏；底部缩略图/进度栏自动隐藏；左右侧栏独立显隐/固定/浮动；四边 hover 触发区和显示/隐藏延迟；左右侧栏拖拽宽度/高度/位置/对齐；面板排序和跨左右边栏移动；关闭边栏不挂载重面板；通知样式/位置/占位；重启恢复
- 测试：`neoview.shell.zero-mount`、`neoview.shell.hover-delay`、`neoview.shell.pinned`、`neoview.shell.input-protection`、`neoview.shell.escape`、`neoview.shell.floating-protection`、`neoview.shell.pointer-commit`、`neoview.shell.registry`、`neoview.shell.registry-lazy`、`neoview.shell.registry-compat`、`neoview.shell.e2e`
- 性能基准：`panel-render`、`reader-hot-page-turn`、`build-chunk`
- 已知差异：无

### 主题接管、阅读背景和空页面背景（`theme-background-empty-state`）

- 状态：`pending`
- 端：gui
- 设置：`theme`、`view.backgroundColor`、`view.backgroundMode`、`view.ambient`、`view.aurora`、`view.spotlight`
- 数据：runtime themes、empty-state media
- 行为：旧主题字段仅导入报告；Xiranite 主题接管；solid/ambient/aurora/spotlight 阅读背景；空页图片/视频背景设置
- 测试：待补
- 性能基准：`dynamic-background`
- 已知差异：应用主题由 Xiranite 替代

### 设置、完整导入导出、备份、Gist 和 TOML 统一（`settings-import-export-backup`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`NeoViewSettings`、`FullExportPayload`、`ExtendedSettingsData`
- 数据：legacy JSON/localStorage、backup files、Gist、[nodes.neoview] TOML
- 行为：全部非主题字段可识别；模块选择；merge/overwrite；幂等导入；完整备份；Gist 同步；GUI/CLI/TUI 共用 TOML；运行时只写 TOML；未知字段报告
- 测试：`neoview.settings.codec`、`neoview.settings.inspect`、`neoview.settings.import`、`neoview.settings.atomic-toml`、`neoview.settings.runtime`、`neoview.settings.runtime-cli`、`neoview.settings.runtime-gui`、`neoview.settings.runtime-backend`
- 性能基准：无专项
- 已知差异：不保留第二套主题状态

### 启动参数、窗口状态、托盘、卡片窗口和生命周期（`startup-window-cli-lifecycle`）

- 状态：`pending`
- 端：gui、cli
- 设置：`startup`、`cardConfigs`
- 数据：window state、card windows、tabs
- 行为：CLI 路径打开；窗口大小/位置恢复；最小化托盘；卡片窗口恢复；单实例导航；宿主关闭释放所有进程
- 测试：`neoview.headless.session`、`neoview.cli.inspect`、`neoview.cli.pages`、`neoview.cli.frame`、`neoview.cli.extract-page`、`neoview.cli.reader-e2e`、`neoview.cli.connect`、`neoview.cli.connect-security`、`neoview.tui.reader`、`neoview.tui.connect`
- 性能基准：`cold-start`、`idle-rss`
- 已知差异：无

### 幻灯片自动翻页（`slideshow`）

- 状态：`pending`
- 端：gui、tui
- 设置：`slideshow`、`book.autoPageTurnInterval`
- 数据：slideshow runtime
- 行为：开始/暂停；间隔；循环/随机；淡入淡出；切书和手动操作协调
- 测试：`neoview.file-operations.system-service`、`neoview.file-operations.system-platform`、`neoview.file-operations.system-scheduler`、`neoview.file-operations.system-http`、`neoview.file-operations.cli`
- 性能基准：无专项
- 已知差异：open/reveal 已迁移；剪贴板、快捷方式解析和 Explorer 右键注册仍待完成

### Ollama、AI 面板和翻译服务（`ai-ollama-translation`）

- 状态：`pending`
- 端：gui、cli
- 设置：`aiApiConfig`
- 数据：AI API config、translation cache
- 行为：服务探测和模型列表；生成请求；配置保存；取消/错误；翻译缓存
- 测试：待补
- 性能基准：无专项
- 已知差异：无

### 性能设置、基准、系统监控和诊断（`performance-benchmark-diagnostics`）

- 状态：`pending`
- 端：gui、cli
- 设置：`performance`
- 数据：benchmark reports、pipeline latency
- 行为：冷/热基准；算法对照；系统 CPU/RSS/GPU 观测；任务队列状态；报告导出；基准不污染用户缓存
- 测试：`neoview.diagnostics.snapshot`、`neoview.diagnostics.http`、`neoview.diagnostics.runtime-http`、`neoview.diagnostics.backend`、`neoview.diagnostics.cli`、`neoview.diagnostics.cli-connect`、`neoview.diagnostics.scheduler-telemetry-cli`、`xiranite.scheduler.telemetry`、`neoview.memory-pressure.route`、`neoview.memory-pressure.solid-http`、`neoview.preload.telemetry-http`、`neoview.preload.performance-telemetry`、`neoview.react.predecode`、`neoview.react.cbz-e2e`、`neoview.thumbnail.react-e2e`
- 性能基准：`neoview-full-suite`、`reader-loopback-pipeline`、`presentation-retention-real-image`、`reader-hot-page-turn`、`build-chunk`
- 已知差异：当前提供无副作用瞬时快照、宿主资源池 lease/queue wait、archive/browser owner payload、统一 cache lease 及预读性能累计指标；真实 JPEG→WebP retention 冷/热/释放链路已进入 required reader benchmark，GPU 利用率、时间序列采样、算法对照和报告导出仍待迁移

### 图片裁边、颜色滤镜、页面过渡和悬停滚动（`image-effects-transitions`）

- 状态：`pending`
- 端：gui
- 设置：`image.hoverScrollEnabled`、`image.hoverScrollSpeed`
- 数据：trim state、filter state、transition state
- 行为：自动/手动裁边；颜色滤镜开关与参数；页面切换动画；长图悬停滚动和速度；切页后清理上一页效果状态
- 测试：待补
- 性能基准：`image-effects-frame`
- 已知差异：无

### 卡片注册、卡片布局、独立窗口和通用标签页（`card-windows-tabs`）

- 状态：`pending`
- 端：gui
- 设置：`cardConfigs`、`insightsCardsSettings`
- 数据：card registry、card layout、window tabs
- 行为：卡片注册和动态渲染；折叠/排序/显隐；卡片独立窗口；标签创建/切换/关闭/恢复；未知卡片配置兼容
- 测试：待补
- 性能基准：`card-window-startup`
- 已知差异：无

### 播放列表和快速库（`playlist-quick-library`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`quickFolderTargets`
- 数据：playlists、quick library targets
- 行为：创建/删除/重命名播放列表；添加和移除书籍；播放列表顺序；快速库目标增删和打开；最终 HEAD 中占位入口需 characterization 后补齐
- 测试：待补
- 性能基准：无专项
- 已知差异：最终 HEAD 的 sidebar playlist 映射仍指向 FolderPanel，占位行为必须先固定

### 旧 IPC、内置协议、批处理和 Worker 数据传输迁移（`ipc-protocol-transport`）

- 状态：`pending`
- 端：gui、cli、tui
- 设置：`performance.protocolDirectEnabled`、`performance.directUrlThresholdMB`
- 数据：blob registry、stream handles
- 行为：控制面只传小对象；图片字节走 loopback HTTP；无 Base64/大 JSON 主链；批处理有界；取消和背压；旧协议设置可导入但不保留双实现
- 测试：`neoview.asset.archive-stream`、`neoview.asset.cancellation`、`neoview.http.e2e`、`neoview.headless.page-stream`、`neoview.cli.extract-page`、`neoview.cli.reader-e2e`
- 性能基准：`image-transport`、`ipc-batch`
- 已知差异：Tauri custom protocol/IPC 被 loopback HTTP 和 TS service 替代

### 剪贴板和系统集成能力（`platform-clipboard-shell`）

- 状态：`pending`
- 端：gui、cli
- 设置：无
- 数据：无
- 行为：复制图片/路径/文本；打开方式；资源管理器定位；快捷方式解析；Windows 能力缺失降级
- 测试：`neoview.clipboard.materialization-service`、`neoview.clipboard.materialization-validation`、`neoview.clipboard.materialization-platform`、`neoview.clipboard.materialization-cleanup`、`neoview.clipboard.materialization-http`、`neoview.file-operations.system-platform`、`neoview.file-operations.system-scheduler`
- 性能基准：无专项
- 已知差异：文本、图片和普通文件复制复用 Xiranite host clipboard；不新增 Reader clipboard backend；归档页复制先创建有 TTL、数量和字节预算的临时文件租约，再由 GUI 调用 host clipboard.writeFiles；旧版 cut 标记仅为进程内状态，迁移为 Reader UI/session 状态；读取文件剪贴板、clear、快捷方式解析、Explorer 右键注册和 trash restore 仍待迁移
