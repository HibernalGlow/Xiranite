# NeoView Card 完整功能与 UI 验收清单

> 本文件由 `bun run generate:neoview-card-checklist` 生成。机器事实源为 `migration/neoview/folder-main-compatibility.json` 与 `migration/neoview/card-compatibility.json`，请勿只改本文件。

## 完成规则

- 所有 Card 都执行“先冻结源码清单，再实现，再验收”；只有标题或后端 API 不算完成。
- `complete/migrated` 必须覆盖功能、UI 层级、控件与图标、交互状态、持久化、键盘/无障碍、共享 GUI/CLI/TUI 契约、生命周期、性能、测试和有意偏离。
- UI 默认保持旧版信息层级、密度和操作位置；只允许使用 XR 设计 token 和既有通用组件做等价适配。桌面侧栏、窄侧栏和独立 Card 窗口都要有截图或几何证据。
- `pending/partial` 是真实状态，不得为了提高数字提前改成完成；旧版自身缺失的能力必须标为 `registry-only` 或记录替代决策。
- Windows 重验证严格串行，Vitest 固定 `--maxWorkers=1`，防止清单验证本身触发内存耗尽。

## 文件浏览器 `folderMain`

共 74 项：`partial=28`，`pending=46`。以下是完整验收项，不是自然排序或单列表的缩减版。

### architecture（5）

- [ ] `folder.arch.session` 有界目录浏览会话
  - 目标：一个 ReaderFileTreeService 会话维护稳定 generation、显式关闭、取消和有界缓存；GUI/CLI/TUI 不各建目录实现。
  - 源码：`stores/folderPanelStore/core.svelte.ts`、`components/FolderStack/FolderDataLoader.ts`
  - 测试：`neoview.folder.browser-session`、`neoview.folder.catalog-bounds`
  - 备注：当前 CoreReaderDirectoryBrowser 与 12x128 稀疏 catalog 已覆盖基础纵切，最终需并入统一服务。
- [ ] `folder.arch.page` 任意 cursor 分页与稳定快照
  - 目标：可按任意 cursor/limit 拉取稳定快照，目录变化通过 generation 失效，不向前端一次性返回完整大目录。
  - 源码：`components/FolderStack/FolderDataLoader.ts`、`stores/folderPanelStore/types.ts`
  - 测试：`neoview.folder.browser-page`、`neoview.folder.catalog-sparse`
  - 备注：当前每页 128 项；尚未完成排序/过滤后稳定分页契约。
- [ ] `folder.arch.scan` 单层与递归扫描分层
  - 目标：单层列举使用原生 opendir/Dirent；递归索引与搜索使用唯一 readdirp adapter，支持 AbortSignal、背压和批次输出。
  - 源码：`utils/directoryTreeCache.ts`、`components/FolderTree.svelte`
  - 测试：`neoview.folder.native-listing`、`neoview.folder.recursive-scanner`
  - 备注：scanner adapter 已加入但仍需完成聚焦验证与统一服务接线。
- [ ] `folder.arch.watch` 文件树增量监听
  - 目标：按需动态加载 @parcel/watcher，仅监听活动根；事件合并后增量修补 generation，最后消费者关闭即 unsubscribe。
  - 源码：`utils/directoryTreeCache.ts`、`components/FolderTree.svelte`
  - 测试：`neoview.folder.watcher-lifecycle`
  - 备注：Windows/Bun create 事件探针已通过，尚未接入目录快照增量刷新。
- [ ] `folder.arch.dispose` 取消、释放与休眠
  - 目标：折叠、切目录、关闭标签和卸载 Card 时取消过期分页/扫描/缩略图，释放 watcher、thumbnail context、browser session 和 Worker。
  - 源码：`components/FolderStack.svelte`、`utils/directoryTreeCache.ts`
  - 测试：`neoview.folder.thumbnail-release`、`neoview.folder.session-dispose`
  - 备注：当前 Card 已释放分页、缩略图 context 和会话。

### navigation（7）

- [ ] `folder.nav.path` 路径输入与直接跳转
  - 目标：面包屑与可编辑路径输入可互换；Enter 确认、Escape 取消、blur 行为及无效路径反馈与原版一致。
  - 源码：`components/BreadcrumbBar.svelte`
  - 测试：`neoview.folder.path-navigation`
  - 备注：当前只有路径输入和转到按钮，尚无原版面包屑编辑体验。
- [ ] `folder.nav.history` 前进、后退与导航历史
  - 目标：每标签维护分支正确的前进/后退历史，并恢复目录、滚动、焦点、选择和临时排序。
  - 源码：`stores/folderTabStore/navigationHistory.svelte.ts`、`components/FolderToolbar/NavigationButtons.svelte`
  - 测试：`neoview.folder.navigation-history`、`neoview.folder.restore-snapshot`
  - 备注：当前单 Card 路径历史和 Virtuoso snapshot 已有基础实现。
- [ ] `folder.nav.parent` 返回上级并定位原目录
  - 目标：返回上级后自动选中并滚动到刚离开的子目录；远端批次尚未加载时先定位索引再取页。
  - 源码：`components/FolderStack/folderStackNavigation.ts`、`components/FolderToolbar/NavigationButtons.svelte`
  - 测试：`neoview.folder.parent-suggested-selection`
  - 备注：后端 suggestedSelection 与前端远端定位已接入。
- [ ] `folder.nav.home-refresh` 主页、设为主页与刷新
  - 目标：主页跳转、修饰键设为主页、F5/按钮刷新均保留当前位置策略并给出加载状态。
  - 源码：`components/FolderToolbar/NavigationButtons.svelte`、`components/FolderToolbar/FolderToolbar.svelte`
  - 测试：`neoview.folder.refresh`
  - 备注：刷新按钮已有；主页和持久化设置未实现。
- [ ] `folder.nav.stack` FolderStack 分层浏览
  - 目标：保留父/当前/子层的分层浏览、预加载和每层独立滚动/选择状态，路径切换不重置无关层。
  - 源码：`components/FolderStack.svelte`、`components/FolderStack/FolderStackState.svelte.ts`、`components/FolderStack/folderStackNavigation.ts`
  - 测试：待补
  - 备注：不得用单列列表替代后宣称 UI 兼容。
- [ ] `folder.nav.blank-action` 空白单击/双击导航动作
  - 目标：空白单击和双击分别支持 none/goUp/goBack，并避免与选择清空和双击项打开冲突。
  - 源码：`components/FolderList.svelte`、`components/FolderToolbar/tabs/OtherTab.svelte`
  - 测试：待补
  - 备注：设置与事件优先级均需迁移。
- [ ] `folder.nav.bottom-return` 列表底部返回按钮
  - 目标：按设置在列表末尾显示返回上级/后退入口，虚拟列表中不破坏索引和恢复定位。
  - 源码：`components/FolderList.svelte`、`components/FolderToolbar/tabs/DisplayTab.svelte`
  - 测试：待补
  - 备注：必须作为 Virtuoso footer，不计入文件 entry 索引。

### tabs（6）

- [ ] `folder.tabs.lifecycle` 多标签创建、切换与关闭
  - 目标：创建、切换、关闭标签；关闭最后标签的策略与原版一致，每标签拥有隔离浏览状态。
  - 源码：`components/FolderTabBar.svelte`、`stores/folderTabStore/tabManagement.svelte.ts`
  - 测试：待补
  - 备注：当前 FolderMainCard 只有单会话。
- [ ] `folder.tabs.bulk-close` 关闭其他/左侧/右侧标签
  - 目标：上下文菜单支持关闭其他、左侧和右侧标签，固定标签保护规则与原版一致。
  - 源码：`components/FolderTabBar.svelte`、`stores/folderTabStore/tabManagement.svelte.ts`
  - 测试：待补
  - 备注：批量关闭必须释放对应会话资源。
- [ ] `folder.tabs.pin-duplicate` 固定与复制标签
  - 目标：标签可固定/取消固定并复制完整浏览状态；固定状态持久化。
  - 源码：`components/FolderTabBar.svelte`、`stores/folderTabStore/tabManagement.svelte.ts`
  - 测试：待补
  - 备注：与侧栏 pin 是不同能力。
- [ ] `folder.tabs.reopen` 最近关闭与恢复标签
  - 目标：持有最近关闭 10 项，支持菜单和快捷动作恢复，恢复路径、历史、视图和排序状态。
  - 源码：`components/FolderTabBar.svelte`、`stores/folderTabStore/tabManagement.svelte.ts`
  - 测试：待补
  - 备注：淘汰顺序与固定上限需测试。
- [ ] `folder.tabs.navigation-history` 标签切换历史
  - 目标：维护标签访问历史并在关闭活动标签时选择正确的最近标签。
  - 源码：`stores/folderTabStore/tabManagement.svelte.ts`
  - 测试：待补
  - 备注：不能简单选择数组相邻项。
- [ ] `folder.tabs.layout` 标签栏/工具栏/面包屑布局
  - 目标：标签栏布局以及工具栏、面包屑位置可配置并持久化，窄侧栏下保持原版密度和溢出行为。
  - 源码：`components/FolderTabBar.svelte`、`stores/folderTabStore/layoutSettings.svelte.ts`
  - 测试：待补
  - 备注：纳入截图与几何验收。

### view（4）

- [ ] `folder.view.modes` list/content/banner/thumbnail 四种原版视图
  - 目标：完整保留 list、content、banner、thumbnail 的信息密度、缩略图位置、选中/hover/focus 表现；目标内部可用更清晰的 mode 名。
  - 源码：`components/FolderList.svelte`、`components/FolderListItem.svelte`、`components/FolderToolbar/ViewModeButtons.svelte`
  - 测试：`neoview.folder.view-compact`、`neoview.folder.view-cover-list`、`neoview.folder.view-mosaic-list`、`neoview.folder.view-details`、`neoview.folder.view-cover-grid`、`neoview.folder.view-mosaic-grid`
  - 备注：当前已提供 compact、cover-list、mosaic-list、details、cover-grid、mosaic-grid 六种内部模式，并复用同一 catalog/selection/focus/sort/EMM 状态；仍需完成原版 list/content/banner/thumbnail 的逐项视觉与设置持久化验收。
- [ ] `folder.view.details` 详细信息视图与列
  - 目标：显示名称、路径、类型、扩展名、大小、修改时间、尺寸、页数、评分和标签信息；列宽/截断/tooltip 与原版一致。
  - 源码：`components/FolderListItem.svelte`、`stores/folderPanelStore/types.ts`
  - 测试：`neoview.folder.details-lazy`、`neoview.folder.details-niko-sparse`、`neoview.folder.details-on-demand`、`neoview.folder.details-metadata`、`neoview.folder.media-metadata-batch`、`neoview.folder.media-metadata-fallback`、`neoview.folder.media-metadata-emm-hit`
  - 备注：已扩展现有 Niko Table 虚拟体支持 totalCount + 全局索引到已加载 row ID 的稀疏远端模式；10K 总量测试只向 TanStack 提交 2 条实体，并提供名称、路径、类型、扩展名、大小、修改时间、尺寸、页数、评分、标签十列。Niko 仅在切换 details 后二级动态加载；显式 details 分页才按需请求 date/size/dimensions/pageCount/tags，图片尺寸复用 StreamingImageMetadataProbe，缺失归档页数复用 ReaderBookLoader，EMM page_count 命中时不打开归档；媒体并发固定为 2，单项失败保留基础行。列设置持久化、真实 Chromium 滚动/定位和原版视觉证据仍待完成。
- [ ] `folder.view.thumbnail-size` 缩略图宽度调节
  - 目标：连续调节缩略图宽度并持久化；调整时虚拟布局重测但不丢失锚点和选中项。
  - 源码：`components/FolderToolbar/ViewPanel.svelte`、`stores/folderTabStore/layoutSettings.svelte.ts`
  - 测试：待补
  - 备注：需覆盖窄栏和高 DPI。
- [ ] `folder.view.banner-width` 横幅列宽调节
  - 目标：banner 宽度百分比可调且持久化，文本列与预览列不重叠。
  - 源码：`components/FolderToolbar/ViewPanel.svelte`、`stores/folderTabStore/layoutSettings.svelte.ts`
  - 测试：待补
  - 备注：纳入几何回归。

### preview（3）

- [ ] `folder.view.hover-preview` Hover 预览与延迟
  - 目标：支持关闭及 200/500/800/1200ms 延迟；离开、滚动、切标签和卸载立即取消过期预览。
  - 源码：`components/FolderListItem.svelte`、`components/FolderToolbar/tabs/DisplayTab.svelte`
  - 测试：待补
  - 备注：不得为离屏项生成预览。
- [ ] `folder.view.folder-mosaic` 文件夹 4/9/16 图多预览
  - 目标：文件夹缩略图支持单封面及 4/9/16 图 mosaic，稳定选图、异步缺图占位和可见范围批量 demand。
  - 源码：`components/FolderListItem.svelte`、`components/FolderToolbar/tabs/DisplayTab.svelte`
  - 测试：`neoview.folder.mosaic-4`、`neoview.folder.mosaic-9`、`neoview.folder.mosaic-16`、`neoview.folder.mosaic-single-image-dom`
  - 备注：文件夹已支持 4/9/16 选择，服务端按自然顺序稳定选取前 N 张并通过 sharp.composite() 合成为单个 WebP；前端每项始终只挂一个 img，文件项强制单预览。仍缺持久设置、缺图视觉 characterization、磁盘 profile 缓存与 10K/100K 性能门禁。
- [ ] `folder.view.thumbnail-pipeline` 可见范围缩略图管线
  - 目标：仅对可见+overscan 项按 32-64 对齐窗口注册，opaque URL 输出，按字节预算缓存并在 context 释放后取消低优先级任务。
  - 源码：`components/FolderList.svelte`、`components/FolderListItem.svelte`
  - 测试：`neoview.folder.thumbnail-visible-batch`、`neoview.folder.thumbnail-release`、`neoview.folder.thumbnail-opaque-mosaic`
  - 备注：当前最多 64 项 demand 已接入；单封面与 4/9/16 mosaic 都使用 opaque URL 和单请求/单 img，mosaic profile 只进入有界内存 coordinator，避免覆盖旧单封面持久缓存键。

### performance（2）

- [ ] `folder.view.virtualization` 高性能列表与 Grid 虚拟化
  - 目标：React Virtuoso/VirtuosoGrid 保持 DOM 有界、支持稀疏分页、动态尺寸、scroll snapshot 和精确 scrollToIndex；10K/100K corpus 不线性占用 DOM/JS heap。
  - 源码：`components/FolderList.svelte`、`components/FolderStack.svelte`
  - 测试：`neoview.folder.virtuoso-list`、`neoview.folder.virtuoso-grid`、`neoview.folder.catalog-bounds`
  - 备注：尚缺大数据集 Playwright/内存门禁。
- [ ] `folder.performance.budgets` 10K/100K 目录性能与内存门禁
  - 目标：建立冷/热首屏、滚动帧、前进后退定位、搜索首批、缩略图吞吐、DOM 数、JS heap/RSS、取消延迟和关闭后回收基准；Reader 热翻页不回退。
  - 源码：`components/FolderList.svelte`、`utils/directoryTreeCache.ts`
  - 测试：待补
  - 备注：所有重型门禁严格串行，Vitest maxWorkers=1。

### sorting（9）

- [ ] `folder.sort.fields` 八类排序字段
  - 目标：支持 name/date/size/type/random/rating/path/collectTagCount 和 asc/desc，不得收缩为自然排序。
  - 源码：`stores/folderPanelStore/types.ts`、`components/FolderToolbar/SortPanel.svelte`、`components/FolderStack/sortingUtils.ts`
  - 测试：`neoview.folder.sort-fields`、`neoview.folder.sort-session`、`neoview.folder.sort-ui`
  - 备注：八字段共享契约已冻结；GUI 只开放 provider 已真实支持的 name/date/size/type/random/path，rating/collectTagCount 等待 EMM batch provider。
- [ ] `folder.sort.name` 数字感知名称排序与稳定兜底
  - 目标：名称比较数字感知、大小写/locale 行为冻结；其他字段相等时按名称与稳定 entry ID 兜底。
  - 源码：`components/FolderStack/sortingUtils.ts`
  - 测试：`neoview.folder.sort-fields`、`neoview.folder.sort-session`
  - 备注：Intl.Collator 数字感知与 name/path 稳定兜底已接入；仍需补全半角/全角/locale characterization fixture。
- [ ] `folder.sort.directories-first` 目录优先与虚拟路径例外
  - 目标：真实目录默认 folders-first；History/Bookmark/Search 等虚拟源按原规则关闭或配置目录优先。
  - 源码：`components/FolderStack/sortingUtils.ts`、`utils/virtualPathLoader.ts`
  - 测试：`neoview.folder.sort-fields`、`neoview.folder.sort-session`
  - 备注：真实目录的 directoriesFirst 已由唯一 session 排序器实现；虚拟源例外尚未接入。
- [ ] `folder.sort.folder-size` 文件夹大小异步 hydration 后重排
  - 目标：文件大小即时，目录大小后台有界计算；结果按 generation 合并并重排，同时保持选中项身份与合理滚动锚点。
  - 源码：`components/FolderStack/sortingUtils.ts`、`components/FolderStack/FolderDataLoader.ts`
  - 测试：待补
  - 备注：大目录不得同步递归求大小。
- [ ] `folder.sort.random` 稳定随机种子
  - 目标：随机排序按路径/标签稳定种子生成，返回目录和刷新时顺序保持，显式重随机才更换种子。
  - 源码：`stores/folderPanelStore/panelState.svelte.ts`、`components/FolderStack/sortingUtils.ts`
  - 测试：`neoview.folder.sort-random`
  - 备注：使用 Node crypto SHA-256 生成 session/path 稳定 rank，刷新和返回目录复用 seed；显式重随机与跨启动记忆仍待实现。
- [ ] `folder.sort.emm` EMM 评分与收藏标签数量排序
  - 目标：rating 使用默认评分兜底；collectTagCount 使用 EMM 批量 hydration，缺失/错误值排序稳定。
  - 源码：`components/FolderStack/sortingUtils.ts`、`stores/folderPanelStore/types.ts`
  - 测试：`neoview.folder.emm-batch`、`neoview.folder.emm-route`、`neoview.folder.sort-fields`
  - 备注：rating_data/emm_json 经同一 Reader SQLite 连接按 256 项批量读取，默认评分 4.2，收藏标签从 EMM setting.json 按需加载；完整 EMM 配置 UI 与大目录专项基准仍待完成。
- [ ] `folder.sort.precedence` 排序规则优先级
  - 目标：严格实现 临时当前目录规则 > 文件夹记忆 > 标签默认 > 全局默认，并在导航/恢复时可解释当前来源。
  - 源码：`stores/folderTabStore/sortingFiltering.svelte.ts`、`stores/folderPanelStore/core.svelte.ts`
  - 测试：`neoview.folder.sort-precedence`、`neoview.folder.sort-preference-session`
  - 备注：共享偏好服务已严格实现 temporary > memory > tab-default > global-default 并返回 source；真实多标签 scope 与 CLI/TUI 命令界面尚待接入。
- [ ] `folder.sort.memory` 文件夹排序记忆与清除
  - 目标：可锁定/记忆单目录排序，清除当前目录或全部记忆，并可把当前排序设为标签或全局默认。
  - 源码：`stores/folderTabStore/sortingFiltering.svelte.ts`、`components/FolderToolbar/SortPanel.svelte`
  - 测试：`neoview.folder.sort-memory-clear`、`neoview.folder.sort-sqlite`、`neoview.folder.sort-ui`
  - 备注：全局/标签默认与最多 1000 项文件夹记忆已进入现有 Reader SQLite，GUI 可锁定临时规则、设默认和清除当前/全部记忆；多标签 UI 与旧 localStorage 导入尚待完成。
- [ ] `folder.sort.virtual` History/Bookmark 独立排序语义
  - 目标：History 的 date 表示访问时间、Bookmark 的 date 表示创建时间；各自保存视图/排序设置而不污染普通目录。
  - 源码：`utils/virtualPathLoader.ts`、`components/FolderToolbar/FolderToolbar.svelte`
  - 测试：待补
  - 备注：虚拟源不是普通 stat 数据。

### selection（4）

- [ ] `folder.select.basic` 单选、Ctrl/Meta toggle 与焦点项
  - 目标：单击单选，Ctrl/Meta 切换，focused item 与 selected set 分离，虚拟化卸载不丢身份。
  - 源码：`stores/folderPanelStore/selectionState.svelte.ts`、`components/FolderListItem.svelte`
  - 测试：`neoview.folder.selection-basic`
  - 备注：当前基础单选和 Ctrl/Meta 已有。
- [ ] `folder.select.range` Shift 范围与链式选择
  - 目标：Shift 以稳定 anchor index 范围选择；链式选择按标签隔离，跨未加载分页也正确。
  - 源码：`stores/chainSelectStore.svelte.ts`、`components/FolderStack/FolderSelectionHandler.ts`
  - 测试：待补
  - 备注：不得只对当前 DOM 范围操作。
- [ ] `folder.select.bulk` 全选、反选、取消与选择栏
  - 目标：全选/反选/取消作用于稳定 catalog，SelectionBar 显示数量与批量动作；大目录避免物化百万路径。
  - 源码：`components/SelectionBar.svelte`、`stores/folderPanelStore/selectionState.svelte.ts`
  - 测试：待补
  - 备注：需要 all-except selection 表达或服务端 selection token。
- [ ] `folder.select.restore` 导航状态恢复与自动定位
  - 目标：保存 scrollTop/snapshot、selectedItemPath、focused path/index 和 pendingFocusPath；前进后退/标签切换后自动定位。
  - 源码：`stores/folderTabStore/navigationHistory.svelte.ts`、`components/FolderStack/FolderStackState.svelte.ts`
  - 测试：`neoview.folder.restore-snapshot`、`neoview.folder.parent-suggested-selection`
  - 备注：当前单标签快照已覆盖基础路径。

### keyboard（2）

- [ ] `folder.keyboard.navigation` 键盘焦点与方向导航
  - 目标：ArrowUp/Down/Left/Right、Home/End、PageUp/PageDown 根据 list/grid 几何移动焦点并滚入视口；补齐原版未完成的上下箭头遗留。
  - 源码：`utils/keyboardHandler.ts`、`components/FolderList.svelte`
  - 测试：待补
  - 备注：原源码的 ArrowUp/ArrowDown TODO 也属于目标兼容范围。
- [ ] `folder.keyboard.commands` 打开、返回、刷新、搜索、删除快捷键
  - 目标：Enter 打开、Backspace 后退、F5 刷新、Delete 按删除策略、Ctrl/Cmd+A 全选、Ctrl/Cmd+F 搜索、Escape 取消多选。
  - 源码：`utils/keyboardHandler.ts`
  - 测试：待补
  - 备注：输入框、菜单和 IME 激活时不得误触发。

### search（3）

- [ ] `folder.search.current` 当前目录搜索
  - 目标：按名称或路径搜索当前目录，支持清除、空态、加载态、错误态和搜索历史。
  - 源码：`components/SearchResultList.svelte`、`stores/folderTabStore/sortingFiltering.svelte.ts`
  - 测试：待补
  - 备注：搜索结果必须继续虚拟化。
- [ ] `folder.search.recursive` 包含子目录的流式搜索
  - 目标：递归搜索通过 readdirp stream 分批返回、可取消、可限制并发；不阻塞 Bun 事件循环。
  - 源码：`components/SearchResultList.svelte`、`components/FolderToolbar/ActionButtons.svelte`
  - 测试：`neoview.folder.recursive-scanner`
  - 备注：底层 adapter 已草拟，搜索会话尚未完成。
- [ ] `folder.search.emm-tags` EMM 标签、收藏标签与随机标签搜索
  - 目标：支持 EMM 标签条件、收藏标签快捷筛选和随机标签；标签组合修饰键行为与原版一致。
  - 源码：`components/FavoriteTagPanel.svelte`、`components/SearchResultList.svelte`
  - 测试：待补
  - 备注：查询走统一 EMM provider，不扫描 UI store。

### filtering（1）

- [ ] `folder.filter.type` 类型筛选
  - 目标：支持全部、压缩包、文件夹、视频类型筛选，并与排序、搜索和虚拟源组合。
  - 源码：`components/FolderToolbar/TypeFilterBar.svelte`、`utils/virtualPathLoader.ts`
  - 测试：待补
  - 备注：扩展名和 MIME 规则需单一共享定义。

### tree（4）

- [ ] `folder.tree.panel` 文件树面板与展开/折叠
  - 目标：树节点按需加载、展开/折叠、选中同步、加载占位、错误重试和缓存失效完整迁移。
  - 源码：`components/FolderTree.svelte`、`utils/directoryTreeCache.ts`
  - 测试：待补
  - 备注：不得预加载整棵磁盘树。
- [ ] `folder.tree.layout-pin` 文件树位置、尺寸与 pin
  - 目标：文件树支持 left/right/top/bottom、尺寸拖动、固定/自动收起；状态持久化且与 Reader 侧栏 pin 语义协调。
  - 源码：`components/FolderTree.svelte`、`components/FolderToolbar/TreePanel.svelte`
  - 测试：待补
  - 备注：用户明确要求迁移 pin。
- [ ] `folder.tree.inline` 主视图内联树
  - 目标：内联树作为虚拟化数据源模式，支持层级缩进、展开、选择、预览和键盘导航。
  - 源码：`components/InlineTreeList.svelte`、`components/FolderToolbar/FolderToolbar.svelte`
  - 测试：待补
  - 备注：不能渲染无界嵌套 DOM。
- [ ] `folder.tree.cache` 树缓存清理与排除目录
  - 目标：支持清理树缓存、排除目录、取消排除和重新加载；排除规则持久化并应用于扫描/搜索/树。
  - 源码：`utils/directoryTreeCache.ts`、`components/FolderToolbar/CleanupOptionsDialog.svelte`
  - 测试：待补
  - 备注：三条路径共享一份 exclusion policy。

### virtual-sources（2）

- [ ] `folder.virtual.sources` Folder/Bookmark/History/Search 虚拟数据源
  - 目标：统一数据源接口承载真实目录、书签、历史和搜索，保留各自日期/删除/同步语义与面包屑图标。
  - 源码：`utils/virtualPathLoader.ts`、`components/BreadcrumbBar.svelte`、`components/SearchResultList.svelte`
  - 测试：待补
  - 备注：不能把虚拟路径伪造成可 stat 的真实目录。
- [ ] `folder.virtual.cleanup` 无效书签/历史清理与同步
  - 目标：首次使用时有界清理无效项；支持 History/Bookmark 同步文件夹变化、单项删除和清空历史。
  - 源码：`utils/virtualPathLoader.ts`
  - 测试：待补
  - 备注：清理失败不能阻断列表首屏。

### operations（10）

- [ ] `folder.op.open` 打开、浏览、新标签与作为书籍打开
  - 目标：按项目类型提供默认打开、浏览文件夹、新标签打开、文件夹作为书籍打开；禁用项和默认动作与原版一致。
  - 源码：`components/FolderContextMenu.svelte`
  - 测试：`neoview.folder.activate-entry`
  - 备注：当前仅目录导航和受支持文件 onOpen。
- [ ] `folder.op.system` 系统默认程序与资源管理器定位
  - 目标：通过 platform capability 安全调用系统默认程序和 Explorer/Finder 定位，不在 core 中拼 shell 命令。
  - 源码：`components/FolderContextMenu.svelte`
  - 测试：待补
  - 备注：TUI 可暴露命令但需显式确认外部启动。
- [ ] `folder.op.clipboard` 复制、剪切、粘贴
  - 目标：单项/批量复制剪切粘贴，处理冲突、跨卷、取消、进度、部分失败和 watcher 回写。
  - 源码：`components/FolderContextMenu.svelte`、`components/SelectionBar.svelte`
  - 测试：待补
  - 备注：文件事务服务独立于 React。
- [ ] `folder.op.copy-metadata` 复制路径与名称
  - 目标：复制单项/多项路径或名称，换行格式和通知与原版一致。
  - 源码：`components/FolderContextMenu.svelte`
  - 测试：待补
  - 备注：GUI clipboard 走宿主 adapter。
- [ ] `folder.op.rename` 重命名
  - 目标：内联/弹窗重命名保留扩展名策略、校验、冲突提示、取消和完成后选中项路径更新。
  - 源码：`components/FolderContextMenu.svelte`、`components/FolderListItem.svelte`
  - 测试：待补
  - 备注：watcher 事件不能造成重复项。
- [ ] `folder.op.delete` 回收站、永久删除与批量删除
  - 目标：删除策略可切换回收站/永久删除；单项/批量确认、进度、部分失败、焦点迁移和安全边界完整。
  - 源码：`components/FolderContextMenu.svelte`、`components/SelectionBar.svelte`、`components/FolderToolbar/FolderToolbar.svelte`
  - 测试：待补
  - 备注：永久删除必须显式二次确认。
- [ ] `folder.op.undo-delete` 撤销删除
  - 目标：仅对可恢复删除提供撤销，恢复冲突与过期状态明确；永久删除不伪装可撤销。
  - 源码：`components/SelectionBar.svelte`、`components/FolderToolbar/ActionButtons.svelte`
  - 测试：待补
  - 备注：需平台能力声明。
- [ ] `folder.op.bookmark` 添加/移除书签
  - 目标：单项/批量加入书签列表，重复项、列表选择、移除和虚拟源实时同步。
  - 源码：`components/FolderContextMenu.svelte`、`utils/virtualPathLoader.ts`
  - 测试：待补
  - 备注：与 bookmarkList Card 共用应用服务。
- [ ] `folder.op.thumbnail` 重生成、预热和取消缩略图
  - 目标：支持选中/全部重生成、当前目录预热、取消和进度；任务低优先级、可取消、去重且不阻塞当前页。
  - 源码：`components/FolderContextMenu.svelte`、`components/FolderToolbar/ActionButtons.svelte`
  - 测试：待补
  - 备注：使用统一 presentation cache。
- [ ] `folder.op.context-menu` 完整右键菜单与可用性规则
  - 目标：菜单分组、图标、快捷键提示、嵌套项、单/多选上下文、虚拟源差异、disabled 与关闭行为尽量保持原版一致。
  - 源码：`components/FolderContextMenu.svelte`
  - 测试：待补
  - 备注：UI parity 必须截图和交互测试。

### emm（3）

- [ ] `folder.emm.metadata` EMM 元数据批量 hydration
  - 目标：可见/排序需求按批查询评分、标签、收藏标签数等元数据，带 generation 和缓存，不产生逐文件 N+1。
  - 源码：`components/FolderListItem.svelte`、`components/FolderStack/sortingUtils.ts`
  - 测试：`neoview.folder.emm-sqlite-batch`、`neoview.folder.emm-legacy-columns`、`neoview.folder.emm-settings`、`neoview.folder.emm-batch`、`neoview.folder.emm-visible-batch`、`neoview.folder.emm-route`、`neoview.folder.details-metadata`
  - 备注：现有 SqliteReaderDataStore 实现可选 EMM record port；首批与稀疏页仅 hydration 当前批次，排序时按 256 项批次读取并定期 yield。details 同一 SELECT 读取 emm_json/rating_data/manual_tags，输出去重且最多 256 项的 namespace:tag DTO，并优先复用 EMM page_count；旧库没有 manual_tags 时使用 NULL 投影，不修改旧表。缓存失效、标签搜索和编辑 provider 仍待完成。
- [ ] `folder.emm.display` 评分、标签与收藏信息显示
  - 目标：各视图按空间显示评分、标签、收藏数量和缺失态，tooltip 提供完整信息。
  - 源码：`components/FolderListItem.svelte`、`components/FavoriteTagPanel.svelte`
  - 测试：`neoview.folder.emm-display`、`neoview.folder.details-metadata`
  - 备注：compact 与 cover-grid 已显示评分和收藏标签数，details 已接入完整 EMM + manual tag 文本；默认评分 4.2 同时参与显示/排序。cover/mosaic list/grid 的完整标签、tooltip 详情与可配置默认评分仍待完成。
- [ ] `folder.emm.edit` 编辑 EMM 标签与评分
  - 目标：单项/批量编辑标签与评分，乐观更新、失败回滚并让搜索/排序立即一致。
  - 源码：`components/FolderContextMenu.svelte`、`components/FavoriteTagPanel.svelte`
  - 测试：待补
  - 备注：与独立 EMM Card 共用命令服务。

### penetration（3）

- [ ] `folder.penetrate.mode` 递归显示/穿透模式
  - 目标：支持关闭/开启穿透、single/all 范围和递归显示，结果保留来源路径与层级语义。
  - 源码：`components/FolderToolbar/FolderToolbar.svelte`、`components/FolderToolbar/tabs/OtherTab.svelte`
  - 测试：待补
  - 备注：底层走流式 scanner，不复制另一套遍历器。
- [ ] `folder.penetrate.depth` 穿透最大深度
  - 目标：最大深度支持 1/2/3/5/10/无限，并在循环链接、权限错误和巨大树上有安全上限。
  - 源码：`components/FolderToolbar/tabs/OtherTab.svelte`
  - 测试：待补
  - 备注：无限指逻辑深度不限，仍受资源预算和取消约束。
- [ ] `folder.penetrate.internal-files` 内部文件策略与纯媒体文件夹
  - 目标：内部文件支持 none/penetrate/always；纯媒体文件夹按设置直接作为书籍打开。
  - 源码：`components/FolderToolbar/tabs/OtherTab.svelte`
  - 测试：待补
  - 备注：判定使用共享 media/archive capability。

### migration（1）

- [ ] `folder.migration.bar` 迁移栏与迁移管理
  - 目标：保留迁移栏显隐、来源/目标、队列、执行、取消、进度和错误摘要；History/Bookmark 可有独立显隐设置。
  - 源码：`components/MigrationBar.svelte`、`components/FolderToolbar/FolderToolbar.svelte`
  - 测试：待补
  - 备注：具体文件迁移必须复用文件事务服务。

### ui-compatibility（4）

- [ ] `folder.ui.parity` 原版结构、密度与视觉状态一致
  - 目标：标签栏、面包屑、工具栏、树、列表、选择栏、迁移栏和菜单的层级、密度、图标、控件顺序及 hover/focus/selected/disabled/loading 状态尽量与原版一致。
  - 源码：`components/FolderTabBar.svelte`、`components/BreadcrumbBar.svelte`、`components/FolderToolbar/FolderToolbar.svelte`、`components/FolderStack.svelte`、`components/FolderListItem.svelte`
  - 测试：待补
  - 备注：允许适配 XR 设计 token，但不得无依据删减或重新布局。
- [ ] `folder.ui.responsive` 侧栏尺寸、窄视口与可停靠布局
  - 目标：在左右侧栏、独立窗口和窄高 Card 中控件不重叠，虚拟视口尺寸稳定，pin/折叠/resize 后恢复正确。
  - 源码：`components/FolderStack.svelte`、`components/FolderTree.svelte`、`stores/folderTabStore/layoutSettings.svelte.ts`
  - 测试：待补
  - 备注：桌面和 420x360 均需几何测试。
- [ ] `folder.ui.states` 空态、加载态、权限与错误恢复
  - 目标：空目录、无结果、加载、部分分页失败、权限拒绝、路径消失、文件变化和缩略图失败均有稳定 UI、重试和 Toast，不清空最后可用快照。
  - 源码：`components/FolderList.svelte`、`components/SearchResultList.svelte`、`components/FolderTree.svelte`
  - 测试：`neoview.folder.error-state`
  - 备注：当前 Card 有基础 loading/error 文本，尚未覆盖完整状态模型。
- [ ] `folder.ui.accessibility` 键盘、语义与可访问性
  - 目标：列表/Grid/树/标签/菜单具备正确 role、可见焦点、roving tabindex、aria-selected/expanded、屏幕阅读器名称和键盘等价操作。
  - 源码：`components/FolderList.svelte`、`components/FolderTabBar.svelte`、`components/FolderContextMenu.svelte`
  - 测试：待补
  - 备注：虚拟化焦点必须在卸载前转移。

### settings（1）

- [ ] `folder.settings.persistence` 全部文件浏览设置单一持久化版本
  - 目标：视图、排序、工具栏、树、预览、删除、穿透、空白动作和虚拟源设置规范化到 Xiranite TOML/专用数据库，不保留 localStorage 与多版本实现并存。
  - 源码：`stores/folderTabStore/layoutSettings.svelte.ts`、`stores/folderTabStore/sortingFiltering.svelte.ts`、`components/FolderToolbar/FolderToolbar.svelte`
  - 测试：待补
  - 备注：旧设置只在 migration codec 读取一次。

## 全部 77 张 Card

下表是逐卡迁移索引。`功能域` 只是第一层归属；每张 Card 开工时仍必须像 `folderMain` 一样把源码内全部命令、字段、模式和状态展开为专用明细，审计通过后才能实现。

### Panel: `benchmark`（16）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `visibility` | 可见性监控 | deferred | pending | `src/lib/cards/benchmark/VisibilityCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `latency` | 延迟分析 | deferred | pending | `src/lib/cards/benchmark/LatencyCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `renderer` | 渲染模式测试 | deferred | pending | `src/lib/cards/benchmark/RendererCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `files` | 文件选择 | deferred | pending | `src/lib/cards/benchmark/FilesCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `detailed` | 详细结果 | deferred | pending | `src/lib/cards/benchmark/DetailedCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `loadmode` | 加载模式 | deferred | pending | `src/lib/cards/benchmark/LoadModeCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `archives` | 压缩包扫描 | deferred | pending | `src/lib/cards/benchmark/ArchivesCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `realworld` | 实际场景 | deferred | pending | `src/lib/cards/benchmark/RealWorldCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `imageSource` | 图像源对比 | deferred | pending | `src/lib/cards/benchmark/ImageSourceCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `protocolTest` | 协议测试 | deferred | pending | **registry-only**：旧 CardRenderer 没有组件映射；迁移前必须显式补齐或记录替代决策。 | 性能设置、基准、系统监控和诊断 |
| `results` | 测试结果 | deferred | pending | `src/lib/cards/benchmark/ResultsCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `summary` | 总结 | deferred | pending | `src/lib/cards/benchmark/SummaryCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `pipelineLatency` | 实时延迟监控 | deferred | pending | `src/lib/cards/benchmark/PipelineLatencyCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `transcodeBenchmark` | 超分预处理转码 | deferred | pending | `src/lib/cards/benchmark/TranscodeBenchmarkCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `thumbnailLatency` | 目录加载延迟 | deferred | pending | `src/lib/cards/benchmark/ThumbnailLatencyCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `pageFlipMonitor` | 翻页性能监控 | deferred | pending | `src/lib/cards/benchmark/PageFlipMonitorCard.svelte` | 性能设置、基准、系统监控和诊断 |

### Panel: `info`（6）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `preloadStatus` | 预加载状态 | core | pending | `src/lib/cards/info/PreloadStatusCard.svelte` | 预读、渐进加载、流传输和全局调度 |
| `bookInfo` | 书籍信息 | core | partial | `src/lib/cards/info/BookInfoCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据；XR `book-information` |
| `infoOverlay` | 信息悬浮窗 | deferred | pending | `src/lib/cards/info/InfoOverlayCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据 |
| `imageInfo` | 图像信息 | core | partial | `src/lib/cards/info/ImageInfoCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据；XR `image-information` |
| `storage` | 存储信息 | core | partial | `src/lib/cards/info/StorageCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据；XR `storage-information` |
| `time` | 时间信息 | core | partial | `src/lib/cards/info/TimeCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据；XR `time-information` |

### Panel: `insights`（7）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `systemMonitor` | 系统资源监控 | integration | pending | `src/lib/cards/monitor/SystemMonitorCard.svelte` | 性能设置、基准、系统监控和诊断 |
| `dailyTrend` | 最近 7 日阅读趋势 | deferred | pending | `src/lib/cards/insights/DailyTrendCard.svelte` | 历史、书签、阅读进度和数据洞察 |
| `readingStreak` | 连续阅读 Streak | deferred | pending | `src/lib/cards/insights/ReadingStreakCard.svelte` | 历史、书签、阅读进度和数据洞察 |
| `readingHeatmap` | 阅读时段热力图 | deferred | pending | `src/lib/cards/insights/ReadingHeatmapCard.svelte` | 历史、书签、阅读进度和数据洞察 |
| `bookmarkOverview` | 书签概览 | deferred | pending | `src/lib/cards/insights/BookmarkOverviewCard.svelte` | 历史、书签、阅读进度和数据洞察 |
| `sourceBreakdown` | 来源拆分 | deferred | pending | `src/lib/cards/insights/SourceBreakdownCard.svelte` | 历史、书签、阅读进度和数据洞察 |
| `emmTagsHot` | EMM 标签热度 | deferred | pending | `src/lib/cards/insights/EmmTagsHotCard.svelte` | 历史、书签、阅读进度和数据洞察 |

### Panel: `control`（9）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `switchToast` | 切换提示 | integration | pending | `src/lib/cards/info/SwitchToastCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据 |
| `sidebarControl` | 边栏控制 | integration | pending | `src/lib/cards/info/SidebarControlCard.svelte` | 左右边栏、顶部工具栏、底栏、面板和通知 |
| `colorFilter` | 颜色滤镜 | integration | pending | `src/lib/cards/info/ColorFilterCard.svelte` | 图片裁边、颜色滤镜、页面过渡和悬停滚动 |
| `imageTrim` | 图像裁剪 | integration | pending | `src/lib/cards/info/ImageTrimCard.svelte` | 图片裁边、颜色滤镜、页面过渡和悬停滚动 |
| `pageTransition` | 翻页动画 | deferred | pending | `src/lib/cards/info/PageTransitionCard.svelte` | 图片裁边、颜色滤镜、页面过渡和悬停滚动 |
| `animatedVideoMode` | 动图视频模式 | integration | pending | `src/lib/cards/info/AnimatedVideoModeCard.svelte` | 动图、视频、字幕和播放控制 |
| `ambientBackground` | 动态背景 | deferred | pending | `src/lib/cards/info/AmbientBackgroundCard.svelte` | 主题接管、阅读背景和空页面背景 |
| `sidebarHeight` | 侧边栏高度 | deferred | pending | `src/lib/cards/info/SidebarHeightCard.svelte` | 左右边栏、顶部工具栏、底栏、面板和通知 |
| `thumbnailMaintenance` | 缩略图维护 | integration | pending | `src/lib/cards/properties/ThumbnailMaintenanceCard.svelte` | 统一缩略图生成、持久化、数据库维护与迁移 |

### Panel: `properties`（9）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `emmTags` | EMM 标签 | integration | pending | `src/lib/cards/properties/EmmTagsCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |
| `bookSettings` | 本书设置 | core | pending | `src/lib/cards/properties/BookSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一 |
| `folderRatings` | 文件夹平均评分 | integration | pending | `src/lib/cards/properties/FolderRatingsCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |
| `favoriteTags` | 收藏标签快选 | integration | pending | `src/lib/cards/properties/FavoriteTagsCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |
| `emmSync` | EMM 同步 | integration | pending | `src/lib/cards/properties/EmmSyncCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |
| `thumbnailArchMetrics` | 缩略图架构指标 | integration | pending | `src/lib/cards/properties/ThumbnailArchitectureMetricsCard.svelte` | 统一缩略图生成、持久化、数据库维护与迁移 |
| `emmRawData` | EMM 数据库记录 | integration | pending | `src/lib/cards/properties/EmmRawDataCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |
| `emmConfig` | EMM 配置 | integration | pending | `src/lib/cards/properties/EmmConfigCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |
| `fileListTagDisplay` | 文件列表标签 | integration | pending | `src/lib/cards/properties/FileListTagDisplayCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |

### Panel: `upscale`（6）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `upscaleControl` | 超分控制 | deferred | pending | `src/lib/cards/upscale/UpscaleControlCard.svelte` | 超分模型、预览、队列、缓存与保存 |
| `upscaleModel` | 模型选择 | deferred | pending | `src/lib/cards/upscale/UpscaleModelCard.svelte` | 超分模型、预览、队列、缓存与保存 |
| `upscaleStatus` | 处理状态 | deferred | pending | `src/lib/cards/upscale/UpscaleStatusCard.svelte` | 超分模型、预览、队列、缓存与保存 |
| `upscaleCache` | 缓存管理 | deferred | pending | `src/lib/cards/upscale/UpscaleCacheCard.svelte` | 超分模型、预览、队列、缓存与保存 |
| `upscaleConditions` | 条件超分 | deferred | pending | `src/lib/cards/upscale/UpscaleConditionsCard.svelte` | 超分模型、预览、队列、缓存与保存 |
| `progressiveUpscale` | 预超分 | deferred | pending | `src/lib/cards/upscale/ProgressiveUpscaleCard.svelte` | 超分模型、预览、队列、缓存与保存 |

### Panel: `history`（1）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `historyList` | 历史记录 | core | partial | `src/lib/cards/history/HistoryListCard.svelte` | 历史、书签、阅读进度和数据洞察；XR `history-list` |

### Panel: `bookmark`（1）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `bookmarkList` | 书签列表 | core | partial | `src/lib/cards/bookmark/BookmarkListCard.svelte` | 历史、书签、阅读进度和数据洞察；XR `bookmark-list` |

### Panel: `pageList`（1）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `pageListMain` | 页面列表 | core | partial | `src/lib/cards/pageList/PageListCard.svelte` | 页面构建、排序、跳转与边界行为；XR `page-navigation` |

### Panel: `folder`（1）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `folderMain` | 文件夹 | core | partial | `src/lib/cards/folder/FolderMainCard.svelte` | 文件与文件夹浏览、标签页和树导航；XR `folder-main` |

### Panel: `ai`（8）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `aiTags` | AI 标签推断 | deferred | pending | `src/lib/cards/properties/AiTagsCard.svelte` | Ollama、AI 面板和翻译服务 |
| `aiApiConfig` | AI API 配置 | deferred | pending | `src/lib/cards/properties/AiApiConfigCard.svelte` | Ollama、AI 面板和翻译服务 |
| `aiTitleTranslation` | 标题翻译 | deferred | pending | `src/lib/cards/ai/AiTitleTranslationCard.svelte` | Ollama、AI 面板和翻译服务 |
| `aiServiceConfig` | 翻译服务配置 | deferred | pending | `src/lib/cards/ai/AiServiceConfigCard.svelte` | Ollama、AI 面板和翻译服务 |
| `aiTranslationCache` | 翻译缓存 | deferred | pending | `src/lib/cards/ai/AiTranslationCacheCard.svelte` | Ollama、AI 面板和翻译服务 |
| `aiTranslationTest` | 翻译测试 | deferred | pending | `src/lib/cards/ai/AiTranslationTestCard.svelte` | Ollama、AI 面板和翻译服务 |
| `translationOverlay` | 翻译叠加层 | deferred | pending | `src/lib/cards/ai/TranslationOverlayCard.svelte` | Ollama、AI 面板和翻译服务 |
| `voiceControl` | 语音控制 | deferred | pending | `src/lib/cards/ai/VoiceControlCard.svelte` | Ollama、AI 面板和翻译服务 |

### Panel: `settings`（12）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `settingsGeneral` | 通用设置 | deferred | pending | `src/lib/cards/settings/GeneralSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一 |
| `settingsSystem` | 系统设置 | deferred | pending | `src/lib/cards/settings/SystemSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一 |
| `settingsView` | 视图设置 | deferred | partial | `src/lib/cards/settings/ViewSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一；XR `view-defaults-settings` |
| `settingsImage` | 影像设置 | integration | pending | `src/lib/cards/settings/ImageSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一 |
| `settingsBook` | 书籍设置 | integration | pending | `src/lib/cards/settings/BookSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一 |
| `settingsPerformance` | 性能设置 | integration | pending | `src/lib/cards/settings/PerformanceSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一 |
| `settingsTheme` | 外观设置 | deferred | pending | `src/lib/cards/settings/ThemeSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一 |
| `settingsNotification` | 通知设置 | deferred | pending | `src/lib/cards/settings/NotificationSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一 |
| `settingsPanels` | 边栏管理 | deferred | partial | `src/lib/cards/settings/PanelManagementCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一；XR `sidebar-management-settings` |
| `settingsCards` | 卡片管理 | deferred | partial | `src/lib/cards/settings/CardManagementCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一；XR `panel-layout-settings` |
| `settingsBindings` | 操作绑定 | deferred | pending | `src/lib/cards/settings/BindingsSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一 |
| `settingsData` | 数据设置 | deferred | pending | `src/lib/cards/settings/DataSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一 |

## 每张 Card 的专用清单模板

每张 Card 的专用 JSON 至少包含以下 10 类，不能以这份模板本身代替源码逐项清单：

1. `capabilities`：全部命令、模式、数据字段、批量动作和跨模块联动。
2. `ui-parity`：层级、控件、图标、文字、密度、尺寸和响应式几何。
3. `interaction-states`：默认、hover、focus、selected、disabled、loading、empty、partial、error、retry、disposed。
4. `settings`：默认值、旧键、优先级、TOML 目标字段、重置和导入。
5. `keyboard-accessibility`：快捷键、焦点顺序、语义角色、IME 排除和可访问名称。
6. `data-contract`：DTO、稳定身份、分页/流、取消、generation、错误和过期结果。
7. `lifecycle`：lazy load、open、suspend、resume、close、dispose 和失败清理。
8. `performance`：代表性语料、延迟、内存、DOM、任务和缓存预算。
9. `tests`：稳定测试 ID、交互、截图/几何和性能回归。
10. `deviations`：删减、替换或有意改变的旧行为及理由。
