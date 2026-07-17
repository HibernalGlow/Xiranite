# NeoView Card 完整功能与 UI 验收清单

> 本文件由 `bun run generate:neoview-card-checklist` 生成。机器事实源为 `migration/neoview/preload-status-compatibility.json`、`migration/neoview/book-information-compatibility.json`、`migration/neoview/image-information-compatibility.json`、`migration/neoview/storage-information-compatibility.json`、`migration/neoview/time-information-compatibility.json`、`migration/neoview/sidebar-control-compatibility.json`、`migration/neoview/book-settings-compatibility.json`、`migration/neoview/history-list-compatibility.json`、`migration/neoview/bookmark-list-compatibility.json`、`migration/neoview/page-list-compatibility.json`、`migration/neoview/folder-main-compatibility.json`、`migration/neoview/input-bindings-compatibility.json`、`migration/neoview/card-functional-scopes.json`、`migration/neoview/card-compatibility.json`，请勿只改本文件。

## 完成规则

- 所有 Card 都执行“先冻结源码清单，再实现，再验收”；只有标题或后端 API 不算完成。
- `complete/migrated` 必须覆盖功能、UI 层级、控件与图标、交互状态、持久化、键盘/无障碍、共享 GUI/CLI/TUI 契约、生命周期、性能、测试和有意偏离。
- UI 默认保持旧版信息层级、密度和操作位置；只允许使用 XR 设计 token 和既有通用组件做等价适配。桌面侧栏、窄侧栏和独立 Card 窗口都要有截图或几何证据。
- `pending/partial` 是真实状态，不得为了提高数字提前改成完成；旧版自身缺失的能力必须标为 `registry-only` 或记录替代决策。
- Windows 重验证严格串行，Vitest 固定 `--maxWorkers=1`，防止清单验证本身触发内存耗尽。

## 文件浏览器 `folderMain`

共 74 项：`partial=39`，`complete=16`，`pending=19`。以下是完整验收项，不是自然排序或单列表的缩减版。

### 旧版源码 UI/控件库存（19 组，325 项）

这里逐项冻结原版可见控件、选项值、字段和状态。实现不能只满足下方 74 个能力域；本库存中的每一项也必须保留，或记录明确的替代/偏离决策。

#### `folder-ui.shell` 整体结构与布局宿主

- 源码：`FolderPanel.svelte`、`components/FolderStack.svelte`、`components/FolderToolbar/FolderToolbar.svelte`
- 映射：`folder.nav.stack`、`folder.tabs.layout`、`folder.ui.parity`、`folder.ui.responsive`
- [ ] FolderPanel 宿主
- [ ] FolderTabBar 标签栏
- [ ] BreadcrumbBar 面包屑/路径输入
- [ ] FolderToolbar 工具栏
- [ ] FolderStack 分层内容区
- [ ] FolderTree 外置树
- [ ] InlineTreeList 内联树
- [ ] SelectionBar 多选栏
- [ ] MigrationBar 迁移栏
- [ ] PenetrateSettingsBar 穿透设置栏
- [ ] FavoriteTagPanel 收藏标签面板
- [ ] FolderContextMenu 项目右键菜单

#### `folder-ui.navigation` 导航工具栏

- 源码：`components/FolderToolbar/NavigationButtons.svelte`
- 映射：`folder.nav.history`、`folder.nav.parent`、`folder.nav.home-refresh`、`folder.virtual.cleanup`
- [ ] 主页
- [ ] 右键把当前目录设为主页
- [ ] 后退 Alt+Left
- [ ] 前进 Alt+Right
- [ ] 返回上级 Alt+Up
- [ ] 刷新普通目录
- [ ] 重新加载历史
- [ ] 重新加载书签
- [ ] 历史/书签选择时同步文件夹开关
- [ ] 清理失效记录
- [ ] 高级清理选项
- [ ] 一键清空历史/书签
- [ ] 清理结果数量反馈
- [ ] 清理中禁用状态

#### `folder-ui.breadcrumb` 面包屑与路径编辑

- 源码：`components/BreadcrumbBar.svelte`
- 映射：`folder.nav.path`、`folder.tabs.lifecycle`、`folder.ui.responsive`、`folder.ui.states`
- [ ] 根目录/盘符段
- [ ] 逐级路径段跳转
- [ ] 被折叠路径段的下拉菜单
- [ ] 当前段状态
- [ ] 进入路径编辑
- [ ] Enter 确认路径
- [ ] Escape 取消编辑
- [ ] blur 提交/取消规则
- [ ] 无效路径错误反馈
- [ ] 复制当前路径
- [ ] 从面包屑新建标签
- [ ] 水平/垂直布局下等价操作

#### `folder-ui.tabs` 文件夹标签栏

- 源码：`components/FolderTabBar.svelte`、`stores/folderTabStore/tabManagement.svelte.ts`
- 映射：`folder.tabs.lifecycle`、`folder.tabs.bulk-close`、`folder.tabs.pin-duplicate`、`folder.tabs.reopen`、`folder.tabs.navigation-history`、`folder.tabs.layout`
- [ ] 创建标签
- [ ] 切换标签
- [ ] 关闭标签
- [ ] 复制标签及完整浏览状态
- [ ] 复制标签路径
- [ ] 固定/取消固定标签
- [ ] 滚动到当前焦点项
- [ ] 关闭其他标签
- [ ] 关闭左侧标签
- [ ] 关闭右侧标签
- [ ] 恢复最近关闭标签
- [ ] 最近关闭最多 10 项
- [ ] 固定标签关闭保护
- [ ] 活动标签访问历史
- [ ] 关闭活动标签后选择最近访问项
- [ ] 标签栏 none/top/left/right/bottom 布局
- [ ] 标签栏宽度
- [ ] 标签溢出与窄栏行为

#### `folder-ui.views` 视图模式与尺寸

- 源码：`components/FolderList.svelte`、`components/FolderListItem.svelte`、`components/FolderToolbar/ViewPanel.svelte`、`components/FolderToolbar/ViewModeButtons.svelte`、`components/FolderToolbar/tabs/DisplayTab.svelte`
- 映射：`folder.view.modes`、`folder.view.details`、`folder.view.thumbnail-size`、`folder.view.banner-width`、`folder.ui.parity`、`folder.ui.states`
- [ ] list 列表视图
- [ ] content 内容视图
- [ ] banner 横幅视图
- [ ] thumbnail 缩略图视图
- [ ] thumbnail 紧凑模式
- [ ] 目标 details 详细信息视图
- [ ] 缩略图宽度 10-90% 连续调节
- [ ] 缩略图像素反馈
- [ ] 横幅宽度 20-100% 调节
- [ ] 横幅列数反馈
- [ ] 响应式列数
- [ ] 模式切换保持选中项与滚动锚点
- [ ] 文件夹/归档/图像/视频类型图标
- [ ] 名称、路径与扩展信息
- [ ] 评分、收藏标签与普通标签徽标
- [ ] 缺图占位与错误态

#### `folder-ui.details` 详细信息表格

- 源码：`components/FolderListItem.svelte`、`stores/folderPanelStore/types.ts`
- 映射：`folder.view.details`、`folder.view.virtualization`、`folder.select.restore`、`folder.performance.budgets`
- [ ] 名称列
- [ ] 路径列
- [ ] 类型列
- [ ] 扩展名列
- [ ] 大小列
- [ ] 修改时间列
- [ ] 图像尺寸列
- [ ] 页数列
- [ ] 评分列
- [ ] 标签列
- [ ] 列显隐
- [ ] 名称列不可隐藏
- [ ] 列拖拽排序
- [ ] 列左固定
- [ ] 列右固定
- [ ] 列取消固定
- [ ] 列宽调整与持久化
- [ ] 截断文本 tooltip
- [ ] 排序/过滤后的稳定行 ID
- [ ] 未加载稀疏行占位
- [ ] 10K/100K 远端虚拟滚动
- [ ] 滚动到选中项

#### `folder-ui.preview` 封面、Mosaic 与 Hover 预览

- 源码：`components/FolderListItem.svelte`、`components/FolderToolbar/tabs/DisplayTab.svelte`
- 映射：`folder.view.hover-preview`、`folder.view.folder-mosaic`、`folder.view.thumbnail-pipeline`、`folder.view.virtualization`
- [ ] 文件单封面
- [ ] 文件夹单封面
- [ ] 文件夹 4 图 2x2
- [ ] 文件夹 9 图 3x3
- [ ] 文件夹 16 图 4x4
- [ ] 多图预览开关
- [ ] 稳定选图顺序
- [ ] 可见项批量 demand
- [ ] 离屏取消
- [ ] Hover 预览开关
- [ ] Hover 200ms 延迟
- [ ] Hover 500ms 延迟
- [ ] Hover 800ms 延迟
- [ ] Hover 1200ms 延迟
- [ ] 离开/滚动/切标签取消 Hover
- [ ] 预览加载/缺图/失败状态
- [ ] 单个可见项最多一个 img
- [ ] Opaque URL 且不暴露路径

#### `folder-ui.sort` 完整排序面板

- 源码：`components/FolderToolbar/SortPanel.svelte`、`components/FolderStack/sortingUtils.ts`、`stores/folderTabStore/sortingFiltering.svelte.ts`
- 映射：`folder.sort.fields`、`folder.sort.name`、`folder.sort.directories-first`、`folder.sort.folder-size`、`folder.sort.random`、`folder.sort.emm`、`folder.sort.precedence`、`folder.sort.memory`、`folder.sort.virtual`
- [ ] name 名称排序
- [ ] path 路径排序
- [ ] date 日期/虚拟源添加时间排序
- [ ] size 文件与目录大小排序
- [ ] type 类型排序
- [ ] random 稳定随机排序
- [ ] rating EMM 评分排序
- [ ] collectTagCount 收藏标签数量排序
- [ ] 升序
- [ ] 降序
- [ ] 随机排序隐藏无意义方向
- [ ] 目录优先
- [ ] 当前文件夹临时规则
- [ ] 标签默认排序
- [ ] 全局默认排序
- [ ] 文件夹排序记忆
- [ ] 清空文件夹排序记忆
- [ ] 显示当前命中排序来源
- [ ] 临时 > 记忆 > 标签默认 > 全局默认
- [ ] 字段相等时名称/稳定 ID 兜底
- [ ] 虚拟源独立日期语义

#### `folder-ui.selection` 选择、焦点与键盘

- 源码：`components/SelectionBar.svelte`、`components/FolderList.svelte`、`components/FolderListItem.svelte`、`utils/keyboardHandler.ts`、`stores/chainSelectStore.svelte.ts`
- 映射：`folder.select.basic`、`folder.select.range`、`folder.select.bulk`、`folder.select.restore`、`folder.keyboard.navigation`、`folder.keyboard.commands`
- [ ] 单击单选
- [ ] Ctrl/Meta toggle
- [ ] Shift 范围选择
- [ ] 链式选择 anchor
- [ ] 焦点项与 selected set 分离
- [ ] 选择全部
- [ ] 反转选择
- [ ] 取消全部选择
- [ ] 显示已选数量
- [ ] 多选打开/浏览
- [ ] 批量复制
- [ ] 批量剪切
- [ ] 批量删除
- [ ] 退出多选模式
- [ ] Arrow 四向导航
- [ ] Home/End
- [ ] PageUp/PageDown
- [ ] Enter 打开
- [ ] Backspace 后退
- [ ] F5 刷新
- [ ] Delete 删除
- [ ] Ctrl/Cmd+A
- [ ] Ctrl/Cmd+F
- [ ] Escape 取消
- [ ] 输入框/菜单/IME 键盘排除
- [ ] 虚拟化卸载后身份不丢失
- [ ] 前进/后退/上级/切标签恢复焦点、选择和滚动

#### `folder-ui.search-filter` 搜索、标签与类型筛选

- 源码：`components/SearchResultList.svelte`、`components/AdvancedSearchPanel.svelte`、`components/FavoriteTagPanel.svelte`、`components/FolderToolbar/TypeFilterBar.svelte`、`stores/folderTabStore/sortingFiltering.svelte.ts`
- 映射：`folder.search.current`、`folder.search.recursive`、`folder.search.emm-tags`、`folder.filter.type`
- [ ] 当前目录名称搜索
- [ ] 路径搜索开关
- [ ] 包含子目录搜索
- [ ] 流式递归搜索
- [ ] 搜索加载/空/错误态
- [ ] 搜索历史
- [ ] 聚焦显示搜索历史开关
- [ ] 清除搜索
- [ ] 高级搜索面板
- [ ] EMM 标签搜索
- [ ] 收藏标签搜索
- [ ] 随机标签推荐
- [ ] 标签面板固定/取消固定
- [ ] 全部类型
- [ ] 压缩包类型
- [ ] 文件夹类型
- [ ] 视频类型
- [ ] 类型筛选栏展开/收起
- [ ] 搜索结果继续虚拟化
- [ ] 取消过期查询

#### `folder-ui.tree` 文件树与 FolderStack

- 源码：`components/FolderTree.svelte`、`components/InlineTreeList.svelte`、`components/FolderStack.svelte`、`components/FolderToolbar/TreePanel.svelte`、`utils/directoryTreeCache.ts`
- 映射：`folder.nav.stack`、`folder.tree.panel`、`folder.tree.layout-pin`、`folder.tree.inline`、`folder.tree.cache`、`folder.arch.watch`
- [ ] 文件树显示/隐藏
- [ ] 树节点惰性展开
- [ ] 树节点折叠
- [ ] 活动路径跟随
- [ ] 树位置 top/left/right/bottom
- [ ] 树尺寸拖动
- [ ] 树 pin/取消 pin
- [ ] 外置 Tree 与当前目录单层列表同时存在且选择隔离
- [ ] 主视图内联树模式
- [ ] 父/当前/子 FolderStack 层
- [ ] 每层独立滚动与选择
- [ ] 刷新树
- [ ] 清理树缓存
- [ ] 排除当前目录
- [ ] 取消排除
- [ ] 活动根增量监听
- [ ] 卸载时 unsubscribe

#### `folder-ui.virtual-sources` 书签、历史和虚拟搜索源

- 源码：`utils/virtualPathLoader.ts`、`components/FolderToolbar/NavigationButtons.svelte`、`components/FolderToolbar/TypeFilterBar.svelte`
- 映射：`folder.sort.virtual`、`folder.virtual.sources`、`folder.virtual.cleanup`
- [ ] virtual://bookmark
- [ ] virtual://history
- [ ] virtual://search
- [ ] 历史访问时间语义
- [ ] 书签创建时间语义
- [ ] 虚拟源独立排序/视图
- [ ] 点击历史同步文件夹
- [ ] 点击书签同步文件夹
- [ ] 清理失效记录
- [ ] 高级清理筛选
- [ ] 清空全部二次确认
- [ ] 按 archive/folder/video 筛选
- [ ] 刷新虚拟源
- [ ] 失效源稳定降级

#### `folder-ui.file-actions` 文件与目录操作

- 源码：`components/FolderContextMenu.svelte`、`components/SelectionBar.svelte`
- 映射：`folder.op.open`、`folder.op.system`、`folder.op.clipboard`、`folder.op.copy-metadata`、`folder.op.rename`、`folder.op.delete`、`folder.op.undo-delete`、`folder.op.bookmark`、`folder.op.context-menu`
- [ ] 浏览目录
- [ ] 在新标签打开目录
- [ ] 作为书籍打开
- [ ] 打开文件
- [ ] 打开所在文件夹
- [ ] 系统默认软件打开
- [ ] 资源管理器定位
- [ ] 复制
- [ ] 剪切
- [ ] 粘贴
- [ ] 复制路径
- [ ] 复制名称
- [ ] 重命名
- [ ] 回收站删除
- [ ] 永久删除
- [ ] 批量删除
- [ ] 删除确认
- [ ] 删除进度
- [ ] 撤销上一次删除
- [ ] 添加书签
- [ ] 移除书签
- [ ] 按项目类型/选择数/剪贴板状态禁用动作
- [ ] 成功 Toast
- [ ] 错误 Toast
- [ ] 部分失败结果

#### `folder-ui.thumbnail-actions` 缩略图维护快捷操作

- 源码：`components/FolderToolbar/tabs/ActionTab.svelte`
- 映射：`folder.op.thumbnail`、`folder.arch.dispose`、`folder.view.thumbnail-pipeline`
- [ ] 递归预热当前目录
- [ ] 显示预热当前项/完成数/总数
- [ ] 取消预热
- [ ] 重载当前目录全部缩略图
- [ ] 显示重载进度
- [ ] 重载选中项缩略图
- [ ] 空目录反馈
- [ ] 未选择反馈
- [ ] 重载时禁用重复操作
- [ ] 刷新统一缩略图缓存
- [ ] Card 关闭取消后台任务

#### `folder-ui.emm` EMM 信息与编辑

- 源码：`components/FolderListItem.svelte`、`components/FavoriteTagPanel.svelte`、`components/FolderToolbar/tabs/OtherTab.svelte`
- 映射：`folder.sort.emm`、`folder.search.emm-tags`、`folder.emm.metadata`、`folder.emm.display`、`folder.emm.edit`
- [ ] 批量读取评分
- [ ] 批量读取收藏标签数量
- [ ] 显示 EMM 标签
- [ ] 显示 manual 标签
- [ ] 显示 AI 标签
- [ ] 标签数量/截断/tooltip 规则
- [ ] 默认评分 0-5 且步进 0.1
- [ ] 默认评分快捷值 3.5/4.0/4.5/5.0
- [ ] 编辑评分
- [ ] 编辑/添加/移除标签
- [ ] 收藏标签快捷应用
- [ ] EMM 缺库/缺列降级
- [ ] 同步中状态
- [ ] 数据库错误状态
- [ ] EMM 排序 hydration 保持选择身份

#### `folder-ui.penetration` 穿透与递归显示

- 源码：`components/PenetrateSettingsBar.svelte`、`components/FolderToolbar/ActionButtons.svelte`
- 映射：`folder.penetrate.mode`、`folder.penetrate.depth`、`folder.penetrate.internal-files`
- [ ] 穿透模式开关
- [ ] 穿透设置栏
- [ ] 最大深度 1/2/3/5/10/无限
- [ ] 内部文件 none/penetrate/always
- [ ] 纯媒体文件夹识别
- [ ] single/all 文件夹范围
- [ ] 在新标签打开模式
- [ ] 递归显示快捷开关
- [ ] 循环/过深保护
- [ ] 取消旧穿透任务
- [ ] 路径身份稳定

#### `folder-ui.migration` 迁移栏

- 源码：`components/MigrationBar.svelte`
- 映射：`folder.migration.bar`、`folder.ui.states`
- [ ] 迁移栏显示/隐藏
- [ ] 迁移目标列表
- [ ] 新增目标名称
- [ ] 新增目标路径
- [ ] 编辑目标
- [ ] 删除目标
- [ ] 选择目标
- [ ] 把选中项目加入迁移
- [ ] 迁移队列
- [ ] 迁移进度
- [ ] 取消迁移
- [ ] 冲突处理
- [ ] 成功/失败/部分完成状态
- [ ] 目标路径失效反馈
- [ ] 迁移完成刷新目录

#### `folder-ui.more-settings` 更多设置与空白区行为

- 源码：`components/FolderToolbar/MoreSettingsTabs.svelte`、`components/FolderToolbar/tabs/ActionTab.svelte`、`components/FolderToolbar/tabs/DisplayTab.svelte`、`components/FolderToolbar/tabs/OtherTab.svelte`
- 映射：`folder.nav.blank-action`、`folder.nav.bottom-return`、`folder.settings.persistence`、`folder.ui.parity`
- [ ] 快捷操作/显示设置/其他 三页
- [ ] 显示当前文件数
- [ ] 工具栏 tooltip 开关
- [ ] 单击空白 none/goUp/goBack
- [ ] 双击空白 none/goUp/goBack
- [ ] 列表底部返回按钮显示/隐藏
- [ ] 清除当前标签导航历史
- [ ] 显示/隐藏搜索栏
- [ ] 显示/隐藏迁移栏
- [ ] 显示/隐藏随机标签栏
- [ ] 全部设置持久化
- [ ] 恢复默认值
- [ ] 旧 localStorage 设置导入一次
- [ ] 未知未来配置无损保留

#### `folder-ui.states-performance` 状态、生命周期与性能门禁

- 源码：`components/FolderList.svelte`、`components/FolderStack/FolderDataLoader.ts`、`stores/folderPanelStore/core.svelte.ts`、`utils/directoryTreeCache.ts`
- 映射：`folder.arch.session`、`folder.arch.page`、`folder.arch.dispose`、`folder.view.virtualization`、`folder.ui.states`、`folder.ui.accessibility`、`folder.performance.budgets`
- [ ] 初始空态
- [ ] 目录为空
- [ ] 加载首批
- [ ] 加载更多
- [ ] 权限拒绝
- [ ] 路径不存在
- [ ] 目录变化失效
- [ ] 单项 metadata 失败
- [ ] 缩略图失败
- [ ] 可重试错误
- [ ] 焦点/hover/selected/active/disabled 视觉状态
- [ ] 桌面 Card 截图
- [ ] 窄 Card 截图
- [ ] 独立 Card 窗口截图
- [ ] 10K 目录 DOM/Heap 门禁
- [ ] 100K 目录 DOM/Heap 门禁
- [ ] 前进/后退恢复定位延迟门禁
- [ ] 搜索取消延迟门禁
- [ ] 缩略图并发与字节预算
- [ ] 折叠停止后台工作
- [ ] 关闭标签释放会话
- [ ] 关闭 Card 释放 watcher/Worker/cache lease
- [ ] 普通 Reader 未打开文件浏览器时零常驻任务

### 源码级验收项

### architecture（5）

- [ ] `folder.arch.session` 有界目录浏览会话
  - 目标：一个 ReaderFileTreeService 会话维护稳定 generation、显式关闭、取消和有界缓存；GUI/CLI/TUI 不各建目录实现。
  - 源码：`stores/folderPanelStore/core.svelte.ts`、`components/FolderStack/FolderDataLoader.ts`
  - 测试：`neoview.browser.navigation`、`neoview.browser.cancel`、`neoview.folder.file-tree-service`
  - 备注：单层 listing、导航、排序、递归 scanner 和按需 watcher 已收口到唯一 ReaderFileTreeService；前端稀疏 catalog 与完整多标签会话仍待完成。
- [ ] `folder.arch.page` 任意 cursor 分页与稳定快照
  - 目标：可按任意 cursor/limit 拉取稳定快照，目录变化通过 generation 失效，不向前端一次性返回完整大目录。
  - 源码：`components/FolderStack/FolderDataLoader.ts`、`stores/folderPanelStore/types.ts`
  - 测试：`neoview.folder.browser-page`、`neoview.folder.catalog-sparse`
  - 备注：当前每页 128 项；尚未完成排序/过滤后稳定分页契约。
- [ ] `folder.arch.scan` 单层与递归扫描分层
  - 目标：单层列举使用原生 opendir/Dirent；递归索引与搜索使用唯一 readdirp adapter，支持 AbortSignal、背压和批次输出。
  - 源码：`utils/directoryTreeCache.ts`、`components/FolderTree.svelte`
  - 测试：`neoview.file-tree.opendir`、`neoview.file-tree.readdirp`、`neoview.file-tree.scan-limit`、`neoview.folder.file-tree-service`
  - 备注：单层 opendir provider 与 readdirp scanner 已由 ReaderFileTreeService 按 session 根统一编排；流式 HTTP 搜索 surface 与排除规则仍待完成。
- [x] `folder.arch.watch` 文件树增量监听
  - 目标：按需动态加载 @parcel/watcher，仅监听活动根；事件合并后增量修补 generation，最后消费者关闭即 unsubscribe。
  - 源码：`utils/directoryTreeCache.ts`、`components/FolderTree.svelte`
  - 测试：`neoview.file-tree.watcher`、`neoview.file-tree.watcher-native`、`neoview.folder.file-tree-service`、`neoview.folder.watch-http`、`neoview.folder.watch-cancellation`、`neoview.folder.watch-long-poll`、`neoview.folder.watch-client`、`neoview.folder.watch-gui`、`neoview.folder.tree-watch-stream`、`neoview.folder.tree-watch-http`、`neoview.folder.tree-watch-client`、`neoview.folder.tree-watch-gui`、`neoview.folder.watch-live-e2e`
  - 备注：File Card 默认以 watch:true 打开唯一 browser session，@parcel/watcher 仅监听活动当前目录且仍为 Node 端动态 import。当前目录直接子项事件进入 /changes：已有 service 单飞重读后递增 listing generation，list/grid/details 保持 Virtuoso 视口、path selection 与 focus identity，旧索引区间安全清除。递归子目录事件只进入独立 /tree/changes revision：32 个父路径有界 ring 仅让已加载展开节点重读，折叠节点按需失效，落后消费者才安全 reset 当前祖先链；Folder Tree 层级从不混入普通列表。两路 25 秒无变化均返回 204，错误停止续订；关闭 Tree、导航、关闭 session 和卸载会 Abort waiter，最后消费者关闭即 unsubscribe。desktop/420x360 已验证外部目录 create/delete 同时更新独立 Tree 和当前目录列表且焦点、选择、阅读图片稳定。DirectoryWatch 为 774-byte 二级 lazy chunk，FolderTreeWorkspace 为 13,837 bytes，@parcel/watcher 零浏览器模块。
- [ ] `folder.arch.dispose` 取消、释放与休眠
  - 目标：切换 Panel 或 Edge 自动隐藏时保留 File Card DOM、目录会话和交互状态，仅暂停 watcher 与缩略图需求；切目录、关闭标签和真正卸载 Card 时取消过期分页/扫描/缩略图并释放 watcher、thumbnail context、browser session 和 Worker。
  - 源码：`components/FolderStack.svelte`、`utils/directoryTreeCache.ts`
  - 测试：`neoview.folder.file-tree-service`、`neoview.folder.watch-http`、`neoview.folder.watch-cancellation`、`neoview.folder.watch-long-poll`、`neoview.folder.watch-gui`、`neoview.folder.watch-live-e2e`、`neoview.folder.panel-keepalive`、`neoview.folder.panel-keepalive-e2e`
  - 备注：File Card 首次访问后在 Panel 切换和 Edge 自动隐藏期间保持 mounted，browser session、catalog、选择、标签与 DOM identity 均保留；隐藏态停止当前目录和独立 Folder Tree 的 watch，并停止注册新缩略图需求，恢复可见后继续同一会话。ReaderFileTreeService 已在 DELETE、导航换根、session 淘汰和真正 dispose 时释放 watcher；Card 分页、缩略图 context 和 generation 长轮询均在导航/卸载时 Abort，最后消费者关闭即 unsubscribe。搜索/Worker 休眠仍待完成。

### navigation（7）

- [x] `folder.nav.path` 路径输入与直接跳转
  - 目标：面包屑与可编辑路径输入可互换；Enter 确认、Escape 取消、blur 行为及无效路径反馈与原版一致。
  - 源码：`components/BreadcrumbBar.svelte`
  - 测试：`neoview.folder.path-navigation`
  - 备注：共享 FolderBreadcrumb 解析 Windows 盘符、UNC 与 POSIX 根路径，按宽度保留根和末段并将中间段折叠到菜单；面包屑与完整路径输入互换，Enter 确认、Escape/blur 取消，失败导航保留当前 catalog，支持复制路径及 Alt+Left/Right/Up、F5。真实 Chromium 验证进入子目录后 list/grid/details 仍只消费当前目录 direct children，Folder Tree 保持独立层级导航；新建标签仍归 folder.tabs.lifecycle。
- [x] `folder.nav.history` 前进、后退与导航历史
  - 目标：每标签维护分支正确的前进/后退历史，并恢复目录、滚动、焦点、选择和临时排序。
  - 源码：`stores/folderTabStore/navigationHistory.svelte.ts`、`components/FolderToolbar/NavigationButtons.svelte`
  - 测试：`neoview.folder.nav-history`、`neoview.folder.nav-history-ui`、`neoview.folder.nav-history-e2e`
  - 备注：ReaderFileTreeService 以最多 50 条的访问记录而非路径字符串维护分支历史，并为重复路径分配独立 navigationEntryId；失败导航不推进历史，分支导航清空 forward，临时排序跟随具体访问。FolderMainCard 按访问 ID 有界保存 renderer、多选模式、选择、焦点和 Virtuoso list/grid snapshot，details 保存原始 scrollTop 并在虚拟行测量后保持同一行锚点。真实 Chromium desktop/420x360 验证根→A→B→A 的两次 A 状态互不覆盖，普通 list/details 只显示当前目录 direct children，Folder Tree 保持独立且不参与历史投影。
- [x] `folder.nav.parent` 返回上级并定位原目录
  - 目标：返回上级后自动选中并滚动到刚离开的子目录；远端批次尚未加载时先定位索引再取页。
  - 源码：`components/FolderStack/folderStackNavigation.ts`、`components/FolderToolbar/NavigationButtons.svelte`
  - 测试：`neoview.folder.parent-suggested-selection`、`neoview.browser.restore-index`、`neoview.folder.parent-locate-e2e`
  - 备注：ReaderFileTreeService 在返回上级时基于排序后的父目录快照返回离开子目录的稳定 path/index，10K 父目录测试确认目标不必进入首批 128 项。FolderMainCard 先按全局索引请求对应稀疏页；compact 与 grid 在无历史 snapshot 时使用 Virtuoso initialTopMostItemIndex，details 使用 Niko initialIndex，避免 ref 尚未挂载时的一次性滚动丢失。真实 Chromium desktop/420x360 验证索引 400 的目录在三种 renderer 中进入视口、保持焦点与选中；父目录普通列表只显示直接子项，不显示该目录内部文件，Folder Tree 继续保持独立。
- [x] `folder.nav.home-refresh` 主页、设为主页与刷新
  - 目标：主页跳转、修饰键设为主页、F5/按钮刷新均保留当前位置策略并给出加载状态。
  - 源码：`components/FolderToolbar/NavigationButtons.svelte`、`components/FolderToolbar/FolderToolbar.svelte`
  - 测试：`neoview.folder.settings`、`neoview.folder.refresh`、`neoview.folder.home-refresh-ui`、`neoview.folder.home-refresh-e2e`
  - 备注：Home 使用共享 [nodes.neoview.folder].home_path 配置：单击走普通 path navigation 并进入同一后退/前进历史，右键把当前目录持久化为 Home。F5 与按钮刷新复用当前 navigationEntryId、临时排序、选择、焦点和虚拟滚动快照；item count 变化时丢弃不兼容 Virtuoso snapshot 并按全局 focus/anchor index 定位。watcher 更新走同一状态捕获通道。真实 Chromium desktop/420x360 验证加载态、TOML 写回、活动阅读图片不重挂，以及普通列表只更新当前目录直接子项；Folder Tree 保持独立且不向普通列表注入层级或盘符根。
- [ ] `folder.nav.stack` FolderStack 分层浏览
  - 目标：保留父/当前/子层的分层浏览、预加载和每层独立滚动/选择状态，路径切换不重置无关层。
  - 源码：`components/FolderStack.svelte`、`components/FolderStack/FolderStackState.svelte.ts`、`components/FolderStack/folderStackNavigation.ts`
  - 测试：待补
  - 备注：不得用单列列表替代后宣称 UI 兼容。
- [x] `folder.nav.blank-action` 空白单击/双击导航动作
  - 目标：空白单击和双击分别支持 none/goUp/goBack，并避免与选择清空和双击项打开冲突。
  - 源码：`components/FolderList.svelte`、`components/FolderToolbar/tabs/OtherTab.svelte`
  - 测试：`neoview.folder.blank-action-settings`、`neoview.folder.blank-action-ui`、`neoview.folder.blank-action-e2e`
  - 备注：设置与事件优先级已迁移；单击延迟允许双击取消，不会触发文件项选择或打开。Folder Tree 保持独立，普通 renderer 只处理当前目录直接子项。
- [x] `folder.nav.bottom-return` 列表底部返回按钮
  - 目标：按设置在列表末尾显示返回上级/后退入口，虚拟列表中不破坏索引和恢复定位。
  - 源码：`components/FolderList.svelte`、`components/FolderToolbar/tabs/DisplayTab.svelte`
  - 测试：`neoview.folder.bottom-return-ui`、`neoview.folder.bottom-return-e2e`
  - 备注：已作为 list/grid Virtuoso footer 和 details 表尾附加区实现，不计入文件 entry 索引；优先后退、无历史时返回上级。Folder Tree、磁盘根和递归子项不会注入普通列表。

### tabs（6）

- [x] `folder.tabs.lifecycle` 多标签创建、切换与关闭
  - 目标：创建、切换、关闭标签；关闭最后标签的策略与原版一致，每标签拥有隔离浏览状态。
  - 源码：`components/FolderTabBar.svelte`、`stores/folderTabStore/tabManagement.svelte.ts`
  - 测试：`neoview.folder.tabs-lifecycle`、`neoview.folder.tabs-lifecycle-e2e`
  - 备注：GUI 使用最多 8 个标签的有界宿主，与 backend browser session 上限一致；新标签打开共享 Home，最后一个标签不可关闭。每个标签独立保存当前目录、browser session、导航历史、renderer、选择、焦点与 Virtuoso 视口，切换不重复 POST，关闭会卸载 pane 并释放 watcher、缩略图 context 与 browser session。普通 list/grid/details 始终只显示各标签当前目录的直接子项；Folder Tree 是独立 companion view，不把树层级或磁盘根注入普通列表。标签宿主与标签栏保持 2,291/1,818-byte 二级延迟 chunk，desktop/420x360 Chromium 已验证状态隔离、关闭 DELETE 与活动阅读图片身份稳定。
- [x] `folder.tabs.bulk-close` 关闭其他/左侧/右侧标签
  - 目标：上下文菜单支持关闭其他、左侧和右侧标签，固定标签保护规则与原版一致。
  - 源码：`components/FolderTabBar.svelte`、`stores/folderTabStore/tabManagement.svelte.ts`
  - 测试：`neoview.folder.tabs-bulk-close`、`neoview.folder.tabs-bulk-close-e2e`
  - 备注：二级延迟 FolderTabBar 使用旧版同层级图标菜单提供关闭标签、关闭其他、关闭左侧与关闭右侧；批量命令只移除未固定标签，目标与全部固定标签保持原顺序，活动标签被移除时切换到命令目标。FolderTabsHost 同步清理 MRU 并通过 pane 卸载释放 Abort、watcher、缩略图 context 和 browser session；直接关闭仍保护最后一个未固定工作标签。单元覆盖六个 pane 的三个命令，desktop/420x360 Chromium 覆盖 7 次 browser POST、5 次 DELETE、固定标签与活动阅读图片稳定。主 Card 保持 32,137 bytes，二级 host/menu chunk 为 3,207/3,149 bytes；普通 list/grid/details 仍仅显示当前目录直接子项，Folder Tree 保持独立。
- [x] `folder.tabs.pin-duplicate` 固定与复制标签
  - 目标：标签可固定/取消固定并复制完整浏览状态；固定状态持久化。
  - 源码：`components/FolderTabBar.svelte`、`stores/folderTabStore/tabManagement.svelte.ts`
  - 测试：`neoview.folder.tabs-pin-config`、`neoview.folder.tabs-duplicate-backend`、`neoview.folder.tabs-duplicate-http`、`neoview.folder.tabs-duplicate-client`、`neoview.folder.tabs-pin-duplicate`、`neoview.folder.tabs-pinned-restore`、`neoview.folder.tabs-pin-duplicate-e2e`
  - 备注：固定标签以有序 {path,title} 数组原子写入 [nodes.neoview.folder.tabs].pinned，与 Folder Tree pinned_paths 和侧栏 pin 完全分离；最多 7 个固定标签并保留一个普通工作标签，配置失败回滚 UI，Reader 重开恢复固定标签。复制先由 backend clone 独立复制 listing、back/forward、navigationEntryId、临时排序和随机种子，并重新创建 watcher、Abort、waiter、search 与目录大小任务所有权；Host 再深拷贝 renderer、选择、焦点、导航访问状态和 Virtuoso/details 视口，副本使用唯一标题且不重复 open 当前路径。desktop/420x360 Chromium 验证专用 clone POST、独立 DELETE、刷新恢复、活动阅读图片稳定和普通 browser POST 计数不增加。普通 list/grid/details 仍只展示每个标签当前目录的直接子项，Folder Tree 保持独立层级导航。生产门禁为 FolderMainCard 32,621 bytes、FolderTabsHost 5,374 bytes、FolderTabBar 3,252 bytes，首屏 NeoView 模块为 0。
- [x] `folder.tabs.reopen` 最近关闭与恢复标签
  - 目标：持有最近关闭 10 项，支持菜单和快捷动作恢复，恢复路径、历史、视图和排序状态。
  - 源码：`components/FolderTabBar.svelte`、`stores/folderTabStore/tabManagement.svelte.ts`
  - 测试：`neoview.folder.tabs-reopen-backend`、`neoview.folder.tabs-reopen-http`、`neoview.folder.tabs-reopen-client`、`neoview.folder.tabs-reopen-ui`、`neoview.folder.tabs-reopen-e2e`
  - 备注：后端关闭摘要仅保留路径、back/forward、navigationEntryId、排序偏好、临时排序、随机种子和 watcher 开关，不保留 listing、watcher、Abort、search 或目录大小任务；显式 remember close 才进入最近关闭，最多 10 项并按最旧项淘汰，reopen 创建全新 session 和资源，完整首帧成功后才消费摘要，失败可重试。GUI 在移除页签前捕获 renderer、选择、焦点、navigationStates 和 Virtuoso/details 滚动状态，菜单与 Ctrl/Cmd+Shift+T 恢复最近项；失败保留菜单项，批量关闭逐项保存，Reader 卸载仍为普通 close。desktop/420x360 Chromium 验证专用 reopen POST、零额外普通 browser open、活动阅读图片稳定，以及恢复后的 list/grid/details 仍只展示当前目录直接子项；Folder Tree 保持独立层级导航。生产门禁为 FolderMainCard 32,659 bytes、FolderTabsHost 7,372 bytes、FolderTabBar 3,766 bytes，首屏 NeoView 模块为 0。
- [x] `folder.tabs.navigation-history` 标签切换历史
  - 目标：维护标签访问历史并在关闭活动标签时选择正确的最近标签。
  - 源码：`stores/folderTabStore/tabManagement.svelte.ts`
  - 测试：`neoview.folder.tabs-navigation-history`、`neoview.folder.tabs-navigation-history-e2e`
  - 备注：FolderTabsHost 使用最多 8 项的去重 MRU 访问栈；创建和显式切换记录访问，关闭任意标签同步移除记录，关闭活动标签优先激活仍存在的最近访问项，仅在历史无有效项时回退到数组邻居。访问栈保存在 ref 中，不触发普通目录 list/grid/details 或独立 Folder Tree 的额外渲染。单元与 desktop/420x360 Chromium 均使用 A/C/B 标签顺序、A→C 访问后关闭 C 的反例，证明结果回到 A 而非数组邻居 B，同时保持三条 browser session、关闭 DELETE 和活动阅读图片身份稳定。FolderTabsHost 二级延迟 chunk 为 2,668 bytes。
- [x] `folder.tabs.layout` 标签栏/工具栏/面包屑布局
  - 目标：标签栏布局以及工具栏、面包屑位置可配置并持久化，窄侧栏下保持原版密度和溢出行为。
  - 源码：`components/FolderTabBar.svelte`、`stores/folderTabStore/layoutSettings.svelte.ts`
  - 测试：`neoview.folder.tabs-layout-config`、`neoview.folder.tabs-layout-ui`、`neoview.folder.tabs-layout-e2e`
  - 备注：标签栏、面包屑和工具栏分别支持 none/top/bottom/left/right，纵向标签栏宽度限制为 100..400px；拖动期间只更新 DOM，结束时单次 PATCH 写入 [nodes.neoview.folder.tabs]。layout=none 时保留 28px 布局设置按钮，作为旧版完全隐藏后难以恢复的明确替代契约。Folder Tree 仍是独立层级导航，普通 list/grid/details 只展示当前目录直接子项，不注入磁盘根、树层级或递归结果。desktop 与 420x360 Chromium 验证三次位置 PATCH、一次宽度 PATCH、TOML 持久化、窄视口几何、递归子项缺席及活动阅读图片不重挂。生产 chunk 为 FolderMainCard 32,444 bytes、FolderChromeLayout 1,758 bytes、FolderSelectionBar 1,876 bytes、FolderTabBar 7,160 bytes；NeoView entry 29,866 bytes，首屏 NeoView 模块为 0。

### view（4）

- [ ] `folder.view.modes` list/content/banner/thumbnail 四种原版视图
  - 目标：完整保留 list、content、banner、thumbnail 的信息密度、缩略图位置、选中/hover/focus 表现；目标内部可用更清晰的 mode 名。
  - 源码：`components/FolderList.svelte`、`components/FolderListItem.svelte`、`components/FolderToolbar/ViewModeButtons.svelte`
  - 测试：`neoview.folder.view-compact`、`neoview.folder.view-cover-list`、`neoview.folder.view-mosaic-list`、`neoview.folder.view-details`、`neoview.folder.view-cover-grid`、`neoview.folder.view-mosaic-grid`
  - 备注：当前已提供 compact、cover-list、mosaic-list、details、cover-grid、mosaic-grid 六种内部模式，并复用同一 catalog/selection/focus/sort/EMM 状态；仍需完成原版 list/content/banner/thumbnail 的逐项视觉与设置持久化验收。
- [ ] `folder.view.details` 详细信息视图与列
  - 目标：显示名称、路径、类型、扩展名、大小、修改时间、尺寸、页数、评分和标签信息；列宽/截断/tooltip 与原版一致。
  - 源码：`components/FolderListItem.svelte`、`stores/folderPanelStore/types.ts`
  - 测试：`neoview.folder.details-lazy`、`neoview.folder.details-niko-sparse`、`neoview.folder.details-columns`、`neoview.folder.details-column-width`、`neoview.folder.details-on-demand`、`neoview.folder.details-metadata`、`neoview.folder.media-metadata-batch`、`neoview.folder.media-metadata-fallback`、`neoview.folder.media-metadata-emm-hit`
  - 备注：已扩展现有 Niko Table 虚拟体支持 totalCount + 全局索引到已加载 row ID 的稀疏远端模式；10K 总量测试只向 TanStack 提交 2 条实体，并提供十列。Niko 仅在切换 details 后二级动态加载；显式 details 分页才按需请求昂贵 metadata，媒体并发固定为 2，单项失败保留基础行。列显隐复用 Niko ViewMenu、顺序复用 Niko/dnd-kit、固定复用 TanStack pinning；列宽复用 TanStack column sizing/getResizeHandler/resetSize，onEnd 后只提交一次现有串行配置 PATCH，并以 48..800px 边界规范化写入 [nodes.neoview.folder.details.column_widths]。名称列不可隐藏，未知未来列和列宽只在 DTO 中忽略且 TOML merge 不破坏。真实 Chromium 10K/100K 滚动/定位和原版视觉证据仍待完成。
- [ ] `folder.view.thumbnail-size` 缩略图宽度调节
  - 目标：连续调节缩略图宽度并持久化；调整时虚拟布局重测但不丢失锚点和选中项。
  - 源码：`components/FolderToolbar/ViewPanel.svelte`、`stores/folderTabStore/layoutSettings.svelte.ts`
  - 测试：`neoview.folder.view-size`、`neoview.folder.settings`、`neoview.folder.settings-toml`
  - 备注：cover-grid/mosaic-grid 已按旧版 10..90%、默认 20% 契约使用连续 Slider 和继承 CSS 变量重排 VirtuosoGrid；拖动不改变 virtualKey，键盘步进只提交一次最小 PATCH，并持久化 thumbnail_width_percent。真实两视口 pointer 拖动、滚动锚点与高 DPI characterization 仍待完成。
- [ ] `folder.view.banner-width` 横幅列宽调节
  - 目标：banner 宽度百分比可调且持久化，文本列与预览列不重叠。
  - 源码：`components/FolderToolbar/ViewPanel.svelte`、`stores/folderTabStore/layoutSettings.svelte.ts`
  - 测试：`neoview.folder.view-size`、`neoview.folder.settings`、`neoview.folder.settings-toml`
  - 备注：mosaic-list 已映射为旧 banner 语义的响应式虚拟网格，支持 20..100%、默认 50%、10% 步进、列数反馈和 banner_width_percent 持久化；最小 10rem 卡宽防止窄栏文本/预览重叠。真实两视口 pointer 拖动和原版截图几何仍待完成。

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
  - 备注：文件夹已支持 4/9/16 选择，服务端按自然顺序稳定选取前 N 张并通过 sharp.composite() 合成为单个 WebP；前端每项始终只挂一个 img，文件项强制单预览。preview_count 已规范化写入 [nodes.neoview.folder]；仍缺缺图视觉 characterization、磁盘 profile 缓存与 10K/100K 性能门禁。
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

- [x] `folder.select.basic` 单选、Ctrl/Meta toggle 与焦点项
  - 目标：单击单选，Ctrl/Meta 切换，focused item 与 selected set 分离，虚拟化卸载不丢身份。
  - 源码：`stores/folderPanelStore/selectionState.svelte.ts`、`components/FolderListItem.svelte`
  - 测试：`neoview.folder.selection-basic`、`neoview.folder.selection-focus-identity`、`neoview.folder.selection-virtual-e2e`、`neoview.folder.selection-tab-isolation-e2e`
  - 备注：单击单选与 Ctrl/Meta toggle 使用同一有界 DirectorySelectionModel，focused path/index 与 selected ranges/explicit identities 分离。键盘跳到未加载全局 index 后按需请求分页，页返回时补齐稳定 focusedPath；可见行通过 browser-session + global-index ID 连接 aria-activedescendant。desktop 与 420x360 Chromium 在 260 项真实目录中验证首行被 Virtuoso 卸载、Ctrl+End 只移动焦点、Ctrl+Home 后原路径仍选中，活动阅读图片不重挂；list/grid/details 共用 loaded-path 投影，普通视图仍只处理当前目录 catalog，Folder Tree 不参与选择。
- [x] `folder.select.range` Shift 范围与链式选择
  - 目标：Shift 以稳定 anchor index 范围选择；链式选择按标签隔离，跨未加载分页也正确。
  - 源码：`stores/chainSelectStore.svelte.ts`、`components/FolderStack/FolderSelectionHandler.ts`
  - 测试：`neoview.folder.selection-range-sparse`、`neoview.folder.selection-range-ui`、`neoview.folder.selection-chain`、`neoview.folder.selection-chain-mode`、`neoview.folder.selection-chain-ui`、`neoview.folder.selection-focus-identity`、`neoview.folder.selection-virtual-e2e`、`neoview.folder.selection-tab-isolation-e2e`
  - 备注：Shift/Ctrl+Shift 使用规范化全局索引区间 + 少量显式端点，不加载或物化范围内全部路径；100K 全范围仍为一个区间。链选模式按 FolderBrowserPane/标签隔离，独立 anchor 每次点击后推进，切到新标签时选择栏和 anchor 均为空，切回原标签完整恢复；复制标签只复制有界快照，后续状态继续隔离。desktop 与 420x360 Chromium 验证跨未加载分页 Shift+End、A/B 标签链选隔离和活动阅读图片稳定。链选与点击行为按钮公开 aria-pressed，FolderSelectionBar 保持独立延迟 chunk 1,746 bytes；FolderMainCard 为 32,734 bytes，NeoView entry 为 30,005 bytes，首屏 NeoView 模块为 0。
- [ ] `folder.select.bulk` 全选、反选、取消与选择栏
  - 目标：全选/反选/取消作用于稳定 catalog，SelectionBar 显示数量与批量动作；大目录避免物化百万路径。
  - 源码：`components/SelectionBar.svelte`、`stores/folderPanelStore/selectionState.svelte.ts`
  - 测试：`neoview.folder.selection-bulk-sparse`、`neoview.folder.selection-bulk-rebase`、`neoview.folder.selection-bulk-ui`、`neoview.folder.selection-click-behavior`
  - 备注：当前使用 allSelected + 稀疏例外表达全选/反选/取消，100K 项不物化路径；选择栏显示数量并支持多选模式、点开/点选切换，排序 generation 变化后按路径保留例外。批量打开/复制/移动/删除等动作和 CLI/TUI 命令仍待迁移。
- [x] `folder.select.restore` 导航状态恢复与自动定位
  - 目标：保存 scrollTop/snapshot、selectedItemPath、focused path/index 和 pendingFocusPath；前进后退/标签切换后自动定位。
  - 源码：`stores/folderTabStore/navigationHistory.svelte.ts`、`components/FolderStack/FolderStackState.svelte.ts`
  - 测试：`neoview.folder.restore-snapshot`、`neoview.folder.parent-suggested-selection`、`neoview.folder.restore-focus-backend`、`neoview.folder.restore-focus-client`、`neoview.folder.restore-focus-ui`、`neoview.folder.nav-history-ui`、`neoview.folder.nav-history-e2e`、`neoview.folder.tabs-state`、`neoview.folder.tabs-clone-state`
  - 备注：每个 Explorer 风格 visit 独立保存 view、selection、focused path/index 与 list/grid/details viewport snapshot；标签切换与克隆保留各自状态。导航请求把离开目录的 focused path 交给共享 backend，back/forward/refresh 重扫当前目录直接子项并在排序后的 catalog 中返回新 global index，避免 100K 目录在浏览器逐页扫描。路径索引变化时保留路径身份并清除不兼容 viewport snapshot，再由虚拟 renderer 自动定位；up 仍优先定位刚离开的子目录。真实 Desktop/Card Chromium 覆盖目录插入项后的焦点迁移、选中行、历史分支和活动阅读图片稳定。

### keyboard（2）

- [ ] `folder.keyboard.navigation` 键盘焦点与方向导航
  - 目标：ArrowUp/Down/Left/Right、Home/End、PageUp/PageDown 根据 list/grid 几何移动焦点并滚入视口；补齐原版未完成的上下箭头遗留。
  - 源码：`utils/keyboardHandler.ts`、`components/FolderList.svelte`
  - 测试：`neoview.folder.keyboard-navigation`
  - 备注：list/details 使用稳定行高计算 PageUp/PageDown 步长，响应式 grid 根据当前容器列数处理四方向与整页移动；Home/End 可直接定位稀疏全局索引并按需请求目标页。真实 100K Chromium 滚动和 TUI 对等命令仍待迁移。
- [ ] `folder.keyboard.commands` 打开、返回、刷新、搜索、删除快捷键
  - 目标：Enter 打开、Backspace 后退、F5 刷新、Delete 按删除策略、Ctrl/Cmd+A 全选、Ctrl/Cmd+F 搜索、Escape 取消多选。
  - 源码：`utils/keyboardHandler.ts`
  - 测试：`neoview.folder.keyboard-navigation`、`neoview.folder.search-shortcut`、`neoview.react.cbz-e2e`
  - 备注：Card 列表焦点面已支持 Enter、Backspace、F5、Ctrl/Cmd+A、Ctrl/Cmd+F 和 Escape；搜索快捷键在真实 Chromium 中聚焦共享搜索，输入/可编辑区域与 IME 组合态不会泄漏目录命令。Delete 策略与 TUI 对等命令仍待迁移。

### search（3）

- [ ] `folder.search.current` 当前目录搜索
  - 目标：按名称或路径搜索当前目录，支持清除、空态、加载态、错误态和搜索历史。
  - 源码：`components/SearchResultList.svelte`、`stores/folderTabStore/sortingFiltering.svelte.ts`
  - 测试：`neoview.folder.search-stream`、`neoview.folder.search-http`、`neoview.folder.search-path`、`neoview.folder.search-path-http`、`neoview.folder.search-path-gui`、`neoview.folder.search-path-cli`、`neoview.folder.search-path-tui`、`neoview.folder.search-settings`、`neoview.folder.search-settings-gui`、`neoview.folder.search-settings-toml`、`neoview.folder.headless`、`neoview.folder.cli`、`neoview.folder.tui`、`neoview.folder.search-gui`、`neoview.folder.search-current`、`neoview.folder.search-stale`、`neoview.folder.search-cancel`、`neoview.folder.search-cancel-gui`、`neoview.folder.search-history-service`、`neoview.folder.search-history-validation`、`neoview.folder.search-history-sqlite`、`neoview.folder.search-history-http`、`neoview.folder.search-history-composition`、`neoview.folder.search-history-headless`、`neoview.folder.search-history-cli`、`neoview.folder.search-history-tui`、`neoview.folder.search-history-codec`、`neoview.folder.search-history-codec-raw`、`neoview.folder.search-history-import`、`neoview.folder.search-history-import-cli`、`neoview.folder.search-history-client`、`neoview.folder.search-history-gui`、`neoview.folder.search-shortcut`、`neoview.react.cbz-e2e`
  - 备注：GUI 已通过鉴权 NDJSON 客户端复用 text 契约，默认搜索子目录和名称；includeSubfolders、showHistoryOnFocus、searchInPath 三项旧 SearchSettings 通过唯一串行 Reader config PATCH 写入 [nodes.neoview.folder.search]，失败沿用父级乐观回滚。路径匹配同时贯通 HTTP path=0|1、CLI --search-in-path 与 OpenTUI。界面提供虚拟结果、文本/Glob、类型与大小写选项、清除、加载/空/错误/截断态、过期查询取消及 Ctrl/Cmd+F；四个 scope 的搜索历史通过统一 ReaderSearchHistoryService 非破坏性写入原 %APPDATA%/NeoView/thumbnails.db 的 xr_reader_search_history。zod codec 和显式确认 CLI 已覆盖旧搜索历史格式。搜索栏显隐、mode/kind/case 会话状态与旧 localStorage 一次性导入仍待迁移。
- [ ] `folder.search.recursive` 包含子目录的流式搜索
  - 目标：递归搜索通过 readdirp stream 分批返回、可取消、可限制并发；不阻塞 Bun 事件循环。
  - 源码：`components/SearchResultList.svelte`、`components/FolderToolbar/ActionButtons.svelte`
  - 测试：`neoview.file-tree.readdirp`、`neoview.file-tree.scan-limit`、`neoview.file-tree.ignore`、`neoview.file-tree.scheduler`、`neoview.folder.search-stream`、`neoview.folder.search-glob`、`neoview.folder.search-validation`、`neoview.folder.search-http`、`neoview.folder.search-http-cancellation`、`neoview.folder.search-session-close`、`neoview.folder.headless`、`neoview.folder.cli`、`neoview.folder.tui`、`neoview.folder.search-gui`、`neoview.folder.search-recursive`、`neoview.folder.search-incremental`、`neoview.folder.search-settings`、`neoview.folder.search-settings-gui`、`neoview.folder.search-settings-toml`、`neoview.folder.search-stale`、`neoview.folder.search-cancel`、`neoview.folder.search-cancel-gui`、`neoview.react.cbz-e2e`
  - 备注：ReaderFileTreeService 已提供 session-scoped text/glob NDJSON 搜索、硬预算、背压、宿主 I/O lease 与四条取消/释放路径；GUI 以每 16 项有界批次在流完成前增量发布到 Virtuoso，CLI 文本流/有界 JSON 与通用 OpenTUI folder-ui 复用同一服务。旧 includeSubfolders=true 默认值与开关已规范化到 [nodes.neoview.folder.search]，真实 Chromium 覆盖关闭/恢复、TOML 重读和活动阅读图像稳定。原版视觉 characterization 仍待迁移。
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
  - 目标：Tree 是独立导航窗格，与只列举当前目录直接子项的普通列表同时存在；两者焦点/选择隔离。树节点按需加载、展开/折叠、活动路径同步、加载占位、错误重试和缓存失效完整迁移。
  - 源码：`components/FolderTree.svelte`、`utils/directoryTreeCache.ts`
  - 测试：`neoview.folder.tree-lazy`、`neoview.folder.tree-http`、`neoview.folder.tree-client`、`neoview.folder.tree-card`、`neoview.folder.tree-panel`、`neoview.folder.tree-keyboard`、`neoview.folder.tree-paths`、`neoview.folder.tree-path-identity`、`neoview.folder.tree-lifecycle`、`neoview.folder.tree-navigation-race`、`neoview.folder.tree-generation`、`neoview.folder.tree-layout-e2e`、`neoview.folder.tree-pins`、`neoview.folder.tree-pins-e2e`、`neoview.folder.tree-roots-platform`、`neoview.folder.tree-roots-http`、`neoview.folder.tree-roots-client`、`neoview.folder.tree-roots`、`neoview.folder.tree-roots-e2e`
  - 备注：GUI 已使用二级 lazy 的固定行高 Virtuoso Tree，作为独立 companion pane 与当前目录单层 list/grid/details 同时存在；Tree 焦点和右键 focus 不进入列表 selection，只有打开目录才更新当前目录 catalog。支持当前路径祖先自动展开、完整 ARIA tree 键盘模型、节点展开/折叠、活动路径同步、加载占位、逐节点错误重试，Ctrl+F 只替换文件内容区且保留 Tree；固定目录与真实平台卷根共同作为顶层，右键菜单支持打开、固定/取消固定和目标分支刷新。Windows 通过共享 N-API 调用 GetLogicalDriveStringsW/GetDriveTypeW/GetVolumeInformationW，返回实际卷名、类型和 availability，不再沿用旧版 C:..G: 猜测；不可用卷保留可见但禁止打开，非 Windows 返回系统根 /，当前目录根始终作为故障回退。roots endpoint 独立于 browser session 且仅在 Tree 二级 lazy 模块挂载时请求。请求随路径/session/root 取消，前端 pages/errors/expanded/并发请求有界并按 backend generation 重基。后端 ReaderFileTreeIndex 使用 512 项、5 分钟 TTL 的 lru-cache，规范 key 不改写 provider 路径。仍待完整文件上下文菜单和 watcher 实时呈现，因此保持 partial。
- [ ] `folder.tree.layout-pin` 文件树位置、尺寸与 pin
  - 目标：文件树支持 left/right/top/bottom、尺寸拖动、固定/自动收起；状态持久化且与 Reader 侧栏 pin 语义协调。
  - 源码：`components/FolderTree.svelte`、`components/FolderToolbar/TreePanel.svelte`
  - 测试：`neoview.folder.tree-layout`、`neoview.folder.tree-layout-e2e`、`neoview.folder.tree-pins`、`neoview.folder.tree-pins-e2e`
  - 备注：外置 Tree 已支持 left/right/top/bottom、100..500px 指针/键盘 resize、pointermove 零写盘与 pointerup 单次 PATCH，并持久化到 [nodes.neoview.folder.tree_view]；固定/取消固定目录以单次 PATCH 写入 pinned_paths，最多保留 64 个有效路径，Windows/UNC 路径按大小写无关规则去重并保留首个原始值。旧默认 false/left/200 保持不变。Tree 自动收起契约仍待迁移，因此保持 partial。
- [ ] `folder.tree.inline` 主视图内联树
  - 目标：内联树作为虚拟化数据源模式，支持层级缩进、展开、选择、预览和键盘导航。
  - 源码：`components/InlineTreeList.svelte`、`components/FolderToolbar/FolderToolbar.svelte`
  - 测试：待补
  - 备注：不能渲染无界嵌套 DOM。
- [ ] `folder.tree.cache` 树缓存清理与排除目录
  - 目标：支持清理树缓存、排除目录、取消排除和重新加载；排除规则持久化并应用于扫描/搜索/树。
  - 源码：`utils/directoryTreeCache.ts`、`components/FolderToolbar/CleanupOptionsDialog.svelte`
  - 测试：`neoview.file-tree.ignore`、`neoview.folder.search-http`、`neoview.folder.tree-lazy`、`neoview.folder.tree-exclusions`、`neoview.folder.tree-http`、`neoview.folder.tree-config`、`neoview.folder.headless`、`neoview.folder.cli`、`neoview.folder.tui`
  - 备注：树节点缓存复用 lru-cache；清理、刷新和 watcher 失效共用一个 generation。排除目录经 realpath/stat 规范化后原子写入 [nodes.neoview.folder.tree].excluded_paths，并同时剪枝树与 readdirp 搜索；CLI 与通用 OpenTUI folder-ui 已共用相同更新/确认契约，GUI 呈现尚未完成。

### virtual-sources（2）

- [ ] `folder.virtual.sources` Folder/Bookmark/History/Search 虚拟数据源
  - 目标：统一数据源接口承载真实目录、书签、历史和搜索，保留各自日期/删除/同步语义与面包屑图标。
  - 源码：`utils/virtualPathLoader.ts`、`components/BreadcrumbBar.svelte`、`components/SearchResultList.svelte`
  - 测试：`neoview.library.contract`、`neoview.library.bookmarks`、`neoview.library.http`、`neoview.library.headless`、`neoview.library.headless-composition`、`neoview.library.cli`、`neoview.library.tui`
  - 备注：ReaderLibraryService 已统一 History/Bookmark 的分页、日期与删除语义，HTTP、CLI 和通用 OpenTUI library-ui 复用同一 Headless controller；真实路径仅在添加书签时通过 detectViewSource 解析，不把虚拟路径交给 stat。FolderMain 的 virtual:// 面包屑、独立视图/排序和点击同步仍待迁移。
- [ ] `folder.virtual.cleanup` 无效书签/历史清理与同步
  - 目标：首次使用时有界清理无效项；支持 History/Bookmark 同步文件夹变化、单项删除和清空历史。
  - 源码：`utils/virtualPathLoader.ts`
  - 测试：`neoview.library.http`、`neoview.library.cli`、`neoview.library.tui`
  - 备注：共享 service 已支持单项删除和按时间、数量有界的历史清理，CLI 删除/清理与 TUI destructive action 都需显式确认。首次使用无效路径探测、批量清空和 GUI 同步仍待完成；清理失败不能阻断列表首屏。

### operations（10）

- [ ] `folder.op.open` 打开、浏览、新标签与作为书籍打开
  - 目标：按项目类型提供默认打开、浏览文件夹、新标签打开、文件夹作为书籍打开；禁用项和默认动作与原版一致。
  - 源码：`components/FolderContextMenu.svelte`
  - 测试：`neoview.folder.activate-entry`、`neoview.folder.open-file-location`、`neoview.folder.context-actions`、`neoview.folder.context-actions-e2e`
  - 备注：目录导航和受支持文件 onOpen 已接入；browser session 接受文件或目录路径，文件路径由平台 fs.stat/realpath 打开父目录并返回稳定 suggestedSelection。共享右键菜单现支持目录在当前/新标签打开和作为书籍打开，支持文件由 Reader 或默认软件打开；新标签仍保持独立 browser session。虚拟源特有默认动作与显式 CLI/TUI 命令仍待完成。
- [ ] `folder.op.system` 系统默认程序与资源管理器定位
  - 目标：通过 platform capability 安全调用系统默认程序和 Explorer/Finder 定位，不在 core 中拼 shell 命令。
  - 源码：`components/FolderContextMenu.svelte`
  - 测试：`neoview.file-operations.system-http`、`neoview.folder.system-open-client`、`neoview.folder.context-system-open`、`neoview.folder.context-actions-e2e`
  - 备注：list/grid/details 的同一菜单通过 authenticated /reader/files/open|reveal 调用平台 capability，不在 core 或 React 拼接 shell 命令；缺少宿主能力时动作显式 disabled。CLI 命令、TUI 外部启动确认和真实 Explorer/Finder characterization 仍待完成。
- [ ] `folder.op.clipboard` 复制、剪切、粘贴
  - 目标：单项/批量复制剪切粘贴，处理冲突、跨卷、取消、进度、部分失败和 watcher 回写。
  - 源码：`components/FolderContextMenu.svelte`、`components/SelectionBar.svelte`
  - 测试：待补
  - 备注：文件事务服务独立于 React。
- [ ] `folder.op.copy-metadata` 复制路径与名称
  - 目标：复制单项/多项路径或名称，换行格式和通知与原版一致。
  - 源码：`components/FolderContextMenu.svelte`
  - 测试：`neoview.folder.context-actions`、`neoview.folder.context-data`、`neoview.folder.context-actions-e2e`
  - 备注：GUI 单项复制路径/名称通过宿主 copyText adapter，并提供成功/失败可访问反馈；右键未选中项先按 Explorer 语义聚焦和单选，已在多选中的项保持选择。跨稀疏分页的多项路径/名称投影和 CLI/TUI 仍待完成。
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
  - 测试：`neoview.library.bookmark`、`neoview.library.bookmark-dedupe`、`neoview.library.bookmarks`、`neoview.library.http`、`neoview.library.headless`、`neoview.library.headless-composition`、`neoview.library.cli`、`neoview.library.tui`
  - 备注：Folder、historyList、bookmarkList、HTTP、CLI 与 TUI 共用 ReaderLibraryService；重复规范化路径会合并列表、收藏状态和原创建时间，不再生成重复 UUID。单项添加/删除和自定义列表完整，GUI 文件夹上下文菜单、批量操作与虚拟源实时同步仍待完成。
- [ ] `folder.op.thumbnail` 重生成、预热和取消缩略图
  - 目标：支持选中/全部重生成、当前目录预热、取消和进度；任务低优先级、可取消、去重且不阻塞当前页。
  - 源码：`components/FolderContextMenu.svelte`、`components/FolderToolbar/ActionButtons.svelte`
  - 测试：待补
  - 备注：使用统一 presentation cache。
- [ ] `folder.op.context-menu` 完整右键菜单与可用性规则
  - 目标：菜单分组、图标、快捷键提示、嵌套项、单/多选上下文、虚拟源差异、disabled 与关闭行为尽量保持原版一致。
  - 源码：`components/FolderContextMenu.svelte`
  - 测试：`neoview.folder.context-actions`、`neoview.folder.context-system-open`、`neoview.folder.context-data`、`neoview.folder.context-actions-e2e`
  - 备注：list/grid/details 通过 data-only row contract 使用同一全局 builder，保留分组、图标、能力 disabled、项目名称 footer、右键目标选择及 ContextMenu/Shift+F10；desktop/420x360 Chromium 验证新标签、details 键盘菜单和活动阅读图像稳定。批量动作、虚拟源差异、嵌套书签/删除菜单、原版截图与全部快捷键提示仍待完成。

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
  - 测试：`neoview.folder.search-stream`、`neoview.folder.search-http`
  - 备注：后端递归结果已保留 relativePath/depth 且不复制 scanner；single/all 设置与 GUI/TUI 呈现尚未完成。
- [ ] `folder.penetrate.depth` 穿透最大深度
  - 目标：最大深度支持 1/2/3/5/10/无限，并在循环链接、权限错误和巨大树上有安全上限。
  - 源码：`components/FolderToolbar/tabs/OtherTab.svelte`
  - 测试：`neoview.file-tree.scan-limit`、`neoview.folder.search-validation`、`neoview.folder.search-http-cancellation`
  - 备注：后端支持 0..4096 与默认无限逻辑深度，同时受 1,000,000 扫描项、10,000 结果和取消硬边界限制；旧 UI 离散选项尚未接线。
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
  - 测试：`neoview.folder.settings-persistence`、`neoview.folder.details-columns`、`neoview.folder.settings-toml`、`neoview.folder.search-settings`、`neoview.folder.search-settings-gui`、`neoview.folder.search-settings-toml`
  - 备注：六种 view_mode、4/9/16 preview_count、details 十列布局和旧 SearchSettings 三项已通过唯一 Reader config PATCH 规范化到 [nodes.neoview.folder]，串行乐观写入、失败回滚且不使用 localStorage；真实 TOML 落盘与重读已覆盖。排序、工具栏、树、删除、穿透、空白动作、虚拟源以及旧 folder localStorage 一次性导入仍待完成。

## 全部 77 张 Card

下面 77/77 张 Card 均已冻结最低功能范围。功能范围防止整张 Card 或主要能力被漏掉，但不等于完成证据；每张 Card 开工时仍必须把源码内命令、字段、模式、状态和 UI 几何展开为专用验收项。

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

#### `visibility` 可见性监控

- [ ] 记录 Card、Panel、Viewer 的可见/挂载状态
- [ ] 展示可见性事件与时间线
- [ ] 验证折叠、隐藏和窗口失焦后的后台工作停止
- UI 基线：`src/lib/cards/benchmark/VisibilityCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `latency` 延迟分析

- [ ] 选择延迟测试场景和采样参数
- [ ] 测量请求、首字节、解码、渲染与端到端延迟
- [ ] 展示分位数、阶段分解、进度、错误和可导出结果
- UI 基线：`src/lib/cards/benchmark/LatencyCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `renderer` 渲染模式测试

- [ ] 切换并对比旧版支持的图像渲染路径
- [ ] 运行单次/连续渲染测试
- [ ] 展示耗时、成功率、内存和视觉结果
- UI 基线：`src/lib/cards/benchmark/RendererCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `files` 文件选择

- [ ] 选择基准文件、目录与测试集
- [ ] 显示已选文件及格式/大小
- [ ] 清空、移除和验证不可用测试源
- UI 基线：`src/lib/cards/benchmark/FilesCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `detailed` 详细结果

- [ ] 逐样本展示完整基准记录
- [ ] 按阶段、结果和错误查看明细
- [ ] 复制或导出详细结果
- UI 基线：`src/lib/cards/benchmark/DetailedCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `loadmode` 加载模式

- [ ] 选择并解释旧版支持的加载模式
- [ ] 配置预载/流式/缓存相关测试选项
- [ ] 保存基准专用选择且不污染日常 Reader 设置
- UI 基线：`src/lib/cards/benchmark/LoadModeCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `archives` 压缩包扫描

- [ ] 选择压缩包目录并扫描支持格式
- [ ] 统计归档、条目、失败和耗时
- [ ] 运行、取消、清空并查看逐归档结果
- UI 基线：`src/lib/cards/benchmark/ArchivesCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `realworld` 实际场景

- [ ] 运行贴近日常阅读的组合场景
- [ ] 配置翻页、跳页、缓存冷热和循环次数
- [ ] 汇总体验指标、进度与失败样本
- UI 基线：`src/lib/cards/benchmark/RealWorldCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `imageSource` 图像源对比

- [ ] 对比协议 URL、Blob/二进制及旧图像源路径
- [ ] 执行加载、解码和内存对比
- [ ] 展示各路径分位数、错误和推荐结论
- UI 基线：`src/lib/cards/benchmark/ImageSourceCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `protocolTest` 协议测试

- [ ] 验证 Reader 资源协议/HTTP 数据面
- [ ] 覆盖鉴权、Range、取消、缓存与错误响应
- [ ] 旧版无 Renderer 映射，迁移时必须补齐诊断 UI 或记录被替代能力
- UI 基线：`registry-only`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `results` 测试结果

- [ ] 承载共享基准结果列表
- [ ] 显示运行状态、摘要和选择结果
- [ ] 为详细结果与总结 Card 提供统一数据源
- UI 基线：`src/lib/cards/benchmark/ResultsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `summary` 总结

- [ ] 汇总当前基准会话的关键指标
- [ ] 显示通过/失败预算和瓶颈阶段
- [ ] 提供清空、复制或导出入口
- UI 基线：`src/lib/cards/benchmark/SummaryCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `pipelineLatency` 实时延迟监控

- [ ] 实时采集读取、解压、传输、解码和呈现阶段延迟
- [ ] 显示滚动窗口、分位数和异常尖峰
- [ ] 启动、暂停、重置并限制采样内存
- UI 基线：`src/lib/cards/benchmark/PipelineLatencyCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `transcodeBenchmark` 超分预处理转码

- [ ] 选择超分预处理/转码输入与编码参数
- [ ] 运行可取消的批量基准
- [ ] 比较吞吐、质量、大小、缓存和失败结果
- UI 基线：`src/lib/cards/benchmark/TranscodeBenchmarkCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `thumbnailLatency` 目录加载延迟

- [ ] 测量目录首批、缩略图首张/全部和缓存冷热延迟
- [ ] 配置目录、并发和循环
- [ ] 展示吞吐、分位数、命中率与错误
- UI 基线：`src/lib/cards/benchmark/ThumbnailLatencyCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `pageFlipMonitor` 翻页性能监控

- [ ] 实时监控导航、资源响应、解码与画面稳定时间
- [ ] 显示最近翻页、分位数、丢帧和超预算事件
- [ ] 暂停、清零和有界保存样本
- UI 基线：`src/lib/cards/benchmark/PageFlipMonitorCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

### Panel: `info`（6）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `preloadStatus` | 预加载状态 | core | partial | `src/lib/cards/info/PreloadStatusCard.svelte` | 预读、渐进加载、流传输和全局调度；XR `preload-status` |
| `bookInfo` | 书籍信息 | core | migrated | `src/lib/cards/info/BookInfoCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据；XR `book-information` |
| `infoOverlay` | 信息悬浮窗 | deferred | pending | `src/lib/cards/info/InfoOverlayCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据 |
| `imageInfo` | 图像信息 | core | partial | `src/lib/cards/info/ImageInfoCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据；XR `image-information` |
| `storage` | 存储信息 | core | migrated | `src/lib/cards/info/StorageCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据；XR `storage-information` |
| `time` | 时间信息 | core | migrated | `src/lib/cards/info/TimeCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据；XR `time-information` |

#### `preloadStatus` 预加载状态

- 细项清单：`migration/neoview/preload-status-compatibility.json`
- [ ] 显示当前书籍预读队列、活跃任务和缓存命中
- [ ] 区分当前页、相邻页、缩略图等优先级
- [ ] 提供取消/清理并在会话关闭时归零
- UI 基线：`src/lib/cards/info/PreloadStatusCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

##### 专用逐控件库存（9 组，124 项）

- `preload-ui.summary` 当前页与内存池摘要
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/stores/book/core.svelte.ts`、`src/lib/api/pageManager.ts`
  - 映射：`preload.current-page`、`preload.memory-pool`、`preload.states`、`preload.ui-parity`
  - [ ] 当前页标签
  - [ ] 1-based 当前页
  - [ ] 总页数
  - [ ] 零页显示 0 / 0
  - [ ] 内存池标签
  - [ ] entryCount 项
  - [ ] 未知值显示 --
  - [ ] 两列摘要网格
  - [ ] 卡片型边框与背景
  - [ ] tabular 数值
- `preload-ui.memory-meter` 内存使用量与进度
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 映射：`preload.memory-pool`、`preload.format`、`preload.data-contract`、`preload.accessibility`、`preload.deviations`
  - [ ] totalSize
  - [ ] maxSize
  - [ ] 1024 进制格式
  - [ ] usagePercent 一位小数
  - [ ] 使用率限制在 0..100
  - [ ] 横向进度条
  - [ ] 已用与上限左右布局
  - [ ] maxSize=0 稳定降级
  - [ ] lockedCount 或 lease 替代语义明确
- `preload-ui.nearby-cache` 附近页缓存格
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 映射：`preload.nearby-window`、`preload.cache-state`、`preload.ui-parity`、`preload.performance`
  - [ ] behind=3
  - [ ] ahead=5
  - [ ] 书籍边界 clamp
  - [ ] 最多 9 格
  - [ ] 三列网格
  - [ ] P 加 1-based 页码
  - [ ] current 状态
  - [ ] cached 状态
  - [ ] cold 状态
  - [ ] 当前页优先视觉
  - [ ] cached emerald 视觉
  - [ ] cold muted 视觉
  - [ ] 按 page 稳定 identity
  - [ ] 查询不得读取或解码页面内容
- `preload-ui.refresh` 刷新、同步与迟到结果
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 映射：`preload.refresh`、`preload.states`、`preload.lifecycle`、`preload.performance`
  - [ ] 首次激活立即刷新
  - [ ] 当前页变化立即刷新
  - [ ] 总页数变化立即刷新
  - [ ] 两秒周期刷新
  - [ ] memory 与 status 并行请求
  - [ ] 刷新中状态
  - [ ] 已同步状态
  - [ ] refreshToken 丢弃迟到响应
  - [ ] 零页清空
  - [ ] 失败后退出 refreshing
  - [ ] 手动重试扩展
- `preload-ui.states` 空、部分、错误与失败状态
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 映射：`preload.states`、`preload.cache-state`、`preload.data-contract`、`preload.deviations`
  - [ ] 未打开书籍
  - [ ] 初始加载
  - [ ] 仅浏览器预解码可用
  - [ ] 仅服务端 diagnostics 可用
  - [ ] 两层数据均可用
  - [ ] 错误不泄漏路径或 token
  - [ ] 重试
  - [ ] predecode loading
  - [ ] predecode ready
  - [ ] predecode failed
  - [ ] server cached 与 cold 不和 browser ready 与 failed 混称
  - [ ] session 切换清空
- `preload-ui.queue-actions` 队列、优先级与控制扩展
  - 源码：`src/lib/api/pageManager.ts`、`src/lib/cards/info/PreloadStatusCard.svelte`
  - 映射：`preload.queue-priority`、`preload.cancel-clear`、`preload.states`、`preload.data-contract`、`preload.deviations`
  - [ ] current 分类
  - [ ] near 分类
  - [ ] ahead 分类
  - [ ] background 分类
  - [ ] thumbnail 独立分类
  - [ ] active
  - [ ] ready
  - [ ] failed
  - [ ] cancelled
  - [ ] evicted
  - [ ] admission normal
  - [ ] admission reduced
  - [ ] admission paused
  - [ ] 取消当前 session speculative work
  - [ ] 清理当前 session retained cache
  - [ ] pending
  - [ ] disabled
  - [ ] 确认
  - [ ] 错误
  - [ ] 回滚
  - [ ] 不得清理其他 session 或全局缩略图
  - [ ] GUI CLI TUI 同一命令语义
- `preload-ui.shell` 通用 Card 外壳
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`、`src/lib/stores/cardConfig.svelte.ts`
  - 映射：`preload.shell`、`preload.persistence`、`preload.lifecycle`、`preload.performance`
  - [ ] Loader 图标
  - [ ] 预加载状态标题
  - [ ] 默认 info Panel
  - [ ] 默认 visible=true
  - [ ] 默认 expanded=true
  - [ ] canHide=true
  - [ ] 标题折叠
  - [ ] 上下移动
  - [ ] 独立窗口
  - [ ] 高度调整与恢复 auto
  - [ ] 折叠时内容零 DOM
  - [ ] 动态 import
  - [ ] 加载失败边界
  - [ ] visible expanded order height 持久化
- `preload-ui.shared-contract` 三层共享数据链
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 映射：`preload.data-contract`、`preload.lifecycle`、`preload.performance`、`preload.deviations`
  - [ ] sessionId
  - [ ] generation
  - [ ] plan direction
  - [ ] direction confidence
  - [ ] tier candidates
  - [ ] admission
  - [ ] telemetry counters
  - [ ] performance metrics
  - [ ] presentation entries bytes maxBytes leases
  - [ ] browser predecode bounded entries
  - [ ] GUI CLI TUI 字段语义一致
  - [ ] 取消
  - [ ] 坏 DTO
  - [ ] 旧 DTO
  - [ ] 不暴露本地路径
  - [ ] 不持久化采样
- `preload-ui.accessible-responsive` 无障碍与响应式几何
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`
  - 映射：`preload.accessibility`、`preload.ui-parity`、`preload.image-stability`、`preload.performance`
  - [ ] 摘要 group 名称
  - [ ] 附近页 group 名称
  - [ ] progressbar role
  - [ ] progressbar min max value
  - [ ] 同步状态 live region
  - [ ] tile 可读页码与状态
  - [ ] 刷新原生 button
  - [ ] 取消原生 button
  - [ ] 清理原生 button
  - [ ] 稳定焦点顺序
  - [ ] disabled
  - [ ] pending
  - [ ] desktop 几何
  - [ ] 420x360 几何
  - [ ] 零横向溢出
  - [ ] 活动图片不重挂

##### 专用源码级验收项

- [x] `preload.current-page` 显示当前页与总页数
  - 目标：The active frame anchor is displayed as a 1-based current page with the session book total; a zero-page book renders 0 / 0 without starting preload work.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/stores/book/core.svelte.ts`
  - 测试：`neoview.preload-status.current-page`、`neoview.card.preload-status-live`、`neoview.preload-status.e2e`
  - 备注：The React Card derives this field from the active session frame and book snapshot; focused coverage freezes the zero-page 0 / 0 boundary without rendering nearby-page work, and Chromium covers an active book.
- [ ] `preload.memory-pool` 显示服务端呈现缓存容量
  - 目标：The Card displays server-owned presentation cache entries, bytes, maximum bytes, usage and leases from the shared diagnostics snapshot without presenting the browser predecode retained limit as the legacy memory pool.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 测试：`neoview.diagnostics.snapshot`、`neoview.diagnostics.http`、`neoview.diagnostics.cli`、`neoview.preload-status.memory`、`neoview.preload-status.diagnostics-client`
  - 备注：The browser DTO and Card render server presentation entries, bytes, maxBytes, usage and active leases separately from the bounded browser predecode store; desktop and 420x360 Chromium prove the lease metric and responsive geometry, while complete status still requires CLI/TUI presentation.
- [ ] `preload.format` 保持内存与百分比格式
  - 目标：Bytes use the legacy 1024 thresholds and B/KB/MB/GB labels, usage renders one decimal place, and missing or zero-capacity metrics degrade without invalid percentages.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 测试：`neoview.preload-status.format`
  - 备注：The React Card freezes byte thresholds, one-decimal usage and invalid-value degradation; CLI/TUI text projection remains pending.
- [x] `preload.nearby-window` 显示有界附近页窗口
  - 目标：The Card renders at most nine stable page-index tiles spanning three pages behind through five pages ahead, clamped to book boundaries and queried without loading page content.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 测试：`neoview.preload-status.nearby-window`、`neoview.preload-status.e2e`
  - 备注：The Card renders the clamped three-behind/five-ahead window without loading page content, overlays bounded browser events and passes desktop plus 420x360 Chromium geometry evidence.
- [ ] `preload.cache-state` 区分服务端缓存与浏览器预解码状态
  - 目标：Server current/cached/cold truth and browser loading/ready/failed predecode state are separately labelled; a page may expose both layers without one being inferred from the other.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 测试：`neoview.preload-status-store`、`neoview.card.preload-status-live`、`neoview.preload-status.cache-state`、`neoview.preload-status.partial-metrics`
  - 备注：Browser loading, ready and failed events exist; the server cached/cold window is not connected to the React Card.
- [ ] `preload.queue-priority` 显示预读队列、优先级与 admission
  - 目标：The Card truthfully exposes visible, near, ahead, background and separately owned thumbnail work together with normal, reduced and paused admission from the shared scheduler and preload plan.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 测试：`neoview.preload.plan-single`、`neoview.preload.plan-double`、`neoview.preload.viewport-session`、`neoview.preload.resource-admission`、`neoview.preload-status.priority`
  - 备注：The Card renders aggregated near/ahead/background candidates from shared diagnostics; admission, current-visible ownership and thumbnail ownership remain pending and must stay distinct from browser predecode.
- [ ] `preload.cancel-clear` 取消当前会话预读并清理保留缓存
  - 目标：Explicit actions cancel only current-session speculative work or release current-session retained presentations with pending, disabled, confirmation, error and rollback states while preserving the visible frame and unrelated consumers.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 测试：`neoview.preload-status.cancel`、`neoview.preload-status.clear`、`neoview.preload-status.action-http`、`neoview.preload-status.e2e`
  - 备注：The legacy API exposed global trigger and clear primitives, but the frozen XR scope requires safer current-session ownership rather than a global cache mutation.
- [x] `preload.refresh` 刷新状态并拒绝迟到结果
  - 目标：Activation and frame changes update immediately, browser predecode remains event-driven, diagnostics sample at most once every two seconds while active, and retry aborts any superseded request.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 测试：`neoview.preload-status.refresh`、`neoview.preload-status.diagnostics-cancel`、`neoview.preload-status.e2e`
  - 备注：The Card refreshes diagnostics immediately and at most once per two seconds while mounted, aborts on frame/session changes, exposes sanitized retry, and proves zero polling while collapsed in both Chromium viewports.
- [x] `preload.states` 加载、空、部分、错误、重试与释放状态
  - 目标：Diagnostics and browser predecode failures degrade independently through stable loading, empty, partial, error, retry and disposed states without showing stale previous-session metrics.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 测试：`neoview.preload-status.states`、`neoview.preload-status.retry`、`neoview.preload-status.partial-metrics`、`neoview.preload-status.session-switch`
  - 备注：The Card covers loading, empty/zero-page, partial diagnostics, sanitized error, retry and disposed browser-event states. Diagnostics are owned by sessionId: same-session refresh/errors retain the latest value, while a new session synchronously projects empty metrics until its own snapshot arrives and obsolete requests cannot publish.
- [x] `preload.shell` 保持共享 Card 外壳行为
  - 目标：Preload Status remains independently lazy, hideable, dockable, collapsible, movable, resizable and window-capable with its Loader icon, Info Panel default and visible/expanded defaults.
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 测试：`neoview.card.parallel-core`、`neoview.card.zero-mount`、`neoview.settings.card-layout`、`neoview.preload-status.chunk`、`neoview.preload-status.e2e`
  - 备注：The shared shell, lazy registry, collapse zero-DOM lifecycle and independent 6,857-byte production chunk are gated, including desktop and constrained Chromium.
- [ ] `preload.data-contract` 共享有界 preload 与 diagnostics DTO
  - 目标：GUI, CLI and TUI share one versioned, path-free contract for session generation, plan, telemetry, bounded performance metrics and server cache capacity with cancellation and stale-result semantics.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 测试：`neoview.preload.telemetry`、`neoview.preload.telemetry-generation`、`neoview.preload.performance-telemetry`、`neoview.preload.telemetry-http`、`neoview.diagnostics.wire-schema`、`neoview.preload-status.diagnostics-client`
  - 备注：The browser DTO now consumes the shared diagnostics preload tiers and presentation capacity without a second endpoint; session plan/admission detail and explicit CLI/TUI Card projection remain pending.
- [ ] `preload.lifecycle` 仅在激活时工作并释放所有观察者
  - 目标：Hidden, collapsed and unmounted Cards perform no subscriptions or polling; session and frame generation changes abort obsolete requests, and session close clears browser state and server telemetry.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/cards/CardRenderer.svelte`、`src/lib/stores/book/core.svelte.ts`
  - 测试：`neoview.card.preload-status-live`、`neoview.preload-status-store`、`neoview.preload.telemetry-generation`、`neoview.card.zero-mount`、`neoview.preload-status.diagnostics-cancel`、`neoview.preload-status.session-switch`、`neoview.preload-status.session-close`
  - 备注：Store unsubscribe, diagnostics polling cancellation on unmount/session/frame change, synchronous cross-session state isolation, browser clear and core close are covered; full session-close integration evidence remains pending.
- [x] `preload.persistence` 仅持久化共享 Card 布局
  - 目标：Preload plans, cache snapshots and telemetry are never persisted; only panel, visible, expanded, order and height use canonical [nodes.neoview] Card layout, with no Reader business data written to xiranite.db or a second NeoView database.
  - 源码：`src/lib/stores/cardConfig.svelte.ts`
  - 测试：`neoview.settings.card-layout`、`neoview.card.persist-react`、`neoview.card.resize-patch`
  - 备注：The Card has no content settings or legacy persistence key.
- [ ] `preload.accessibility` 提供语义状态与键盘等价操作
  - 目标：Named metric and nearby-page groups, a semantic progressbar, polite synchronization feedback and native stateful action buttons provide stable keyboard and screen-reader operation with focus preserved after retry, cancel and clear.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`
  - 测试：`neoview.preload-status.accessibility`、`neoview.preload-status.actions-keyboard`
  - 备注：The Card now exposes named summary/nearby/queue groups, a semantic progressbar, live sync status and a native retry button; cancel/clear controls and full focus evidence remain pending.
- [ ] `preload.ui-parity` 保持旧版密度与响应式几何
  - 目标：The two-column summary, compact memory meter, three-column nearby grid and current/cached/cold hierarchy remain readable without overlap or horizontal overflow at desktop and 420x360 Card widths.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 测试：`neoview.preload-status.ui`、`neoview.preload-status.e2e`
  - 备注：The React Card restores the two-column summary, compact memory meter with an explicit active-lease replacement for legacy lockedCount, and the three-column nine-page window with explicit browser predecode labels; desktop and constrained screenshots pass, while server cached/cold parity remains pending.
- [ ] `preload.image-stability` 状态观察与控制不重挂活动媒体
  - 目标：Event updates, diagnostics refresh, retry, cancel and clear preserve the active Reader media node and asset URL and issue zero duplicate requests for the active asset.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`
  - 测试：`neoview.preload-status.image-stability`、`neoview.preload-status.e2e`
  - 备注：Desktop and 420x360 Chromium prove diagnostics refresh plus collapse/reopen preserve the active Reader media node and issue zero duplicate requests for its exact asset URL. Future cancel/clear actions still require the same evidence.
- [ ] `preload.performance` 有界 DOM、请求、内存与 chunk
  - 目标：The Card keeps at most nine nearby tiles and O(1) metrics, bounded event snapshots, at most one diagnostics sample per two seconds only while active, zero hidden work, no page decode or thumbnail blob reads, and an independent deferred chunk under 8 KiB outside Reader entry and sidebar base chunks.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/cards/CardRenderer.svelte`、`src/lib/api/pageManager.ts`
  - 测试：`neoview.preload-status-store`、`neoview.preload.performance-telemetry`、`neoview.preload-status.poll-budget`、`neoview.preload-status.chunk`、`neoview.preload-status.e2e`
  - 备注：The browser store and DOM are bounded, diagnostics poll at most once per two seconds only while mounted, exact active-asset requests remain unchanged in both Chromium viewports, and the Card is an independent 6,857-byte chunk; the full Reader performance gate remains pending.
- [ ] `preload.deviations` 记录 XR 三层状态、激活采样与安全控制扩展
  - 目标：Document that legacy Tauri memory/cache polling is replaced by authenticated shared diagnostics, session preload plan/telemetry and a separately labelled browser predecode event store; polling is active-only, errors are sanitized and retryable, queue/admission/cancel/clear controls are frozen-scope extensions, cancel and clear are current-session scoped, and only Card layout is persisted.
  - 源码：`src/lib/cards/info/PreloadStatusCard.svelte`、`src/lib/api/pageManager.ts`
  - 测试：`neoview.preload-status.deviations`、`neoview.preload-status.partial-metrics`、`neoview.preload-status.poll-budget`、`neoview.preload-status.e2e`
  - 备注：The implementation and checklist explicitly separate server presentation cache, aggregate preload telemetry and bounded browser predecode; it preserves the three-behind/five-ahead window, uses active-only sanitized diagnostics, persists no telemetry and reserves cancel/clear for a future session-scoped contract.

#### `bookInfo` 书籍信息

- 细项清单：`migration/neoview/book-information-compatibility.json`
- [x] 显示书名、EMM 译名、条件原名、源路径、类型、页数和阅读进度
- [x] 由 Storage Card 独占展示文件/归档大小，Book Card 不重复该字段
- [x] Info Panel 共享复制路径与系统定位动作并处理缺失源
- UI 基线：`src/lib/cards/info/BookInfoCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

##### 专用逐控件库存（8 组，63 项）

- `book-ui.titles` 名称、译名与条件原名
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 映射：`book.primary-title`、`book.translated-title`、`book.original-title`、`book.ui-parity`
  - [ ] 名称行
  - [ ] 优先显示非空 EMM translated_title
  - [ ] 译名与原名不同才使用强调 chip
  - [ ] 译名与原名不同才显示原名行
  - [ ] 相同译名不重复原名
  - [ ] 完整值 title
  - [ ] 长文本换行
- `book-ui.identity` 书源路径与类型
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 映射：`book.path`、`book.type`、`book.data-contract`
  - [ ] 路径行
  - [ ] 等宽小字号
  - [ ] 完整路径 tooltip
  - [ ] folder 映射文件夹
  - [ ] archive 映射压缩包
  - [ ] pdf 映射 PDF
  - [ ] media 映射媒体
  - [ ] 缺失类型映射未知
  - [ ] 其他类型稳定显示
- `book-ui.progress` 页码与阅读进度
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 映射：`book.pagination`、`book.progress`、`book.lifecycle`
  - [ ] 当前页使用 1-based 页码
  - [ ] 显示总页数
  - [ ] 进度保留一位小数
  - [ ] 进度不超过 100%
  - [ ] 零页显示 em dash
  - [ ] 翻页同步更新
- `book-ui.states` 空数据与共享元数据生命周期
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`、`src/lib/services/metadataService.ts`
  - 映射：`book.states`、`book.lifecycle`、`book.performance`、`book.deviations`
  - [ ] 无书籍信息时字段零 DOM
  - [ ] 显示暂无书籍信息
  - [ ] 关闭书籍清空
  - [ ] Card 卸载取消订阅
  - [ ] 翻页拒绝迟到结果
  - [ ] 相同元数据请求去重
  - [ ] 加载状态
  - [ ] 错误状态
  - [ ] 重试入口
- `book-ui.panel-actions` Info Panel 共享路径动作
  - 源码：`src/lib/components/panels/InfoPanel.svelte`
  - 映射：`book.panel-actions`、`book.accessibility`、`book.deviations`
  - [ ] 信息 Panel 任意空白处右键
  - [ ] 复制路径
  - [ ] 菜单分隔线
  - [ ] 在资源管理器中打开
  - [ ] 优先书籍路径并回退当前图像路径
  - [ ] 无路径时定位动作禁用
  - [ ] ContextMenu 键与 Shift+F10 几何定位
  - [ ] 点击外部或 Escape 关闭
- `book-ui.shell` 通用 Card 外壳与布局状态
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`、`src/lib/stores/cardConfig.svelte.ts`
  - 映射：`book.shell`、`book.persistence`、`book.accessibility`、`book.performance`
  - [ ] BookOpen 图标与书籍信息标题
  - [ ] 默认 info Panel
  - [ ] 默认显示并展开
  - [ ] 不可隐藏
  - [ ] 标题折叠
  - [ ] 上下移动
  - [ ] 独立窗口
  - [ ] 高度拖动与恢复自动
  - [ ] 折叠内容零挂载
  - [ ] 动态 import 加载与失败状态
  - [ ] expanded/order/height 持久化
- `book-ui.data-flow` EMM 与共享三端数据契约
  - 源码：`src/lib/stores/infoPanel.svelte.ts`、`src/lib/stores/emmMetadata.svelte.ts`、`src/lib/services/metadataService.ts`、`src/lib/utils/pathHash.ts`
  - 映射：`book.translated-title`、`book.data-contract`、`book.lifecycle`、`book.performance`
  - [ ] 按规范书源路径精确读取旧 EMM 记录
  - [ ] 只暴露有界 translated_title
  - [ ] 坏 JSON 稳定降级
  - [ ] 不读取缩略图 blob
  - [ ] GUI/CLI/TUI 共用字段语义
  - [ ] 翻页不重复读取静态 EMM
  - [ ] 取消与 session 关闭释放
- `book-ui.deviations` XR 所有权与可访问性扩展
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/components/panels/InfoPanel.svelte`
  - 映射：`book.panel-actions`、`book.accessibility`、`book.deviations`
  - [ ] 源大小归 Storage Card 而非 Book Card
  - [ ] 复制使用宿主 clipboard capability
  - [ ] 系统定位通过受鉴权后端而非浏览器 shell
  - [ ] 动作成功失败 live region
  - [ ] 语义 description list
  - [ ] 加载错误重试为显式扩展

##### 专用源码级验收项

- [x] `book.primary-title` 显示规范书籍名称
  - 目标：The Card displays the current book display name with full-value tooltip and bounded wrapping.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`
  - 测试：`neoview.book-information.legacy-fields`、`neoview.book-information.headless-contract`、`neoview.book-information.e2e`
  - 备注：Original displayName remains the canonical fallback.
- [x] `book.translated-title` 优先显示有效 EMM 译名
  - 目标：A bounded non-empty translated_title from the exact legacy EMM book record becomes the emphasized primary title.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/stores/emmMetadata.svelte.ts`
  - 测试：`neoview.book-information.emm-codec`、`neoview.book-information.emm-sqlite`、`neoview.book-information.shared-contract`、`neoview.book-information.headless-contract`、`neoview.book-information.legacy-fields`、`neoview.book-information.e2e`
  - 备注：Only a trimmed title up to 4096 characters crosses the shared DTO; raw emm_json and tags never do.
- [x] `book.original-title` 条件显示原名
  - 目标：The original-name row appears only when the normalized translated title differs from displayName.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`
  - 测试：`neoview.book-information.legacy-fields`、`neoview.book-information.zero-pages`、`neoview.book-information.e2e`
  - 备注：Equal, empty or malformed translations do not duplicate the name.
- [x] `book.path` 显示规范书源路径
  - 目标：The Card exposes the canonical opened book source path, not an uncommitted input value or archive entry path.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 测试：`neoview.metadata.http`、`neoview.book-information.panel-actions`、`neoview.book-information.e2e`
  - 备注：GUI wraps the full canonical path; headless surfaces intentionally redact local absolute paths while sharing source kind and title.
- [x] `book.type` 保留完整书源类型语义
  - 目标：folder, archive, PDF, EPUB, media, image and unknown sources have stable shared type semantics and legacy labels.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`
  - 测试：`neoview.book-information.shared-contract`、`neoview.book-information.headless-contract`、`neoview.book-information.legacy-fields`、`neoview.book-information.e2e`
  - 备注：The shared contract preserves document format instead of collapsing PDF and EPUB.
- [x] `book.pagination` 显示 1-based 当前页与总页数
  - 目标：Current page and page count derive from the active frame and update after navigation.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`
  - 测试：`neoview.metadata.http`、`neoview.book-information.zero-pages`、`neoview.book-information.e2e`
  - 备注：Zero-page books remain representable and navigation updates the frame-derived value.
- [x] `book.progress` 计算有界一位小数进度
  - 目标：Progress clamps current to total, renders one decimal for non-empty books and an em dash for zero pages.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`
  - 测试：`neoview.metadata.http`、`neoview.book-information.zero-pages`、`neoview.book-information.e2e`
  - 备注：The backend omits progress for zero pages and clamps the numerator before the GUI formats one decimal.
- [x] `book.states` 加载、空、错误与重试
  - 目标：The Card has stable loading, empty, error and retry states and never presents stale book metadata as current.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/services/metadataService.ts`
  - 测试：`neoview.book-information.states`、`neoview.book-information.retry`、`neoview.book-information.generation-stale`
  - 备注：Loading/error/retry are intentional accessible target extensions; no session mounts zero Card DOM.
- [x] `book.panel-actions` Info Panel 共享复制与系统定位
  - 目标：The whole Info Panel exposes copy-path and reveal-in-file-manager through host/backend capabilities with disabled, pending and feedback states.
  - 源码：`src/lib/components/panels/InfoPanel.svelte`
  - 测试：`neoview.book-information.host-clipboard`、`neoview.book-information.reveal-client`、`neoview.book-information.panel-actions`、`neoview.book-information.panel-actions-disabled`、`neoview.book-information.e2e`
  - 备注：The actions belong to the shared Info Panel, use host/authenticated capabilities and expose live feedback.
- [x] `book.data-contract` 共享有界静态书籍元数据契约
  - 目标：GUI, CLI and TUI share source identity, source format, page count and a bounded translated title loaded once per session book identity.
  - 源码：`src/lib/stores/infoPanel.svelte.ts`、`src/lib/stores/emmMetadata.svelte.ts`、`src/lib/services/metadataService.ts`
  - 测试：`neoview.book-information.emm-codec`、`neoview.book-information.emm-path`、`neoview.book-information.emm-sqlite`、`neoview.book-information.shared-contract`、`neoview.metadata.http`、`neoview.book-information.headless-contract`
  - 备注：One application service serves HTTP and local headless surfaces without a second database, raw EMM JSON or image decode path.
- [x] `book.lifecycle` 会话切换、去重、取消与释放
  - 目标：Hidden/unmounted Cards do no work; static book metadata is deduplicated; generation and session changes cannot publish stale values; close releases pending work.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`、`src/lib/services/metadataService.ts`
  - 测试：`neoview.metadata.cards`、`neoview.metadata.cancel`、`neoview.book-information.generation-stale`、`neoview.book-information.session-close`、`neoview.book-information.headless-contract`
  - 备注：Page progress changes per frame without rereading EMM; session close aborts an unfinished static load.
- [x] `book.shell` 共享 Card 外壳行为
  - 目标：The Book Card remains independently lazy, collapsible, movable, resizable and window-capable while retaining its non-hideable legacy rule.
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 测试：`neoview.card.collapse`、`neoview.card.resize-patch`、`neoview.settings.card-layout`、`neoview.book-information.lazy-chunk`
  - 备注：Book remains non-hideable in the manifest and builds as an independent 2655-byte deferred chunk.
- [x] `book.persistence` 仅持久化共享 Card 布局
  - 目标：Book content has no settings; order, expanded state and height persist only through canonical [nodes.neoview] layout.
  - 源码：`src/lib/stores/cardConfig.svelte.ts`
  - 测试：`neoview.settings.card-layout`、`neoview.card.persist-react`、`neoview.card.resize-patch`
  - 备注：Only canonical [nodes.neoview] layout persists; Reader business data remains in the legacy NeoView database.
- [x] `book.accessibility` 语义字段与键盘等价动作
  - 目标：Description fields, shell controls, retry and Info Panel actions have accessible names, keyboard operation, focus restoration and live feedback.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/components/panels/InfoPanel.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`
  - 测试：`neoview.book-information.retry`、`neoview.book-information.panel-actions`、`neoview.book-information.panel-actions-disabled`、`neoview.context-menu.keyboard-position`、`neoview.book-information.e2e`
  - 备注：Semantic dl, named controls and live regions are present; keyboard context menus anchor at the target center.
- [x] `book.ui-parity` 桌面与窄 Card 视觉几何
  - 目标：Legacy labels, two-column density, conditional title chip and long values remain readable at desktop and 420x360 Card widths.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/components/panels/InfoPanel.svelte`
  - 测试：`neoview.book-information.legacy-fields`、`neoview.book-information.e2e`
  - 备注：Desktop and 420x360 Chromium assert bounded values and capture the rendered Card.
- [x] `book.performance` 常量 DOM、静态请求去重与独立 chunk
  - 目标：O(1) DOM, zero hidden work, one bounded static EMM read per session book, shared frame metadata and an independent deferred Book Card chunk under 8 KiB.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/services/metadataService.ts`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.metadata.cards`、`neoview.metadata.cancel`、`neoview.metadata.http`、`neoview.book-information.headless-contract`、`neoview.book-information.e2e`、`neoview.book-information.lazy-chunk`
  - 备注：Book chunk is 2655 bytes; entry is 24667 bytes; session EMM reads are O(1), cached and blob-free.
- [x] `book.deviations` 记录所有权与可访问性扩展
  - 目标：Document that source size remains Storage-owned and that host clipboard, authenticated reveal, loading/error/retry, semantic dl and action feedback replace weaker legacy behavior.
  - 源码：`src/lib/cards/info/BookInfoCard.svelte`、`src/lib/components/panels/InfoPanel.svelte`
  - 测试：`neoview.book-information.legacy-fields`、`neoview.book-information.host-clipboard`、`neoview.book-information.reveal-client`、`neoview.book-information.retry`、`neoview.book-information.e2e`
  - 备注：Source size stays in Storage; host/authenticated actions, semantic dl and accessible failure states are explicit target improvements.

#### `infoOverlay` 信息悬浮窗

- [ ] 配置阅读画面信息悬浮层的字段与位置
- [ ] 控制可见性、透明度和自动隐藏
- [ ] 实时预览页码、尺寸、文件名等叠加信息
- UI 基线：`src/lib/cards/info/InfoOverlayCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `imageInfo` 图像信息

- 细项清单：`migration/neoview/image-information-compatibility.json`
- [ ] 显示当前页文件名、路径、格式、MIME 与尺寸
- [ ] 显示帧/动画/视频等媒体属性
- [ ] 显示旋转、裁剪、解码或超分后的有效信息
- UI 基线：`src/lib/cards/info/ImageInfoCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

##### 专用逐控件库存（4 组，53 项）

- `image-information-ui.base` 媒体类型、名称与尺寸
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 映射：`image-information.states`、`image-information.base-fields`、`image-information.ui-parity`、`image-information.accessibility`
  - [ ] imageInfo 非空分支
  - [ ] imageInfo 空态
  - [ ] space-y-2 text-sm
  - [ ] 类型标签
  - [ ] 图片图标
  - [ ] 视频图标
  - [ ] 图片文本
  - [ ] 视频文本
  - [ ] 文件名标签
  - [ ] 文件名 max-width 150px
  - [ ] 文件名 truncate
  - [ ] 文件名 title
  - [ ] 文件名 monospace
  - [ ] 尺寸标签
  - [ ] 宽 x 高
  - [ ] 缺失尺寸破折号
- `image-information-ui.image` 图片格式与文件大小
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`
  - 映射：`image-information.image-fields`、`image-information.formatting`、`image-information.states`
  - [ ] 非视频分支
  - [ ] 格式标签
  - [ ] 格式缺失破折号
  - [ ] fileSize 大于零才显示大小行
  - [ ] B 格式
  - [ ] KB 一位小数
  - [ ] MB 两位小数
  - [ ] GB 两位小数
  - [ ] 1024/1048576/1073741824 边界
- `image-information-ui.video` 视频时长、帧率、码率与编码
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`
  - 映射：`image-information.video-fields`、`image-information.formatting`、`image-information.media-probe`、`image-information.degradation`
  - [ ] 视频分支
  - [ ] 时长始终显示
  - [ ] 无效时长破折号
  - [ ] 分钟 mm:ss
  - [ ] 小时 h:mm:ss
  - [ ] 帧率存在才显示
  - [ ] 帧率四舍五入为整数 fps
  - [ ] 码率存在才显示
  - [ ] bps 格式
  - [ ] Kbps 整数
  - [ ] Mbps 一位小数
  - [ ] 视频编码存在才显示
  - [ ] 音频编码存在才显示
- `image-information-ui.target-extension` XR 共享契约与呈现有效信息
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 映射：`image-information.data-contract`、`image-information.presentation`、`image-information.lifecycle`、`image-information.performance`、`image-information.image-stability`、`image-information.deviations`
  - [ ] displayPath
  - [ ] MIME
  - [ ] 当前页索引
  - [ ] 媒体 kind
  - [ ] source dimensions
  - [ ] CSS rotation 后有效尺寸
  - [ ] fit/manual scale 状态
  - [ ] probe loading
  - [ ] probe retry
  - [ ] probe cancellation
  - [ ] 迟到 generation 忽略
  - [ ] Card 无 session 零 DOM
  - [ ] 独立 lazy chunk
  - [ ] 活动图片节点稳定
  - [ ] 未知字段稳定降级

##### 专用源码级验收项

- [x] `image-information.states` 空、加载、成功、失败与重试状态
  - 目标：No session is zero DOM; unavailable media is a stable empty state; base metadata and optional probe failures remain independently visible and retryable.
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`
  - 测试：`neoview.metadata.cards`、`neoview.image-information.zero-session`、`neoview.image-information.probe-degradation`
  - 备注：Base and probe loading, empty, error and independently named retry states are covered.
- [ ] `image-information.base-fields` 显示类型、名称和源尺寸
  - 目标：The active page exposes image/video/animated type, name and source dimensions with legacy labels and compact density.
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`
  - 测试：`neoview.metadata.cards`、`neoview.image-information.image-fields`、`neoview.image-information.video-fields`
  - 备注：GUI preserves the legacy base rows; CLI/TUI explicit media inspection remains pending.
- [ ] `image-information.image-fields` 显示图片格式与文件大小
  - 目标：Non-video pages display normalized format and conditionally display positive source bytes using frozen boundaries.
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`
  - 测试：`neoview.image-information.image-fields`、`neoview.image-information.formatting`、`neoview.image-information.image-e2e`
  - 备注：GUI image format and conditional bytes match legacy behavior; headless projection remains pending.
- [ ] `image-information.video-fields` 显示完整视频媒体字段
  - 目标：Video pages display duration and conditionally display frame rate, bitrate, video codec and audio codec from a shared probe contract.
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`
  - 测试：`neoview.image-information.video-fields`、`neoview.image-information.archive-video-http`
  - 备注：GUI and shared HTTP DTO expose all legacy video fields; CLI/TUI commands remain pending.
- [ ] `image-information.formatting` 保持旧时长、码率与大小格式
  - 目标：Duration, bitrate and byte formatters preserve all legacy thresholds, precision and invalid-value degradation.
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`
  - 测试：`neoview.image-information.formatting`
  - 备注：Pure GUI formatters freeze every legacy boundary; headless text projection must reuse them before completion.
- [ ] `image-information.media-probe` 按需探测视频容器与流
  - 目标：A proven ffprobe-based platform adapter supplies bounded normalized media metadata only when requested for a video page.
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 测试：`neoview.image-information.image-zero-ffprobe`、`neoview.image-information.ffprobe-normalize`、`neoview.image-information.ffprobe-stream`、`neoview.image-information.video-cache-budget`、`neoview.image-information.image-e2e`
  - 备注：GUI demand and platform probing are bounded and image paths make zero probe requests; CLI/TUI demand entry points remain pending.
- [ ] `image-information.data-contract` 共享规范媒体信息 DTO
  - 目标：GUI, CLI and TUI share one path-safe DTO for kind, dimensions, bytes, MIME, duration, frame rate, bitrate and codecs.
  - 源码：`src/lib/stores/infoPanel.svelte.ts`
  - 测试：`neoview.image-information.client`、`neoview.image-information.archive-video-http`
  - 备注：Base metadata and demand-only media DTOs are path-safe and shared with GUI; CLI/TUI still need explicit projection.
- [x] `image-information.presentation` 显示当前呈现的有效尺寸与旋转
  - 目标：The Card distinguishes immutable source dimensions from CSS presentation rotation/fit/manual scale without generating a second asset.
  - 源码：`src/lib/stores/infoPanel.svelte.ts`
  - 测试：`neoview.image-information.image-fields`
  - 备注：The Card separately shows source size, truthful rotated size, fit mode and manual scale; it does not claim unavailable rendered-pixel metrics.
- [ ] `image-information.degradation` 缺少 ffprobe 或字段时稳定降级
  - 目标：Base metadata remains visible when probing is unsupported or fails; optional video rows remain absent and duration uses an em dash.
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`
  - 测试：`neoview.image-information.probe-degradation`、`neoview.image-information.ffprobe-normalize`
  - 备注：GUI preserves base rows and offers an isolated probe retry; headless degradation output remains pending.
- [ ] `image-information.lifecycle` 取消探测并忽略迟到页面结果
  - 目标：Unmount, navigation and session close abort active probing; obsolete generation results never replace the current page.
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 测试：`neoview.image-information.navigation-cancel`、`neoview.image-information.video-cancel`、`neoview.image-information.session-release`、`neoview.image-information.ffprobe-abort`
  - 备注：GUI, application, route and process cancellation are covered; CLI/TUI consumers remain pending.
- [x] `image-information.shell` 复用通用 Card 外壳
  - 目标：Image Information remains independently lazy, hideable, collapsible, movable, resizable and window-capable in the info Panel.
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.shell.registry-lazy`、`neoview.image-information.chunk`
  - 备注：The shared shell and independent 8 KiB deferred chunk are both gated.
- [x] `image-information.accessibility` 字段、错误与重试具有可访问语义
  - 目标：Labels use semantic description lists, truncated values retain titles, and retry is keyboard/touch operable.
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`
  - 测试：`neoview.image-information.image-fields`、`neoview.image-information.probe-degradation`
  - 备注：Semantic terms, complete titles, live probe status and separately named retry buttons are present.
- [x] `image-information.ui-parity` 保持旧版紧凑字段层级
  - 目标：Legacy field order, conditional rows, label hierarchy and compact geometry remain readable on desktop and 420x360 viewports.
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`
  - 测试：`neoview.image-information.image-fields`、`neoview.image-information.video-fields`、`neoview.image-information.image-e2e`
  - 备注：Desktop and 420x360 Chromium prove the legacy order and compact geometry without clipping or horizontal overflow.
- [ ] `image-information.image-stability` 信息探测不重挂活动媒体
  - 目标：Opening, retrying and navigating the Card preserve the active image/video node and asset URL.
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`
  - 测试：`neoview.image-information.image-e2e`、`neoview.image-information.navigation-cancel`
  - 备注：Opening the image Card and navigation cancellation are covered; real video retry/navigation identity remains pending.
- [ ] `image-information.performance` 独立 chunk 与零热路径探测
  - 目标：The Card remains below 8 KiB in an independent deferred chunk; image paths make no probe request and pointer/page-turn budgets remain green.
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.image-information.chunk`、`neoview.image-information.image-e2e`、`neoview.image-information.video-cache-budget`
  - 备注：The Card is 5,106 bytes, images issue zero probe requests, video cache is bounded and loopback navigation p95 is 3.80 ms; the full Reader gate remains pending outside this Card.
- [x] `image-information.deviations` 记录 ffprobe 与呈现扩展
  - 目标：Document the separate cancellable media endpoint and truthful presentation fields as XR extensions without removing legacy rows.
  - 源码：`src/lib/cards/info/ImageInfoCard.svelte`
  - 测试：`neoview.image-information.client`、`neoview.image-information.image-fields`
  - 备注：XR uses an authenticated cancellable media endpoint and truthful CSS presentation fields while preserving every legacy row.

#### `storage` 存储信息

- 细项清单：`migration/neoview/storage-information-compatibility.json`
- [x] 显示当前书籍/页面的压缩与实际字节大小
- [x] 显示缓存、缩略图或解码资源占用
- [x] 对缺失或不可统计字段稳定降级
- UI 基线：`src/lib/cards/info/StorageCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

##### 专用逐控件库存（6 组，55 项）

- `storage-ui.fields` 路径与大小字段
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 映射：`storage.path`、`storage.page-size`、`storage.format`、`storage.ui-parity`
  - [ ] 路径行
  - [ ] 路径标签
  - [ ] 完整路径 title
  - [ ] 等宽小字号路径
  - [ ] 最大宽度 200px
  - [ ] 长路径 break-words
  - [ ] 大小行
  - [ ] 大小标签
  - [ ] 缺失路径 em dash
  - [ ] 缺失大小 em dash
- `storage-ui.format` 字节格式边界
  - 源码：`src/lib/cards/info/StorageCard.svelte`
  - 映射：`storage.format`、`storage.data-contract`
  - [ ] undefined 显示 em dash
  - [ ] 0 显示 0 B
  - [ ] 小于 1024 显示整数 B
  - [ ] KB 保留两位小数
  - [ ] MB 保留两位小数
  - [ ] GB 保留两位小数
  - [ ] 1024 进制阈值
- `storage-ui.empty` 空数据与元数据生命周期
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 映射：`storage.states`、`storage.lifecycle`、`storage.performance`、`storage.deviations`
  - [ ] imageInfo 为空时字段零 DOM
  - [ ] 居中显示暂无存储信息
  - [ ] 初始状态为空
  - [ ] 关闭书籍清空
  - [ ] 翻页更新当前页面路径与大小
  - [ ] Card 卸载取消订阅
  - [ ] 迟到元数据不得覆盖当前页
  - [ ] 加载状态
  - [ ] 错误状态
  - [ ] 重试入口
- `storage-ui.shell` 通用 Card 外壳与布局状态
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`、`src/lib/stores/cardConfig.svelte.ts`
  - 映射：`storage.shell`、`storage.persistence`、`storage.accessibility`、`storage.lifecycle`、`storage.performance`
  - [ ] HardDrive 图标与存储信息标题
  - [ ] 默认 info Panel
  - [ ] 默认显示并展开
  - [ ] 允许隐藏
  - [ ] 标题折叠
  - [ ] 上移与下移
  - [ ] 独立窗口
  - [ ] 高度拖动与恢复自动
  - [ ] 折叠时内容零挂载
  - [ ] 动态 import 加载与失败状态
  - [ ] visible/expanded/order/height 持久化
- `storage-ui.data-flow` 共享页面与书源存储契约
  - 源码：`src/lib/stores/infoPanel.svelte.ts`、`src/lib/services/metadataService.ts`
  - 映射：`storage.path`、`storage.page-size`、`storage.book-size`、`storage.data-contract`、`storage.lifecycle`、`storage.performance`
  - [ ] 当前页面 displayPath
  - [ ] 当前页面实际字节大小
  - [ ] 归档条目使用条目大小而非外层压缩包大小
  - [ ] 文件页使用文件 stat fallback
  - [ ] 书源文件大小单独表达
  - [ ] 文件夹书源大小保持未知
  - [ ] GUI/CLI/TUI 共用字段语义
  - [ ] 同一 generation 请求去重
  - [ ] 取消与 session 关闭释放
- `storage-ui.resource-extension` XR 资源占用扩展
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 映射：`storage.resource-usage`、`storage.states`、`storage.lifecycle`、`storage.performance`、`storage.deviations`
  - [ ] 资源占用与旧路径/大小字段分组
  - [ ] 呈现内存缓存字节数
  - [ ] 缩略图内存缓存字节数
  - [ ] 固态归档缓存保留字节数
  - [ ] 呈现磁盘缓存字节数
  - [ ] 不可用资源指标显示 em dash
  - [ ] 采样有界且 Card 隐藏时零轮询
  - [ ] 全局资源指标明确标记为 XR 扩展

##### 专用源码级验收项

- [x] `storage.path` 显示当前页面规范存储路径
  - 目标：The Card renders the current page display path, preserving an archive entry identity instead of substituting an editable input or unrelated book source.
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 测试：`neoview.metadata.http`、`neoview.metadata.cards`、`neoview.storage-information.legacy-fields`、`neoview.storage-information.e2e`
  - 备注：page.displayPath remains distinct from book.sourcePath; archive entries and filesystem pages retain their canonical display identity.
- [x] `storage.page-size` 显示当前页面实际字节大小
  - 目标：The current page byte length uses entry metadata or filesystem stat fallback without decoding image content.
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 测试：`neoview.metadata.http`、`neoview.metadata.cards`、`neoview.headless.page-stream`、`neoview.storage-information.legacy-fields`、`neoview.storage-information.e2e`
  - 备注：Archive entry and filesystem page sizes use the shared page byteLength and never substitute the outer book source size.
- [x] `storage.book-size` 单独显示书源文件大小
  - 目标：XR separately exposes the opened archive/document/media source file size while directory-backed books remain unknown.
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 测试：`neoview.metadata.http`、`neoview.storage-information.legacy-fields`、`neoview.storage-information.e2e`
  - 备注：The HTTP metadata contract stats file-backed book sources; directory books degrade to unknown and headless surfaces keep local source paths redacted.
- [x] `storage.resource-usage` 显示有界缓存与资源占用
  - 目标：The Card exposes bounded presentation-memory, thumbnail-memory, solid-archive and presentation-disk cache bytes from the shared diagnostics snapshot without starting a second sampler.
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 测试：`neoview.diagnostics.snapshot`、`neoview.diagnostics.http`、`neoview.diagnostics.cli`、`neoview.storage-information.diagnostics-client`、`neoview.storage-information.legacy-fields`、`neoview.storage-information.partial-metrics`、`neoview.storage-information.e2e`
  - 备注：The four metrics come from the existing versioned diagnostics service and are visually separated from the legacy fields.
- [x] `storage.format` 保持 1024 进制字节格式
  - 目标：Missing values render an em dash, zero renders 0 B, bytes remain integral and KiB-range labels preserve the legacy KB/MB/GB labels with two decimals.
  - 源码：`src/lib/cards/info/StorageCard.svelte`
  - 测试：`neoview.storage-information.format`、`neoview.storage-information.partial-metrics`、`neoview.storage-information.e2e`
  - 备注：Dedicated boundaries cover invalid, zero, 1023, 1024, MiB and GiB values.
- [x] `storage.states` 加载、空、错误与重试
  - 目标：The Card has stable loading, empty, partial-metric, error and retry states and never shows stale page storage data as current.
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 测试：`neoview.storage-information.states`、`neoview.storage-information.diagnostics-retry`、`neoview.storage-information.partial-metrics`、`neoview.metadata.cancel`
  - 备注：Diagnostics failure leaves legacy metadata visible; loading/error/retry are accessible target extensions.
- [x] `storage.shell` 共享 Card 外壳行为
  - 目标：The Storage Card remains independently lazy, dockable, hideable, collapsible, movable, resizable and window-capable through the shared shell.
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 测试：`neoview.card.collapse`、`neoview.card.resize-patch`、`neoview.settings.card-layout`、`neoview.storage-information.lazy-chunk`
  - 备注：Storage builds as an independent 3557-byte deferred chunk and keeps the shared shell contract.
- [x] `storage.data-contract` 共享有界存储与诊断 DTO
  - 目标：GUI, CLI and TUI share bounded page/book byte identities and a versioned diagnostics snapshot with cancellation and unavailable-field semantics.
  - 源码：`src/lib/stores/infoPanel.svelte.ts`、`src/lib/services/metadataService.ts`
  - 测试：`neoview.metadata.http`、`neoview.headless.page-stream`、`neoview.diagnostics.snapshot`、`neoview.diagnostics.http`、`neoview.diagnostics.cli`、`neoview.storage-information.diagnostics-client`
  - 备注：The shared diagnostics DTO is path-free and metric-only; page bytes remain on the existing bounded reader snapshot.
- [x] `storage.lifecycle` 懒加载、去重、取消与释放
  - 目标：Hidden or collapsed Cards do no work; metadata is shared per generation; diagnostics are fetched once on activation and cancellation/disposal prevents stale publication.
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.metadata.cards`、`neoview.metadata.cancel`、`neoview.card.zero-mount`、`neoview.storage-information.states`、`neoview.storage-information.diagnostics-cancel`、`neoview.storage-information.e2e`
  - 备注：Storage has no polling loop; the single activation request aborts on unmount and E2E observes exactly one diagnostics request.
- [x] `storage.persistence` 仅持久化共享 Card 布局
  - 目标：Storage content has no settings; panel/order/visible/expanded/height persist only through canonical [nodes.neoview] layout.
  - 源码：`src/lib/stores/cardConfig.svelte.ts`
  - 测试：`neoview.settings.card-layout`、`neoview.card.persist-react`、`neoview.card.resize-patch`
  - 备注：No storage sample or resource snapshot is persisted to xiranite.db or a second NeoView database.
- [x] `storage.accessibility` 语义字段与键盘等价操作
  - 目标：The Card uses grouped semantic description data; shell and retry controls have keyboard operation and accessible names.
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`
  - 测试：`neoview.card.collapse`、`neoview.storage-information.diagnostics-retry`、`neoview.storage-information.legacy-fields`
  - 备注：Description groups, named resource heading and a native retry button provide the target keyboard and screen-reader contract.
- [x] `storage.ui-parity` 桌面与窄 Card 视觉几何
  - 目标：Legacy two-row density, labels, monospace wrapping and the separated XR resource group remain readable at desktop and 420x360 Card widths.
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 测试：`neoview.storage-information.legacy-fields`、`neoview.storage-information.e2e`
  - 备注：Desktop and 420x360 Chromium assert zero Card overflow and capture the rendered Card.
- [x] `storage.performance` 常量 DOM、共享请求与独立 chunk
  - 目标：O(1) DOM, one metadata request per session generation, one activation diagnostics request, zero hidden work and a deferred Storage Card chunk under 8 KiB.
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/cards/CardRenderer.svelte`、`src/lib/services/metadataService.ts`
  - 测试：`neoview.metadata.cards`、`neoview.metadata.cancel`、`neoview.storage-information.diagnostics-cancel`、`neoview.storage-information.e2e`、`neoview.storage-information.lazy-chunk`
  - 备注：Storage chunk is 3557 bytes; the Card performs no decode, directory scan, thumbnail blob read or polling.
- [x] `storage.deviations` 记录书源大小与资源占用扩展
  - 目标：Document that separate book size, diagnostics metrics, loading/error/retry and semantic groups are intentional additions while the legacy path/size rows remain intact.
  - 源码：`src/lib/cards/info/StorageCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 测试：`neoview.storage-information.legacy-fields`、`neoview.storage-information.diagnostics-retry`、`neoview.storage-information.partial-metrics`、`neoview.storage-information.e2e`
  - 备注：Legacy path and size remain the first group; book size and shared resource diagnostics are explicitly labeled target extensions.

#### `time` 时间信息

- 细项清单：`migration/neoview/time-information-compatibility.json`
- [x] 显示文件创建、修改和访问相关时间
- [x] 显示归档条目与书籍记录时间语义
- [x] 按本地时区格式化并处理未知时间
- UI 基线：`src/lib/cards/info/TimeCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

##### 专用逐控件库存（5 组，37 项）

- `time-ui.content` 时间字段与格式
  - 源码：`src/lib/cards/info/TimeCard.svelte`
  - 映射：`time.fields`、`time.format`、`time.ui-parity`
  - [ ] 创建时间行
  - [ ] 修改时间行
  - [ ] zh-CN 本地时区格式
  - [ ] 缺失时间 em dash
  - [ ] 无法解析的旧字符串原样显示
  - [ ] 两列 justify-between 布局
  - [ ] 值使用较小字号
- `time-ui.empty` 空数据状态
  - 源码：`src/lib/cards/info/TimeCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 映射：`time.states`、`time.lifecycle`
  - [ ] imageInfo 为空时不渲染字段
  - [ ] 居中显示暂无时间信息
  - [ ] 初始状态为空
  - [ ] 无书/无页/关闭阅读器时清空
- `time-ui.shell` 通用 Card 外壳与布局状态
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`、`src/lib/stores/cardConfig.svelte.ts`
  - 映射：`time.shell`、`time.persistence`、`time.accessibility`、`time.lifecycle`、`time.performance`
  - [ ] Time 图标与时间信息标题
  - [ ] 默认 info Panel
  - [ ] 默认显示并展开
  - [ ] 允许隐藏
  - [ ] 标题/箭头折叠
  - [ ] 上移/下移
  - [ ] 独立窗口
  - [ ] 高度拖动最小 50px
  - [ ] 双击或按钮恢复自动高度
  - [ ] 折叠时内容不挂载
  - [ ] 动态 import 加载状态
  - [ ] 动态 import 失败状态
  - [ ] visible/expanded/order/height 持久化
- `time-ui.data-flow` 共享元数据生产与生命周期
  - 源码：`src/lib/stores/infoPanel.svelte.ts`、`src/lib/stores/book/core.svelte.ts`、`src/lib/services/metadataService.ts`
  - 映射：`time.data-contract`、`time.lifecycle`、`time.performance`
  - [ ] Card 挂载订阅 store
  - [ ] Card 销毁取消订阅
  - [ ] 翻页后刷新当前页时间
  - [ ] 快速翻页拒绝迟到结果
  - [ ] 相同页面请求去重
  - [ ] 关闭书籍清空状态
  - [ ] 元数据失败稳定降级
- `time-ui.target-extension` XR 明确扩展语义
  - 源码：`src/lib/cards/info/TimeCard.svelte`、`src/lib/types/metadata.ts`
  - 映射：`time.access-source`、`time.deviations`、`time.data-contract`
  - [ ] 访问时间为 XR 扩展而非旧控件
  - [ ] 文件系统页面使用页面 stat 时间
  - [ ] 归档页面只使用条目自身修改时间
  - [ ] 未知归档创建/访问时间不得回退外层压缩包
  - [ ] 书籍源 fallback 显式标记
  - [ ] 非法时间不得传播 NaN 或 Invalid Date

##### 专用源码级验收项

- [x] `time.fields` 显示当前页创建与修改时间
  - 目标：TimeInformation Card renders created and modified rows from the current page metadata without substituting unrelated values.
  - 源码：`src/lib/cards/info/TimeCard.svelte`
  - 测试：`neoview.book.directory`、`neoview.book.archive`、`neoview.metadata.http`、`neoview.metadata.cards`、`neoview.time-information.e2e`
  - 备注：Filesystem and archive page timestamps are verified through the shared loader, HTTP and GUI contracts.
- [x] `time.access-source` 访问时间与时间来源语义
  - 目标：The shared DTO distinguishes filesystem, archive-entry and book-source timestamps; unavailable fields stay unknown.
  - 源码：`src/lib/cards/info/TimeCard.svelte`、`src/lib/types/metadata.ts`
  - 测试：`neoview.time-information.archive-source`、`neoview.time-information.archive-invalid`、`neoview.time-information.e2e`
  - 备注：Intentional XR extension required by the frozen functional scope.
- [x] `time.format` 本地时区与未知值格式
  - 目标：Finite timestamps use zh-CN local time; missing or invalid values render an em dash.
  - 源码：`src/lib/cards/info/TimeCard.svelte`
  - 测试：`neoview.time-information.format`
  - 备注：The target rejects invalid numeric timestamps instead of exposing Invalid Date.
- [x] `time.states` 加载、空、错误与重试
  - 目标：The Card has stable loading, empty, error and retry states and never shows stale data as current.
  - 源码：`src/lib/cards/info/TimeCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`、`src/lib/services/metadataService.ts`
  - 测试：`neoview.time-information.states`、`neoview.time-information.retry`、`neoview.metadata.cancel`
  - 备注：Loading/error/retry are XR accessibility improvements over the legacy silent failure.
- [x] `time.shell` 共享 Card 外壳行为
  - 目标：The Time Card remains independently lazy, dockable, hideable, collapsible, movable, resizable and window-capable through the shared shell.
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 测试：`neoview.card.collapse`、`neoview.card.resize-bounds`、`neoview.settings.card-docking`、`neoview.time-information.lazy-chunk`
  - 备注：Shared shell tests apply and the Time-specific production chunk is independently gated.
- [x] `time.data-contract` 共享可取消时间 DTO
  - 目标：GUI, CLI and TUI receive the same bounded session metadata DTO with generation, cancellation and source semantics.
  - 源码：`src/lib/stores/infoPanel.svelte.ts`、`src/lib/stores/book/core.svelte.ts`、`src/lib/services/metadataService.ts`
  - 测试：`neoview.book.directory`、`neoview.book.archive`、`neoview.metadata.http`、`neoview.metadata.client`、`neoview.metadata.cards`、`neoview.metadata.cancel`
  - 备注：Page timestamps are captured during book load, avoiding a second content decode path.
- [x] `time.lifecycle` 会话切换、取消与释放
  - 目标：Hidden/unmounted Cards do no work; the final subscriber aborts; generation changes cannot publish old metadata.
  - 源码：`src/lib/cards/info/TimeCard.svelte`、`src/lib/cards/CardRenderer.svelte`、`src/lib/stores/infoPanel.svelte.ts`、`src/lib/stores/book/core.svelte.ts`
  - 测试：`neoview.metadata.cancel`、`neoview.card.zero-mount`、`neoview.time-information.generation-stale`
  - 备注：Final-subscriber cancellation and generation replacement are both covered.
- [x] `time.persistence` 仅持久化共享 Card 布局
  - 目标：Time content has no settings; panel/order/visible/expanded/height persist only through canonical [nodes.neoview] layout.
  - 源码：`src/lib/stores/cardConfig.svelte.ts`
  - 测试：`neoview.settings.card-layout`、`neoview.card.persist-react`
  - 备注：No time data is written to xiranite.db or a second NeoView database.
- [x] `time.accessibility` 语义字段与键盘等价操作
  - 目标：The Card uses a semantic description list; shell and retry controls have keyboard operation and accessible names.
  - 源码：`src/lib/cards/info/TimeCard.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`
  - 测试：`neoview.time-information.states`、`neoview.time-information.retry`、`neoview.card.collapse`
  - 备注：Legacy had no Time-specific shortcut.
- [x] `time.ui-parity` 桌面、窄侧栏与窗口几何
  - 目标：Two-column density, labels and long local-date values remain readable at desktop and 420x360 Card widths.
  - 源码：`src/lib/cards/info/TimeCard.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 测试：`neoview.time-information.e2e`
  - 备注：Desktop and 420x360 Playwright runs assert zero horizontal overflow and capture the target Card.
- [x] `time.performance` 常量 DOM、共享请求与独立 chunk
  - 目标：O(1) DOM, one metadata request per session generation, zero work while hidden and a deferred Time Card chunk under 8 KiB.
  - 源码：`src/lib/cards/info/TimeCard.svelte`、`src/lib/cards/CardRenderer.svelte`、`src/lib/services/metadataService.ts`
  - 测试：`neoview.metadata.cards`、`neoview.metadata.cancel`、`neoview.time-information.e2e`、`neoview.time-information.lazy-chunk`
  - 备注：The production Time Card chunk is 1679 bytes and browser evidence confirms one request per generation.
- [x] `time.deviations` 记录访问时间、来源与错误状态扩展
  - 目标：Document that accessedAt, timeSource, loading/error/retry are intentional additions; archive outer-file times are never misrepresented as entry times.
  - 源码：`src/lib/cards/info/TimeCard.svelte`、`src/lib/types/metadata.ts`
  - 测试：`neoview.time-information.archive-source`、`neoview.time-information.retry`、`neoview.time-information.e2e`
  - 备注：No legacy command or field is removed.

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

#### `systemMonitor` 系统资源监控

- [ ] 显示 CPU、内存、GPU 与进程资源
- [ ] 提供实时采样、趋势和峰值
- [ ] 暂停、重置并限制历史样本
- UI 基线：`src/lib/cards/monitor/SystemMonitorCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `dailyTrend` 最近 7 日阅读趋势

- [ ] 统计并展示最近 7 日阅读量趋势
- [ ] 切换统计口径并显示每日详情
- [ ] 处理空数据、时区和增量刷新
- UI 基线：`src/lib/cards/insights/DailyTrendCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `readingStreak` 连续阅读 Streak

- [ ] 展示当前/最长连续阅读天数
- [ ] 显示达成状态、今日进度和历史摘要
- [ ] 按本地日期边界稳定计算
- UI 基线：`src/lib/cards/insights/ReadingStreakCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `readingHeatmap` 阅读时段热力图

- [ ] 按星期/时段展示阅读热力分布
- [ ] 悬停查看精确值和统计范围
- [ ] 处理时区、空数据和窄 Card 布局
- UI 基线：`src/lib/cards/insights/ReadingHeatmapCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `bookmarkOverview` 书签概览

- [ ] 汇总书签总量、列表和近期变化
- [ ] 按列表/类型展示分布
- [ ] 提供跳转到相关书签视图的入口
- UI 基线：`src/lib/cards/insights/BookmarkOverviewCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `sourceBreakdown` 来源拆分

- [ ] 按目录、归档/文件和格式拆分阅读来源
- [ ] 显示数量、占比和详情
- [ ] 处理未知/失效来源与筛选联动
- UI 基线：`src/lib/cards/insights/SourceBreakdownCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `emmTagsHot` EMM 标签热度

- [ ] 统计热门 EMM 标签及频次
- [ ] 按命名空间/范围筛选和查看详情
- [ ] 点击标签联动搜索/文件浏览器
- UI 基线：`src/lib/cards/insights/EmmTagsHotCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

### Panel: `control`（9）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `switchToast` | 切换提示 | integration | pending | `src/lib/cards/info/SwitchToastCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据 |
| `sidebarControl` | 边栏控制 | integration | migrated | `src/lib/cards/info/SidebarControlCard.svelte` | 左右边栏、顶部工具栏、底栏、面板和通知；XR `sidebar-control` |
| `colorFilter` | 颜色滤镜 | integration | pending | `src/lib/cards/info/ColorFilterCard.svelte` | 图片裁边、颜色滤镜、页面过渡和悬停滚动 |
| `imageTrim` | 图像裁剪 | integration | pending | `src/lib/cards/info/ImageTrimCard.svelte` | 图片裁边、颜色滤镜、页面过渡和悬停滚动 |
| `pageTransition` | 翻页动画 | deferred | pending | `src/lib/cards/info/PageTransitionCard.svelte` | 图片裁边、颜色滤镜、页面过渡和悬停滚动 |
| `animatedVideoMode` | 动图视频模式 | integration | pending | `src/lib/cards/info/AnimatedVideoModeCard.svelte` | 动图、视频、字幕和播放控制 |
| `ambientBackground` | 动态背景 | deferred | pending | `src/lib/cards/info/AmbientBackgroundCard.svelte` | 主题接管、阅读背景和空页面背景 |
| `sidebarHeight` | 侧边栏高度 | deferred | pending | `src/lib/cards/info/SidebarHeightCard.svelte` | 左右边栏、顶部工具栏、底栏、面板和通知 |
| `thumbnailMaintenance` | 缩略图维护 | integration | pending | `src/lib/cards/properties/ThumbnailMaintenanceCard.svelte` | 统一缩略图生成、持久化、数据库维护与迁移 |

#### `switchToast` 切换提示

- [ ] 逐类开关阅读模式切换提示
- [ ] 配置提示内容/持续时间/位置等旧选项
- [ ] 提供测试提示与恢复默认值
- UI 基线：`src/lib/cards/info/SwitchToastCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `sidebarControl` 边栏控制

- 细项清单：`migration/neoview/sidebar-control-compatibility.json`
- [x] 控制 top/right/bottom/left 边栏显示与 pin
- [x] 切换自动隐藏、触发区和展开行为
- [x] 恢复布局默认值且不重挂活动阅读图像
- UI 基线：`src/lib/cards/info/SidebarControlCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

##### 专用逐控件库存（7 组，137 项）

- `sidebar-control-ui.card-controller` Card 浮动控制器设置
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/settings/settingsManager.ts`
  - 映射：`sidebar-control.enabled`、`sidebar-control.position-reset`、`sidebar-control.states`、`sidebar-control.accessibility`、`sidebar-control.ui-parity`
  - [ ] 启用浮动控制器标签
  - [ ] 启用 Switch
  - [ ] Switch checked 状态
  - [ ] Switch disabled 状态
  - [ ] 重置控制器位置 icon button
  - [ ] RotateCcw 图标
  - [ ] 重置按钮 title
  - [ ] 重置到 x=100
  - [ ] 重置到 y=100
  - [ ] 说明文本
  - [ ] 控件行 justify-between
  - [ ] Switch scale 0.75
  - [ ] 按钮 24x24
  - [ ] Card 内操作不触发阅读快捷键
- `sidebar-control-ui.card-edges` Card 四边状态概览
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stores/ui.svelte.ts`
  - 映射：`sidebar-control.card-edges`、`sidebar-control.open`、`sidebar-control.pin`、`sidebar-control.states`、`sidebar-control.accessibility`、`sidebar-control.ui-parity`
  - [ ] 边栏状态 2x2 网格
  - [ ] 上按钮
  - [ ] PanelTop 图标
  - [ ] 上按钮单击切换 pinned
  - [ ] 下按钮
  - [ ] PanelBottom 图标
  - [ ] 下按钮单击切换 pinned
  - [ ] 左按钮
  - [ ] PanelLeft 图标
  - [ ] 左按钮单击切换 open
  - [ ] 左按钮右键切换 pinned
  - [ ] 右按钮
  - [ ] PanelRight 图标
  - [ ] 右按钮单击切换 open
  - [ ] 右按钮右键切换 pinned
  - [ ] pinned 使用 default variant
  - [ ] open 未 pinned 使用 secondary variant
  - [ ] 关闭未 pinned 使用 outline variant
  - [ ] pinned 显示 Pin
  - [ ] open 显示开
  - [ ] 关闭显示 PinOff
  - [ ] 按钮高度 32px
  - [ ] 左右右键 preventDefault
  - [ ] 说明点击/右键语义
  - [ ] 锁定后不会自动隐藏说明
- `sidebar-control-ui.floating-shell` 浮动控制器外壳与四边按钮
  - 源码：`src/lib/stackview/layers/SidebarControlLayer.svelte`、`src/lib/stores/ui.svelte.ts`
  - 映射：`sidebar-control.floating-layer`、`sidebar-control.open`、`sidebar-control.lock-cycle`、`sidebar-control.states`、`sidebar-control.accessibility`、`sidebar-control.ui-parity`
  - [ ] enabled=false 时零 DOM
  - [ ] role=group
  - [ ] 侧栏控制器 aria-label
  - [ ] data-layer SidebarControlLayer
  - [ ] data-layer-id sidebar-control
  - [ ] z-index 85
  - [ ] 绝对定位 left/top
  - [ ] 半透明背景
  - [ ] 边框与阴影
  - [ ] backdrop blur
  - [ ] 拖动控制器按钮
  - [ ] GripVertical 图标
  - [ ] 四个无文字图标按钮
  - [ ] PanelTop
  - [ ] PanelBottom
  - [ ] PanelLeft
  - [ ] PanelRight
  - [ ] 单击切换 open
  - [ ] 右键循环 lock
  - [ ] 锁定时 Lock 角标
  - [ ] 每个按钮动态 title
  - [ ] pointer-events-auto
  - [ ] 控制器 mousedown 不冒泡
- `sidebar-control-ui.lock-cycle` 四边三态锁定与视觉状态
  - 源码：`src/lib/stackview/layers/SidebarControlLayer.svelte`、`src/lib/stores/ui.svelte.ts`、`src/lib/components/layout/HoverWrapper.svelte`
  - 映射：`sidebar-control.open`、`sidebar-control.pin`、`sidebar-control.lock-cycle`、`sidebar-control.auto-hide`、`sidebar-control.states`、`sidebar-control.deviations`
  - [ ] null 自动状态
  - [ ] true 锁定展开
  - [ ] false 锁定隐藏
  - [ ] 右键 null->true
  - [ ] 右键 true->false
  - [ ] 右键 false->null
  - [ ] 锁定展开同步 pinned=true
  - [ ] 锁定隐藏同步 pinned=false
  - [ ] 左右锁定展开同步 open=true
  - [ ] 左右锁定隐藏同步 open=false
  - [ ] 单击解除 false 锁定再切 open
  - [ ] 锁定展开 primary 色
  - [ ] 锁定隐藏 destructive 色
  - [ ] 自动展开 secondary 色
  - [ ] 自动隐藏 muted 色
  - [ ] 状态文本隐藏
  - [ ] 状态文本展开
  - [ ] 状态文本锁定展开
  - [ ] 状态文本锁定隐藏
- `sidebar-control-ui.drag` 浮动控制器拖动与位置持久化
  - 源码：`src/lib/stackview/layers/SidebarControlLayer.svelte`、`src/lib/settings/settingsManager.ts`
  - 映射：`sidebar-control.drag`、`sidebar-control.persistence`、`sidebar-control.lifecycle`、`sidebar-control.accessibility`、`sidebar-control.performance`、`sidebar-control.deviations`
  - [ ] mousedown 开始拖动
  - [ ] 记录起始鼠标 x/y
  - [ ] 记录起始位置 x/y
  - [ ] mousemove 仅更新瞬态位置
  - [ ] x 下限 0
  - [ ] x 上限 viewport width-200
  - [ ] y 下限 0
  - [ ] y 上限 viewport height-50
  - [ ] mouseup 结束拖动
  - [ ] mouseup 单次保存
  - [ ] mouseup 移除 window listeners
  - [ ] 拖动期间零设置写入
  - [ ] 卸载移除遗留 listeners
  - [ ] 窗口尺寸变化后位置重新钳制
  - [ ] 触摸 PointerEvent 等价拖动
  - [ ] 键盘位置调整等价入口
- `sidebar-control-ui.config` 设置默认值、同步与 Shell 扩展
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`、`src/lib/settings/settingsManager.ts`、`src/lib/stores/sidebarConfig.svelte.ts`、`src/lib/components/layout/HoverWrapper.svelte`
  - 映射：`sidebar-control.enabled`、`sidebar-control.auto-hide`、`sidebar-control.trigger`、`sidebar-control.reset-layout`、`sidebar-control.data-contract`、`sidebar-control.persistence`、`sidebar-control.lifecycle`
  - [ ] view.sidebarControl.enabled
  - [ ] view.sidebarControl.position.x
  - [ ] view.sidebarControl.position.y
  - [ ] enabled 默认 true
  - [ ] position 默认 100,100
  - [ ] Card 与 Layer 监听同一设置
  - [ ] 外部设置更新实时同步
  - [ ] Card 卸载取消 listener
  - [ ] Layer 卸载取消 12 个 store subscriptions
  - [ ] top enabled
  - [ ] right enabled
  - [ ] bottom enabled
  - [ ] left enabled
  - [ ] 四边 initialVisible
  - [ ] 四边 pinned
  - [ ] 四边 triggerSize
  - [ ] showDelay
  - [ ] hideDelay
  - [ ] 自动隐藏切换
  - [ ] 触发区数值边界
  - [ ] 恢复四边默认布局
  - [ ] 未知未来 Shell 配置保留
  - [ ] 单次规范配置 PATCH
  - [ ] TOML 原子写入
  - [ ] 旧 view.sidebarControl 导入
- `sidebar-control-ui.card-shell` 通用 Card 外壳与迁移边界
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 映射：`sidebar-control.shell`、`sidebar-control.lifecycle`、`sidebar-control.persistence`、`sidebar-control.performance`、`sidebar-control.image-stability`、`sidebar-control.deviations`
  - [ ] PanelLeft 图标与边栏控制标题
  - [ ] 默认 control Panel
  - [ ] 默认显示并展开
  - [ ] 允许隐藏
  - [ ] 标题折叠
  - [ ] 上移与下移
  - [ ] 独立窗口
  - [ ] 高度拖动与恢复自动
  - [ ] 折叠时 Card 内容零挂载
  - [ ] 浮动 Layer 不随 Card 折叠卸载
  - [ ] Card 动态 import
  - [ ] Layer 与 Reader 打开路径延迟边界
  - [ ] visible/expanded/order/height 持久化
  - [ ] 活动阅读图像零重挂
  - [ ] Reader 热翻页预算不回退

##### 专用源码级验收项

- [x] `sidebar-control.enabled` 启停浮动边栏控制器
  - 目标：The Card switch and floating layer share one enabled state; disabling removes the controller DOM without changing edge state.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`
  - 测试：`neoview.card.sidebar-control.floating`、`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.position-reset` 恢复浮动控制器默认位置
  - 目标：Reset restores the canonical bounded default position x=100,y=100 and persists it once without remounting the reader image.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`
  - 测试：`neoview.card.sidebar-control.floating`、`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.card-edges` Card 显示四边 open/pin 状态
  - 目标：The 2x2 Card grid displays and controls top/right/bottom/left edge state from the active Reader Shell.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stores/ui.svelte.ts`
  - 测试：`neoview.card.sidebar-control.edges`、`neoview.card.sidebar-control.context-pin`、`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.floating-layer` 渲染可拖动浮动控制层
  - 目标：An enabled, deferred floating controller renders above the Reader viewport with one drag handle and four edge controls.
  - 源码：`src/lib/stackview/layers/SidebarControlLayer.svelte`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.open` 切换四边瞬态展开状态
  - 目标：Top, right, bottom and left controls open or close the same ReaderEdgeShell surface without mutating unrelated configuration.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`、`src/lib/stores/ui.svelte.ts`
  - 测试：`neoview.card.sidebar-control.edges`、`neoview.shell.hover-delay`、`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.pin` 切换四边固定状态
  - 目标：All four edges update canonical pinned configuration; keyboard/touch users receive an explicit equivalent to legacy right click.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`、`src/lib/stores/ui.svelte.ts`
  - 测试：`neoview.card.sidebar-control.edges`、`neoview.card.sidebar-control.context-pin`、`neoview.shell.pinned`、`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.lock-cycle` 保持自动/锁定展开/锁定隐藏三态
  - 目标：Each floating edge action cycles auto, locked-open and locked-hidden with stable color, icon, title and pinned/open effects.
  - 源码：`src/lib/stackview/layers/SidebarControlLayer.svelte`、`src/lib/stores/ui.svelte.ts`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.auto-hide` 配置自动隐藏与展开行为
  - 目标：The Card can return each edge to automatic hover behavior and expose current open/initial-visible semantics without duplicating ReaderEdgeShell state.
  - 源码：`src/lib/components/layout/HoverWrapper.svelte`、`src/lib/stores/sidebarConfig.svelte.ts`、`src/lib/cards/info/SidebarControlCard.svelte`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.trigger` 配置四边触发区
  - 目标：Four bounded trigger sizes use the canonical Shell configuration and update ReaderEdgeShell without reload.
  - 源码：`src/lib/components/layout/HoverWrapper.svelte`、`src/lib/stores/sidebarConfig.svelte.ts`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.reset-layout` 恢复边栏控制默认布局
  - 目标：One explicit reset restores controller position and known edge defaults while preserving unknown future Shell/Card configuration.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/components/layout/HoverWrapper.svelte`、`src/lib/stores/sidebarConfig.svelte.ts`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.drag` 有界拖动浮动控制器
  - 目标：Pointer, touch and keyboard movement remain within the viewport, update only transient DOM during movement and persist once on completion.
  - 源码：`src/lib/stackview/layers/SidebarControlLayer.svelte`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.states` 默认、open、pinned、disabled 与错误状态
  - 目标：Card and layer expose coherent default, hover, focus, open, pinned, locked, disabled, pending, error and rollback states.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`
  - 测试：`neoview.card.sidebar-control.edges`、`neoview.card.sidebar-control.context-pin`、`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.shell` 共享 Card 与 Shell 外壳行为
  - 目标：Sidebar Control is an independently lazy, hideable, collapsible, movable, resizable and window-capable control-panel Card.
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.data-contract` 共享规范 Shell 控制契约
  - 目标：GUI, CLI and TUI share enabled, position, edge enabled/visible/pinned/trigger and lock semantics through one bounded application configuration contract.
  - 源码：`src/lib/stores/ui.svelte.ts`、`src/lib/stores/sidebarConfig.svelte.ts`、`src/lib/settings/settingsManager.ts`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.persistence` 导入并原子持久化到 nodes.neoview
  - 目标：Legacy view.sidebarControl imports once; canonical enabled/position/edge state lives under [nodes.neoview], with pointer completion and reset producing one atomic PATCH.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`、`src/lib/settings/settingsManager.ts`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.lifecycle` 懒加载、监听释放与取消
  - 目标：Hidden Card content is unmounted, disabled layer is zero DOM, all global pointer/listener work is released and stale configuration responses cannot overwrite newer interaction.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`、`src/lib/stores/ui.svelte.ts`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.accessibility` 键盘、触摸与语义等价操作
  - 目标：Every icon has an accessible name; open/pin/lock expose state; touch and keyboard can invoke legacy context actions and move the controller with focus preserved.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`
  - 测试：`neoview.card.sidebar-control.context-pin`、`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.ui-parity` Card 与浮动层响应式几何
  - 目标：The legacy 2x2 Card density and compact horizontal floating controller remain readable and operable on desktop and 420x360 Card viewports without overlap.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.image-stability` 边栏控制不重挂活动阅读图像
  - 目标：Enable, drag, open, pin, lock, trigger and reset operations preserve the active Reader image node and asset URL.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.performance` DOM、写入与 chunk 边界
  - 目标：O(1) Card/layer DOM, zero hidden work, DOM-only pointermove, one completion PATCH and independent deferred Card/layer chunks within explicit budgets.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.
- [x] `sidebar-control.deviations` 记录受控 Shell 与可访问性扩展
  - 目标：Document controlled ReaderEdgeShell state, PointerEvent/keyboard movement, explicit lock actions, canonical TOML and trigger/reset controls as target improvements without removing legacy states.
  - 源码：`src/lib/cards/info/SidebarControlCard.svelte`、`src/lib/stackview/layers/SidebarControlLayer.svelte`、`src/lib/components/layout/HoverWrapper.svelte`
  - 测试：`neoview.sidebar-control.e2e`
  - 备注：Completed by the shared controlled Shell, canonical revisioned configuration, deferred Card/layer chunks and desktop/constrained Chromium evidence.

#### `colorFilter` 颜色滤镜

- [ ] 开关并配置亮度、对比度、饱和度、灰度/反色等颜色效果
- [ ] 实时预览、单项复位和全部复位
- [ ] 区分书籍级与全局设置并避免重复渲染链
- UI 基线：`src/lib/cards/info/ColorFilterCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `imageTrim` 图像裁剪

- [ ] 启用自动/手动裁边并选择检测模式
- [ ] 配置阈值、边距、最小裁剪和单双页策略
- [ ] 预览、重算、复位并处理动画/视频/超分兼容
- UI 基线：`src/lib/cards/info/ImageTrimCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `pageTransition` 翻页动画

- [ ] 开关并选择翻页动画类型
- [ ] 配置持续时间、缓动和方向
- [ ] 预览、复位并尊重减少动态效果设置
- UI 基线：`src/lib/cards/info/PageTransitionCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `animatedVideoMode` 动图视频模式

- [ ] 控制 GIF/APNG/WebP 动图与视频播放模式
- [ ] 配置自动播放、循环、静音和控制器
- [ ] 显示媒体状态并在离屏/关闭时暂停释放
- UI 基线：`src/lib/cards/info/AnimatedVideoModeCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `ambientBackground` 动态背景

- [ ] 选择纯色、模糊当前页、渐变/动态等阅读背景
- [ ] 配置强度、模糊、透明度、缩放与更新策略
- [ ] 预览、复位并限制 GPU/重绘开销
- UI 基线：`src/lib/cards/info/AmbientBackgroundCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `sidebarHeight` 侧边栏高度

- [ ] 配置边栏高度/宽度、垂直或水平对齐
- [ ] 控制拖动手柄和空白页单双页行为
- [ ] 实时预览、复位并持久化几何
- UI 基线：`src/lib/cards/info/SidebarHeightCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `thumbnailMaintenance` 缩略图维护

- [ ] 查看缩略图数据库状态
- [ ] 扫描缺失/失效项并重建、清理或迁移
- [ ] 显示可取消任务进度、空间回收和错误
- UI 基线：`src/lib/cards/properties/ThumbnailMaintenanceCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

### Panel: `properties`（9）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `emmTags` | EMM 标签 | integration | pending | `src/lib/cards/properties/EmmTagsCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |
| `bookSettings` | 本书设置 | core | partial | `src/lib/cards/properties/BookSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一；XR `book-settings` |
| `folderRatings` | 文件夹平均评分 | integration | pending | `src/lib/cards/properties/FolderRatingsCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |
| `favoriteTags` | 收藏标签快选 | integration | pending | `src/lib/cards/properties/FavoriteTagsCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |
| `emmSync` | EMM 同步 | integration | pending | `src/lib/cards/properties/EmmSyncCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |
| `thumbnailArchMetrics` | 缩略图架构指标 | integration | pending | `src/lib/cards/properties/ThumbnailArchitectureMetricsCard.svelte` | 统一缩略图生成、持久化、数据库维护与迁移 |
| `emmRawData` | EMM 数据库记录 | integration | pending | `src/lib/cards/properties/EmmRawDataCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |
| `emmConfig` | EMM 配置 | integration | pending | `src/lib/cards/properties/EmmConfigCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |
| `fileListTagDisplay` | 文件列表标签 | integration | pending | `src/lib/cards/properties/FileListTagDisplayCard.svelte` | EMM 数据库、评分、标签、收藏和翻译 |

#### `emmTags` EMM 标签

- [ ] 显示当前书籍 EMM 命名空间标签
- [ ] 展开、折叠、复制、筛选或跳转标签
- [ ] 处理无记录、同步中和数据库错误
- UI 基线：`src/lib/cards/properties/EmmTagsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `bookSettings` 本书设置

- 细项清单：`migration/neoview/book-settings-compatibility.json`
- [ ] 查看和编辑当前书籍覆盖设置
- [ ] 区分继承值、显式覆盖和恢复全局默认
- [ ] 保存后立即应用且可回滚失败
- UI 基线：`src/lib/cards/properties/BookSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

##### 专用逐控件库存（7 组，80 项）

- `book-settings-ui.states` 书籍身份、空态与加载态
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/stores/infoPanel.svelte.ts`
  - 映射：`book-settings.states`、`book-settings.identity`、`book-settings.lifecycle`
  - [ ] 未打开书籍空态
  - [ ] 未打开书籍文本
  - [ ] bookInfo path 作为旧设置身份
  - [ ] 加载中空态
  - [ ] 加载中文本
  - [ ] 有书籍才挂载控件
  - [ ] 切书重读覆盖
  - [ ] 关闭书籍清空
  - [ ] 迟到结果不得覆盖新书
- `book-settings-ui.favorite-rating` 收藏按钮与五星评分
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/stores/bookSettings.svelte.ts`
  - 映射：`book-settings.favorite`、`book-settings.rating`、`book-settings.persistence`、`book-settings.accessibility`
  - [ ] 收藏标签
  - [ ] 已收藏按钮
  - [ ] 未收藏按钮
  - [ ] 点击切换 favorite
  - [ ] 评分标签
  - [ ] 1 到 5 星按钮
  - [ ] 实心星
  - [ ] 空心星
  - [ ] 黄色已选星
  - [ ] 评分 N 星 title
  - [ ] 点击写入 1..5
  - [ ] 默认 favorite=false
  - [ ] 默认 rating=0
- `book-settings-ui.direction` 阅读方向分段控制
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/stores/bookSettings.svelte.ts`
  - 映射：`book-settings.direction`、`book-settings.apply`、`book-settings.ui-parity`、`book-settings.accessibility`
  - [ ] 阅读方向标签
  - [ ] 左到右按钮
  - [ ] 右到左按钮
  - [ ] left-to-right 值
  - [ ] right-to-left 值
  - [ ] 缺失值回退左到右
  - [ ] 活动按钮 default variant
  - [ ] 非活动按钮 outline variant
  - [ ] 默认 readingDirection=left-to-right
  - [ ] 切换后当前双页顺序立即更新
- `book-settings-ui.page-mode` 单双页显示模式
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/stores/bookSettings.svelte.ts`
  - 映射：`book-settings.page-mode`、`book-settings.apply`、`book-settings.image-stability`、`book-settings.accessibility`
  - [ ] 显示模式标签
  - [ ] 单页按钮
  - [ ] 双页按钮
  - [ ] doublePageView=false
  - [ ] doublePageView=true
  - [ ] 活动按钮 default variant
  - [ ] 非活动按钮 outline variant
  - [ ] 默认 doublePageView=false
  - [ ] 切换后 frame 立即重建
  - [ ] 单页与双页不改变资源 URL 身份
- `book-settings-ui.horizontal` 横版本子开关
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/stores/bookSettings.svelte.ts`
  - 映射：`book-settings.horizontal-book`、`book-settings.apply`、`book-settings.ui-parity`、`book-settings.deviations`
  - [ ] 横版本子标签
  - [ ] Switch 控件
  - [ ] checked 状态
  - [ ] 默认 horizontalBook=false
  - [ ] scale-75 紧凑几何
  - [ ] 切换写入 boolean
  - [ ] 横版语义与宽页单页策略明确
  - [ ] 不创建第二套页面配对算法
- `book-settings-ui.persistence` 旧设置键、默认值与规范所有权
  - 源码：`src/lib/stores/bookSettings.svelte.ts`、`src/lib/cards/properties/BookSettingsCard.svelte`
  - 映射：`book-settings.persistence`、`book-settings.data-contract`、`book-settings.states`、`book-settings.deviations`
  - [ ] neoview-book-settings 旧 localStorage 键
  - [ ] path 到 PerBookSettings 映射
  - [ ] 坏 JSON 降级空对象
  - [ ] 增量 partial merge
  - [ ] favorite
  - [ ] rating
  - [ ] readingDirection
  - [ ] doublePageView
  - [ ] horizontalBook
  - [ ] 未配置时五项默认值
  - [ ] 旧值一次性迁移
  - [ ] 不得继续双写 localStorage
  - [ ] 不得写入 xiranite.db Reader 业务表
  - [ ] 原子保存
  - [ ] 失败回滚
  - [ ] 恢复继承值
- `book-settings-ui.shell` 通用 Card 外壳与紧凑布局
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 映射：`book-settings.shell`、`book-settings.ui-parity`、`book-settings.lifecycle`、`book-settings.performance`
  - [ ] Settings 图标与本书设置标题
  - [ ] 默认 properties Panel
  - [ ] 默认显示并展开
  - [ ] 允许隐藏
  - [ ] 标题折叠
  - [ ] 上移与下移
  - [ ] 独立窗口
  - [ ] 高度拖动与恢复自动
  - [ ] 折叠内容零挂载
  - [ ] 动态 import
  - [ ] 失败状态
  - [ ] 两列行布局
  - [ ] space-y-2 text-xs
  - [ ] 桌面与 420x360 无溢出

##### 专用源码级验收项

- [ ] `book-settings.identity` 使用规范书籍身份定位覆盖
  - 目标：Per-book overrides use the canonical opened book identity and never an editable path field, transient page URL or display title.
  - 源码：`src/lib/stores/infoPanel.svelte.ts`、`src/lib/stores/bookSettings.svelte.ts`
  - 测试：`neoview.card.book-settings-page-mode`
  - 备注：The React Card receives the active session book but the canonical persistent book key is not yet exposed.
- [ ] `book-settings.favorite` 查看和切换本书收藏
  - 目标：Favorite is a shared per-book boolean with inherited, explicit true and explicit false semantics and immediate optimistic feedback with rollback.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/stores/bookSettings.svelte.ts`
  - 测试：待补
  - 备注：Current React intentionally omits the control because no canonical read/write contract exists.
- [ ] `book-settings.rating` 编辑本书五星评分
  - 目标：Rating supports unset and integers 1..5 through one shared book metadata contract without diverging from Folder rating fields.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/stores/bookSettings.svelte.ts`
  - 测试：待补
  - 备注：Current React intentionally omits the five-star control until rating ownership is unified.
- [ ] `book-settings.direction` 覆盖本书阅读方向
  - 目标：Left-to-right and right-to-left update the active frame immediately, persist as a per-book override and can be reset to inherit the global default.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/stores/bookSettings.svelte.ts`
  - 测试：`neoview.card.book-settings-direction`、`neoview.control.session`、`neoview.book-settings.direction-e2e`
  - 备注：The authenticated session options route now strictly accepts direction, rebuilds the frame and reverses double-page presentation order; canonical per-book persistence and reset-to-inherit remain pending.
- [ ] `book-settings.page-mode` 覆盖本书单双页模式
  - 目标：Single and double page mode update the active frame immediately, persist only for this book and can be reset to inherit the global default.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/stores/bookSettings.svelte.ts`
  - 测试：`neoview.card.book-settings-page-mode`
  - 备注：The React Card updates the current session page mode, but does not distinguish or persist a per-book override.
- [ ] `book-settings.horizontal-book` 覆盖横版本子策略
  - 目标：Horizontal-book is mapped to one documented wide-page/frame policy, applies immediately and does not create a parallel pairing algorithm.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/stores/bookSettings.svelte.ts`
  - 测试：待补
  - 备注：The legacy boolean has no canonical XR behavior yet.
- [ ] `book-settings.apply` 立即应用、串行提交与失败回滚
  - 目标：Each settled control change updates one active session, serializes persistence, ignores obsolete responses and restores the last confirmed value on failure.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/stores/bookSettings.svelte.ts`
  - 测试：`neoview.card.book-settings-page-mode`、`neoview.card.book-settings-direction`、`neoview.book-settings.direction-e2e`
  - 备注：Direction and page-mode changes serialize inside the Card, disable both groups while pending and surface failure without changing the confirmed controlled value; persistence revision conflicts and cross-book cancellation remain pending.
- [ ] `book-settings.states` 空、加载、继承、显式、保存与错误状态
  - 目标：No-book, loading, inherited, explicit, saving, failure and retry states preserve the last confirmed override without stale cross-book publication.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`
  - 测试：`neoview.card.book-settings-contract`
  - 备注：No-session is zero DOM in the shared Card host; the current component lacks inherited, saving and failure states.
- [ ] `book-settings.data-contract` 共享有界本书覆盖 DTO
  - 目标：GUI, CLI and TUI share one versioned bounded override DTO with optional fields, strict enums/ranges, revision conflict handling and no raw local paths in remote output.
  - 源码：`src/lib/stores/bookSettings.svelte.ts`
  - 测试：待补
  - 备注：The legacy localStorage record is not a valid shared XR contract.
- [ ] `book-settings.persistence` 迁移旧键并持久化规范覆盖
  - 目标：Legacy neoview-book-settings imports once into the compatible NeoView business database or canonical config ownership, saves atomically, supports reset-to-inherit and never creates Reader business tables in xiranite.db.
  - 源码：`src/lib/stores/bookSettings.svelte.ts`
  - 测试：待补
  - 备注：Current React neither reads nor writes the legacy record; final ownership must be resolved before controls are exposed.
- [ ] `book-settings.lifecycle` 切书、折叠、取消与关闭释放
  - 目标：Hidden/unmounted Cards do no work; switching books cancels obsolete reads/writes; session close releases pending updates and stale responses cannot affect the next book.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`
  - 测试：`neoview.card.book-settings-contract`
  - 备注：The Card is lazy and no-session renders zero DOM; persistent request cancellation is not implemented.
- [x] `book-settings.shell` 复用通用 Card 外壳
  - 目标：Book Settings remains independently lazy, hideable, collapsible, movable, resizable and window-capable in the Properties Panel.
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 测试：`neoview.shell.registry-lazy`、`neoview.settings.card-layout`
  - 备注：The shared registry and Card shell own layout behavior; content remains independently lazy.
- [ ] `book-settings.accessibility` 命名控件、分组与键盘等价操作
  - 目标：Every toggle, star and segmented option has an accessible name, pressed/checked state, keyboard operation, pending semantics and focus preservation after save or rollback.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`
  - 测试：`neoview.card.book-settings-page-mode`、`neoview.card.book-settings-direction`
  - 备注：Direction and page-mode buttons expose pressed and disabled state through native buttons and failures use an alert; favorite, rating, horizontal-book and full rollback focus evidence remain absent.
- [ ] `book-settings.ui-parity` 保持旧版五行紧凑布局
  - 目标：Favorite, rating, direction, display mode and horizontal-book retain the legacy order, labels, compact density and responsive two-column geometry at desktop and 420x360 widths.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`
  - 测试：`neoview.card.book-settings-page-mode`、`neoview.card.book-settings-direction`、`neoview.book-settings.direction-e2e`
  - 备注：Direction and display-mode rows preserve the legacy order and compact segmented geometry without overflow in desktop and 420x360 Chromium; favorite, rating and horizontal-book rows remain pending.
- [ ] `book-settings.image-stability` 设置更新不重挂活动媒体
  - 目标：Metadata-only changes issue no media request; frame-affecting direction/page-mode changes reuse stable asset URLs and replace media nodes only when the visible page set actually changes.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`
  - 测试：`neoview.book-settings.direction-e2e`
  - 备注：Real Chromium proves RTL reorders the same two visible asset URLs after double-page activation; metadata-only controls and duplicate-request counts remain pending.
- [ ] `book-settings.performance` 常量 DOM、零隐藏工作与独立 chunk
  - 目标：The Card uses O(1) DOM, no polling or media decode, zero hidden work and an independent deferred chunk under 8 KiB outside Reader entry and sidebar base chunks.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.shell.registry-lazy`、`neoview.book-settings.direction-e2e`
  - 备注：The Card builds as an independent 3,213-byte deferred chunk and performs no polling or decode; a dedicated chunk budget and explicit collapsed zero-work request count remain required.
- [ ] `book-settings.deviations` 记录覆盖继承与旧 localStorage 替代
  - 目标：Document reset-to-inherit, canonical persistence, authenticated session updates and any horizontal-book mapping as XR extensions while preserving all five legacy controls.
  - 源码：`src/lib/cards/properties/BookSettingsCard.svelte`、`src/lib/stores/bookSettings.svelte.ts`
  - 测试：`neoview.card.book-settings-contract`
  - 备注：Unsupported controls are deliberately hidden rather than presented as no-op; final replacement contracts remain pending.

#### `folderRatings` 文件夹平均评分

- [ ] 统计当前文件夹条目的评分分布与平均值
- [ ] 区分默认评分和显式评分
- [ ] 刷新、跳转或筛选相关条目
- UI 基线：`src/lib/cards/properties/FolderRatingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `favoriteTags` 收藏标签快选

- [ ] 显示收藏标签快捷项与计数
- [ ] 搜索、选择和批量应用/移除标签
- [ ] 管理收藏标签顺序和可见性
- UI 基线：`src/lib/cards/properties/FavoriteTagsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `emmSync` EMM 同步

- [ ] 配置并执行当前书籍/目录 EMM 同步
- [ ] 显示扫描、匹配、写入、跳过和错误进度
- [ ] 支持取消、重试和冲突策略
- UI 基线：`src/lib/cards/properties/EmmSyncCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `thumbnailArchMetrics` 缩略图架构指标

- [ ] 展示缩略图请求、命中、生成、队列和缓存指标
- [ ] 区分格式/来源/尺寸与冷热路径
- [ ] 重置采样并保持监控有界
- UI 基线：`src/lib/cards/properties/ThumbnailArchitectureMetricsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `emmRawData` EMM 数据库记录

- [ ] 查看当前条目的原始 EMM 数据库字段和 JSON
- [ ] 切换格式化/原始视图并复制数据
- [ ] 刷新并清楚区分只读字段和可编辑入口
- UI 基线：`src/lib/cards/properties/EmmRawDataCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `emmConfig` EMM 配置

- [ ] 配置 EMM 数据库/setting 路径和启用状态
- [ ] 配置评分、收藏与标签解析规则
- [ ] 测试连接、显示兼容性并保存/重置
- UI 基线：`src/lib/cards/properties/EmmConfigCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `fileListTagDisplay` 文件列表标签

- [ ] 选择文件浏览各视图显示的 EMM/manual/AI 标签
- [ ] 配置数量、命名空间、截断和 tooltip
- [ ] 实时预览并持久化显示规则
- UI 基线：`src/lib/cards/properties/FileListTagDisplayCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

### Panel: `upscale`（6）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `upscaleControl` | 超分控制 | deferred | pending | `src/lib/cards/upscale/UpscaleControlCard.svelte` | 超分模型、预览、队列、缓存与保存 |
| `upscaleModel` | 模型选择 | deferred | pending | `src/lib/cards/upscale/UpscaleModelCard.svelte` | 超分模型、预览、队列、缓存与保存 |
| `upscaleStatus` | 处理状态 | deferred | pending | `src/lib/cards/upscale/UpscaleStatusCard.svelte` | 超分模型、预览、队列、缓存与保存 |
| `upscaleCache` | 缓存管理 | deferred | pending | `src/lib/cards/upscale/UpscaleCacheCard.svelte` | 超分模型、预览、队列、缓存与保存 |
| `upscaleConditions` | 条件超分 | deferred | pending | `src/lib/cards/upscale/UpscaleConditionsCard.svelte` | 超分模型、预览、队列、缓存与保存 |
| `progressiveUpscale` | 预超分 | deferred | pending | `src/lib/cards/upscale/ProgressiveUpscaleCard.svelte` | 超分模型、预览、队列、缓存与保存 |

#### `upscaleControl` 超分控制

- [ ] 启用超分并触发当前页/选中范围处理
- [ ] 控制保存、替换、预览和自动应用策略
- [ ] 取消任务并显示能力缺失/失败
- UI 基线：`src/lib/cards/upscale/UpscaleControlCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `upscaleModel` 模型选择

- [ ] 发现、选择和刷新可用超分模型
- [ ] 显示模型类型、比例、路径和兼容性
- [ ] 配置设备/精度/分块等模型参数
- UI 基线：`src/lib/cards/upscale/UpscaleModelCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `upscaleStatus` 处理状态

- [ ] 显示当前与队列任务、阶段、页码和进度
- [ ] 显示耗时、显存/内存、错误和输出
- [ ] 暂停/取消/重试并有界保留最近结果
- UI 基线：`src/lib/cards/upscale/UpscaleStatusCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `upscaleCache` 缓存管理

- [ ] 显示超分内存/磁盘缓存条目、大小和命中
- [ ] 清理当前书籍、过期项或全部缓存
- [ ] 配置预算、目录和淘汰策略
- UI 基线：`src/lib/cards/upscale/UpscaleCacheCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `upscaleConditions` 条件超分

- [ ] 创建、排序、启停和删除条件规则
- [ ] 按格式、尺寸、页类型等条件选择模型/动作
- [ ] 验证冲突、预览匹配并导入导出
- UI 基线：`src/lib/cards/upscale/UpscaleConditionsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `progressiveUpscale` 预超分

- [ ] 配置相邻页/整书预超分范围和优先级
- [ ] 启动、暂停、取消并显示进度
- [ ] 服从阅读任务优先级、资源预算和缓存限制
- UI 基线：`src/lib/cards/upscale/ProgressiveUpscaleCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

### Panel: `history`（1）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `historyList` | 历史记录 | core | partial | `src/lib/cards/history/HistoryListCard.svelte` | 历史、书签、阅读进度和数据洞察；XR `history-list` |

#### `historyList` 历史记录

- 细项清单：`migration/neoview/history-list-compatibility.json`
- [ ] 虚拟化显示最近阅读记录与进度
- [ ] 搜索、排序、筛选、恢复阅读和定位源
- [ ] 单项/批量删除、清空、缩略图/评分与上下文操作
- UI 基线：`src/lib/cards/history/HistoryListCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

##### 专用逐控件库存（16 组，265 项）

- `history-ui.shared-folder-surface` 共享文件浏览器外观与虚拟历史源
  - 源码：`src/lib/cards/history/HistoryListCard.svelte`、`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/cards/folder/cards/FileListCard.svelte`、`src/lib/components/panels/folderPanel/utils/virtualPathLoader.ts`
  - 映射：`history.shared-renderer`、`history.views`、`history.selection`、`history.ui-parity`
  - [ ] virtual://history 初始源
  - [ ] mode=history
  - [ ] 本地历史标签标题
  - [ ] 复用 FileListPanel
  - [ ] 复用 ToolbarCard
  - [ ] 复用 FileListCard
  - [ ] list/content/banner/thumbnail 视觉语义
  - [ ] 文件与文件夹图标
  - [ ] 名称与路径层级
  - [ ] 选中背景
  - [ ] hover 状态
  - [ ] 窄 Card 响应式密度
- `history-ui.item-fields` 历史条目字段、进度与徽章
  - 源码：`src/lib/stores/unifiedHistory.svelte.ts`、`src/lib/components/panels/folderPanel/utils/virtualPathLoader.ts`、`src/lib/components/panels/file/components/VirtualizedFileListV2.svelte`、`src/lib/components/panels/file/components/FileItemCard.svelte`、`src/lib/components/panels/file/components/FileItemListView.svelte`
  - 映射：`history.fields`、`history.progress`、`history.thumbnails`、`history.ui-parity`、`history.data-contract`
  - [ ] 稳定 id
  - [ ] displayName
  - [ ] 完整 source path
  - [ ] pathStack
  - [ ] currentFilePath
  - [ ] contentType
  - [ ] timestamp
  - [ ] currentIndex
  - [ ] totalItems
  - [ ] 阅读进度 badge
  - [ ] 视频 position
  - [ ] 视频 duration
  - [ ] 视频 completed
  - [ ] 相对时间
  - [ ] 已读标记
  - [ ] 书签标记
  - [ ] 缩略图
  - [ ] 翻译标题
  - [ ] 评分
  - [ ] EMM/manual 标签
  - [ ] 文件类型 icon
- `history-ui.open-restore` 打开、恢复阅读位置与文件夹同步
  - 源码：`src/lib/cards/shared/useFileActions.ts`、`src/lib/stores/unifiedHistory.svelte.ts`、`src/lib/stores/historySettings.svelte.ts`
  - 映射：`history.open-resume`、`history.sync-folder`、`history.states`、`history.data-contract`
  - [ ] 单击选择
  - [ ] 双击打开
  - [ ] 压缩包恢复 currentIndex
  - [ ] 普通文件恢复 currentIndex
  - [ ] 文件夹恢复 currentIndex
  - [ ] 文件夹恢复 currentFilePath
  - [ ] 图片/视频单文件模式
  - [ ] pathStack 精确定位
  - [ ] 打开失败反馈
  - [ ] 同步文件夹默认关闭
  - [ ] 同步开启后定位父目录
  - [ ] 同步开关即时生效
- `history-ui.toolbar-cleanup` 历史工具栏、刷新与快速清理
  - 源码：`src/lib/cards/folder/cards/ToolbarCard.svelte`、`src/lib/components/panels/folderPanel/components/FolderToolbar/NavigationButtons.svelte`
  - 映射：`history.actions`、`history.cleanup`、`history.sync-folder`、`history.states`、`history.accessibility`
  - [ ] 重新加载历史 icon button
  - [ ] 同步文件夹 icon button
  - [ ] 同步开关 pressed 状态
  - [ ] 清理选项 icon button
  - [ ] 清理中 pulse
  - [ ] 清理中 disabled
  - [ ] 清理结果三秒反馈
  - [ ] 清理失效记录
  - [ ] 高级清理选项
  - [ ] 菜单分隔线
  - [ ] 一键清除全部
  - [ ] 清空 destructive 确认
  - [ ] 刷新后保留活动设置
- `history-ui.advanced-cleanup` 高级清理对话框
  - 源码：`src/lib/components/panels/folderPanel/components/FolderToolbar/CleanupOptionsDialog.svelte`、`src/lib/stores/unifiedHistory.svelte.ts`
  - 映射：`history.cleanup`、`history.states`、`history.accessibility`、`history.deviations`
  - [ ] 高级清理选项历史标题
  - [ ] 说明文本
  - [ ] 最旧记录数量默认 10
  - [ ] 数量最小值 1
  - [ ] 按数量执行
  - [ ] 指定天数默认 30
  - [ ] 天数最小值 1
  - [ ] 按日期执行
  - [ ] 文件夹路径输入
  - [ ] 系统目录选择
  - [ ] 空路径禁用执行
  - [ ] 按文件夹前缀清理
  - [ ] 一键清除全部记录
  - [ ] 二次 destructive 确认
  - [ ] 成功反馈
  - [ ] 完成后刷新并关闭
- `history-ui.search-sort-filter` 搜索、八字段排序与类型筛选
  - 源码：`src/lib/cards/folder/cards/ToolbarCard.svelte`、`src/lib/components/panels/folderPanel/components/FolderToolbar/FolderToolbar.svelte`、`src/lib/components/panels/folderPanel/components/FolderToolbar/SortPanel.svelte`、`src/lib/components/panels/folderPanel/components/FolderToolbar/TypeFilterBar.svelte`
  - 映射：`history.search-sort-filter`、`history.persistence`、`history.performance`、`history.ui-parity`
  - [ ] 搜索历史记录 placeholder
  - [ ] 本地有界搜索
  - [ ] 名称排序
  - [ ] 路径排序
  - [ ] 添加时间排序
  - [ ] 大小排序
  - [ ] 类型排序
  - [ ] 随机排序
  - [ ] 评分排序
  - [ ] 收藏标签数排序
  - [ ] 升序
  - [ ] 降序
  - [ ] 默认 date desc
  - [ ] 全部类型
  - [ ] 压缩包
  - [ ] 文件夹
  - [ ] 视频
  - [ ] 活动筛选强调
  - [ ] 独立 History 设置
- `history-ui.views-thumbnails` 四种视图、密度与可见缩略图
  - 源码：`src/lib/components/panels/folderPanel/components/FolderToolbar/ViewPanel.svelte`、`src/lib/cards/folder/cards/FileListCard.svelte`、`src/lib/components/panels/file/components/VirtualizedFileListV2.svelte`、`src/lib/components/panels/file/components/FileItemListView.svelte`、`src/lib/utils/thumbnail/VisibleThumbnailLoader.ts`
  - 映射：`history.views`、`history.thumbnails`、`history.lifecycle`、`history.performance`、`history.image-stability`
  - [ ] list
  - [ ] content
  - [ ] banner
  - [ ] thumbnail
  - [ ] 活动视图图标
  - [ ] thumbnail 紧凑模式
  - [ ] 缩略图宽度 10..90
  - [ ] 响应式列数
  - [ ] 可见范围虚拟化
  - [ ] lazy img
  - [ ] async decode
  - [ ] 骨架屏
  - [ ] 失败 fallback
  - [ ] hover 大图预览
  - [ ] folder 1/4/9/16 多图预览
  - [ ] 切换视图取消旧缩略图
  - [ ] History 视图独立持久化
- `history-ui.selection` 多选、链选与批量移除
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/components/panels/folderPanel/components/SelectionBar.svelte`、`src/lib/components/panels/file/components/VirtualizedFileListV2.svelte`
  - 映射：`history.selection`、`history.actions`、`history.accessibility`、`history.performance`
  - [ ] 多选模式
  - [ ] checkbox
  - [ ] 选中计数
  - [ ] 全选
  - [ ] 反选
  - [ ] 取消全选
  - [ ] 链选模式
  - [ ] 点选/点开行为
  - [ ] 焦点与选择分离
  - [ ] 批量复制
  - [ ] 批量剪切
  - [ ] 批量移除历史
  - [ ] 退出多选
  - [ ] 无选择 disabled
  - [ ] 确认移除数量
- `history-ui.context-actions` 文件上下文菜单与宿主动作
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/cards/shared/useFileActions.ts`、`src/lib/components/panels/folderPanel/components/FolderContextMenu.svelte`
  - 映射：`history.actions`、`history.selection`、`history.accessibility`、`history.deviations`
  - [ ] 右键菜单 portal
  - [ ] 视口边界调整
  - [ ] 剪切
  - [ ] 复制
  - [ ] 粘贴
  - [ ] 从历史移除
  - [ ] 重命名
  - [ ] 浏览文件夹
  - [ ] 在新标签页打开
  - [ ] 作为书籍打开
  - [ ] 打开所在文件夹
  - [ ] 系统默认软件打开
  - [ ] 资源管理器定位
  - [ ] 撤回删除
  - [ ] 添加书签
  - [ ] 文件树置顶/取消
  - [ ] 编辑标签
  - [ ] 复制路径
  - [ ] 复制文件名
  - [ ] 重载缩略图
  - [ ] 点击外部关闭
  - [ ] 按项目类型显示动作
- `history-ui.keyboard` 条目键盘语义与虚拟面板输入保护
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/components/panels/file/components/VirtualizedFileListV2.svelte`、`src/lib/components/panels/file/components/FileItemListView.svelte`、`src/lib/components/panels/folderPanel/utils/keyboardHandler.ts`
  - 映射：`history.selection`、`history.accessibility`、`history.deviations`
  - [ ] listbox role
  - [ ] 条目 role=button
  - [ ] 条目 tabindex=0
  - [ ] Enter
  - [ ] Space
  - [ ] 输入框不触发 Reader 命令
  - [ ] 搜索输入保护
  - [ ] 上下文菜单键盘等价扩展
  - [ ] 方向键焦点扩展
  - [ ] Home/End 扩展
  - [ ] Delete 扩展
  - [ ] Ctrl/Cmd+A 扩展
  - [ ] Ctrl/Cmd+F 扩展
  - [ ] Escape 扩展
  - [ ] 焦点恢复
  - [ ] 旧虚拟实例不注册 document keydown 的事实
- `history-ui.settings` History 独立工具栏与行为设置
  - 源码：`src/lib/stores/virtualPanelSettings.svelte.ts`、`src/lib/stores/historySettings.svelte.ts`、`src/lib/components/panels/folderPanel/components/FolderToolbar/tabs/OtherTab.svelte`
  - 映射：`history.persistence`、`history.sync-folder`、`history.views`、`history.search-sort-filter`、`history.deviations`
  - [ ] neoview-history-panel-settings
  - [ ] viewStyle=list
  - [ ] sortField=date
  - [ ] sortOrder=desc
  - [ ] itemTypeFilter=all
  - [ ] multiSelectMode=false
  - [ ] deleteMode=false
  - [ ] showSearchBar=false
  - [ ] showMigrationBar=false
  - [ ] penetrateMode=false
  - [ ] inlineTreeMode=false
  - [ ] thumbnailWidthPercent=20
  - [ ] folderTreeVisible=false
  - [ ] folderTreeLayout=left
  - [ ] folderTreeSize=200
  - [ ] showToolbarTooltip=false
  - [ ] neoview-history-settings
  - [ ] syncFileTreeOnHistorySelect=false
  - [ ] maxHistorySize=0
  - [ ] 工具栏提示开关
  - [ ] 同步文件夹开关
  - [ ] 默认评分
  - [ ] 空白点击行为
  - [ ] 返回按钮可见性
  - [ ] 重置
- `history-ui.persistence-migration` 历史业务数据、限制与旧格式迁移
  - 源码：`src/lib/stores/history.svelte.ts`、`src/lib/stores/unifiedHistory.svelte.ts`、`src/lib/stores/historySettings.svelte.ts`
  - 映射：`history.data-contract`、`history.persistence`、`history.cleanup`、`history.lifecycle`、`history.deviations`
  - [ ] neoview-history 旧 key
  - [ ] neoview-unified-history 新 key
  - [ ] 旧 entry 迁移
  - [ ] 旧视频进度迁移
  - [ ] 旧数据迁移后保留
  - [ ] pathStack identity
  - [ ] 重复项更新并移到最前
  - [ ] updateIndex 不改变时间戳
  - [ ] 视频进度完成映射
  - [ ] maxHistorySize 0 为无限
  - [ ] 正数限制保存数量
  - [ ] 无效 JSON 降级
  - [ ] 单项移除
  - [ ] 清空
  - [ ] 按数量清理
  - [ ] 按日期清理
  - [ ] 按文件夹清理
- `history-ui.states-lifecycle` 加载、空、错误、失效路径与释放
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/components/panels/folderPanel/utils/virtualPathLoader.ts`、`src/lib/stores/unifiedHistory.svelte.ts`、`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`
  - 映射：`history.states`、`history.lifecycle`、`history.shell`、`history.performance`、`history.deviations`
  - [ ] 加载状态
  - [ ] 空历史状态
  - [ ] 分页错误
  - [ ] 操作错误
  - [ ] 重试
  - [ ] 刷新
  - [ ] 路径失效降级
  - [ ] 首次加载后台清理一次
  - [ ] 存在检查失败时保留记录
  - [ ] Card 折叠零查询
  - [ ] 搜索切换取消旧结果
  - [ ] 缩略图上下文释放
  - [ ] store subscription 释放
  - [ ] 迟到结果拒绝
  - [ ] 独立 lazy chunk
  - [ ] 大列表有界 DOM
- `history-ui.shell` History Panel 与无标题 full-height Card shell
  - 源码：`src/lib/cards/history/HistoryListCard.svelte`、`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cards/CollapsibleCard.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 映射：`history.shell`、`history.ui-parity`、`history.lifecycle`、`history.deviations`
  - [ ] History 图标
  - [ ] 历史记录标题
  - [ ] history Panel
  - [ ] defaultVisible
  - [ ] defaultExpanded
  - [ ] canHide=false
  - [ ] fullHeight=true
  - [ ] hideHeader=true
  - [ ] 动态 loader
  - [ ] Panel 折叠
  - [ ] Card Window
  - [ ] 失败边界
  - [ ] 当前 XR canHide=true 偏离待解决
- `history-ui.shared-contract` GUI、CLI、TUI 共用阅读历史契约
  - 源码：`src/lib/stores/unifiedHistory.svelte.ts`、`src/lib/types/content.ts`、`src/lib/cards/shared/useFileActions.ts`
  - 映射：`history.data-contract`、`history.progress`、`history.cleanup`、`history.lifecycle`、`history.performance`
  - [ ] 稳定 book/history id
  - [ ] 规范 source identity
  - [ ] displayName
  - [ ] pageIndex
  - [ ] pageCount
  - [ ] updatedAt
  - [ ] pathStack 导入
  - [ ] media progress 导入
  - [ ] 有界 offset/limit
  - [ ] 按 updatedAt 倒序
  - [ ] 单项删除
  - [ ] 按 before/limit 清理
  - [ ] 失效路径清理
  - [ ] 取消
  - [ ] 错误
  - [ ] 数据库关闭
  - [ ] GUI CLI TUI 共用服务
  - [ ] 不暴露第二套 store
- `history-ui.accessibility-parity` 可访问性、响应式与视觉 characterization
  - 源码：`src/lib/cards/history/HistoryListCard.svelte`、`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/components/panels/file/components/FileItemListView.svelte`、`src/lib/components/panels/folderPanel/components/FolderToolbar/NavigationButtons.svelte`
  - 映射：`history.accessibility`、`history.ui-parity`、`history.image-stability`、`history.performance`
  - [ ] 命名 icon button
  - [ ] pressed 状态
  - [ ] destructive confirmation
  - [ ] live feedback
  - [ ] 焦点可见
  - [ ] 触摸可达操作
  - [ ] desktop screenshot
  - [ ] 420x360 screenshot
  - [ ] 无重叠
  - [ ] 旧信息密度
  - [ ] 完整路径 tooltip
  - [ ] 活动 Reader 图像不重挂
  - [ ] 重复 active asset 请求为零

##### 专用源码级验收项

- [x] `history.shared-renderer` 复用文件浏览器条目视觉契约
  - 目标：History rows use the same source-evidenced file item renderers as the folder surface instead of a divergent text-only recent list.
  - 源码：`src/lib/cards/history/HistoryListCard.svelte`、`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/cards/folder/cards/FileListCard.svelte`
  - 测试：`neoview.history.card`、`neoview.history.shared-renderer`、`neoview.history.views`、`neoview.history.thumbnail-e2e`
  - 备注：History now renders list, content, banner and thumbnail modes through ReaderEntrySurface with the shared selection, media and action slots instead of maintaining a History-only row renderer.
- [ ] `history.fields` 显示完整历史条目字段
  - 目标：Each entry preserves stable identity, display name, canonical source, path stack, current file, content type, updated time and bounded page or media progress fields.
  - 源码：`src/lib/stores/unifiedHistory.svelte.ts`、`src/lib/components/panels/file/components/VirtualizedFileListV2.svelte`、`src/lib/components/panels/file/components/FileItemListView.svelte`
  - 测试：`neoview.history.card`、`neoview.library.contract`、`neoview.history.fields`、`neoview.history.e2e`
  - 备注：Current shared recents expose name, source, page index/count and updated time; path-stack, media and content-type presentation remain incomplete.
- [ ] `history.progress` 显示并更新页面与视频进度
  - 目标：Page progress and video position/duration/completed state share one normalized recent identity and update monotonically without creating duplicate history rows.
  - 源码：`src/lib/stores/unifiedHistory.svelte.ts`、`src/lib/components/panels/file/components/FileItemListView.svelte`
  - 测试：`neoview.progress.sqlite`、`neoview.history.progress`、`neoview.history.media-progress`、`neoview.history.e2e`
  - 备注：Page recents and a separate compatible media-progress table exist; the Card does not yet render full video progress or completion semantics.
- [ ] `history.open-resume` 从历史恢复原书源与阅读位置
  - 目标：Opening an archive, file, directory or nested single-file history item restores its canonical source, page index and current file or media position through the shared Reader session.
  - 源码：`src/lib/cards/shared/useFileActions.ts`、`src/lib/stores/unifiedHistory.svelte.ts`
  - 测试：`neoview.history.card`、`neoview.history.resume`、`neoview.history.path-stack`、`neoview.history.e2e`
  - 备注：React reopens the source path, but current tests do not prove page, current-file, path-stack or media-position restoration.
- [ ] `history.search-sort-filter` 搜索、八字段排序与类型筛选
  - 目标：History supports bounded search, name/path/date/size/type/random/rating/collect-tag sorting, ascending/descending order and all/archive/folder/video filters with date-desc defaults.
  - 源码：`src/lib/cards/folder/cards/ToolbarCard.svelte`、`src/lib/components/panels/folderPanel/components/FolderToolbar/SortPanel.svelte`、`src/lib/components/panels/folderPanel/components/FolderToolbar/TypeFilterBar.svelte`
  - 测试：`neoview.history.search`、`neoview.history.sort`、`neoview.history.filter`、`neoview.history.e2e`
  - 备注：The current React Card exposes only backend updated-time order and refresh.
- [ ] `history.views` 切换四种共享文件视图
  - 目标：List, content, banner and thumbnail modes retain their legacy icons, active state, compact thumbnail option and History-specific size preference.
  - 源码：`src/lib/components/panels/folderPanel/components/FolderToolbar/ViewPanel.svelte`、`src/lib/cards/folder/cards/FileListCard.svelte`
  - 测试：`neoview.history.views`、`neoview.history.thumbnail-e2e`
  - 备注：The four legacy labels and active icon states now drive one- and multi-column virtual layouts; compact-thumbnail control, width sizing and canonical History-specific persistence remain pending.
- [ ] `history.thumbnails` 显示可见历史缩略图与文件夹预览
  - 目标：Only the virtual visible history window requests authenticated file or folder thumbnails, including bounded multi-image folder previews, and releases stale contexts on mode, query or mount changes.
  - 源码：`src/lib/components/panels/file/components/VirtualizedFileListV2.svelte`、`src/lib/components/panels/file/components/FileItemListView.svelte`、`src/lib/utils/thumbnail/VisibleThumbnailLoader.ts`
  - 测试：`neoview.history.thumbnail-visible`、`neoview.history.views`、`neoview.history.thumbnail-e2e`、`neoview.shared-thumbnail.fit`
  - 备注：Content, banner and thumbnail modes register authenticated cover thumbnails only for the visible virtual rows, directory sources request four-image previews, compact list performs zero thumbnail work, and mode transitions release obsolete demand; explicit headless demand remains pending.
- [ ] `history.selection` 共享选择、链选与焦点语义
  - 目标：Single, toggle, range/chain, all, invert and keyboard focus selection remain bounded and separate from opening behavior across all History views.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/components/panels/folderPanel/components/SelectionBar.svelte`、`src/lib/components/panels/file/components/VirtualizedFileListV2.svelte`
  - 测试：`neoview.history.selection`、`neoview.history.selection-keyboard`、`neoview.history.thumbnail-e2e`
  - 备注：Stable book IDs back single, Ctrl/Meta toggle, Shift range, loaded-item select-all/invert/clear and a semantic multiselect list. Arrow/Home/End use the virtual row index and restore the focused item across all four views; explicit chain-mode and click-open/select controls remain pending.
- [ ] `history.actions` 打开、定位、书签、文件与历史动作
  - 目标：History preserves open, browse/new-tab, system-open, reveal, copy path/name, add bookmark, tree pin, tag, thumbnail reload and confirmed single/batch history removal through authenticated host capabilities.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/cards/shared/useFileActions.ts`、`src/lib/components/panels/folderPanel/components/FolderContextMenu.svelte`
  - 测试：`neoview.history.card`、`neoview.history.batch-remove`、`neoview.library.http`、`neoview.history.thumbnail-e2e`
  - 备注：Single/double-click and explicit resume plus confirmed single/batch history removal exist; browse, new-tab, reveal, copy, add-bookmark, tag and thumbnail-reload actions remain pending.
- [ ] `history.cleanup` 清理失效、最旧、过期、目录与全部历史
  - 目标：Bounded, cancellable cleanup supports confirmed missing paths, oldest count, timestamp cutoff, folder scope and clear-all without deleting unrelated progress or bookmarks.
  - 源码：`src/lib/components/panels/folderPanel/components/FolderToolbar/NavigationButtons.svelte`、`src/lib/components/panels/folderPanel/components/FolderToolbar/CleanupOptionsDialog.svelte`、`src/lib/stores/unifiedHistory.svelte.ts`
  - 测试：`neoview.library.cleanup-invalid`、`neoview.library.cleanup-cancel`、`neoview.library.cli`、`neoview.history.cleanup`、`neoview.history.e2e`
  - 备注：Core invalid and before/limit cleanup exists; the complete advanced GUI modes and exact counts remain pending.
- [ ] `history.sync-folder` 同步历史选择到文件夹 Panel
  - 目标：A default-off History-specific toggle optionally reveals the selected source parent in the shared folder surface without changing the history source or opening duplicate sessions.
  - 源码：`src/lib/cards/shared/useFileActions.ts`、`src/lib/stores/historySettings.svelte.ts`、`src/lib/components/panels/folderPanel/components/FolderToolbar/tabs/OtherTab.svelte`
  - 测试：`neoview.history.sync-folder`、`neoview.history.settings`、`neoview.history.e2e`
  - 备注：No canonical XR setting or React control exists.
- [ ] `history.data-contract` GUI、CLI、TUI 共用阅读历史契约
  - 目标：All surfaces share stable source identity, display name, page and media progress, updated time, bounded paging, deletion, cleanup, cancellation and disposal through one Reader library service.
  - 源码：`src/lib/stores/unifiedHistory.svelte.ts`、`src/lib/types/content.ts`
  - 测试：`neoview.library.contract`、`neoview.library.http`、`neoview.library.headless`、`neoview.library.cli`、`neoview.library.tui`、`neoview.library.sqlite`
  - 备注：The shared service covers page recents and destructive commands; richer path-stack/media/view contracts remain incomplete.
- [ ] `history.states` 加载、空、错误、刷新与失效路径
  - 目标：Stable loading, empty, request error, action error, retry, cleanup pending/result and invalid-path states retain usable rows when optional thumbnail or metadata work fails.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/components/panels/folderPanel/utils/virtualPathLoader.ts`、`src/lib/stores/unifiedHistory.svelte.ts`
  - 测试：`neoview.history.card`、`neoview.library.lifecycle`、`neoview.history.states`、`neoview.history.e2e`
  - 备注：React has empty, request error, refresh and action error states; retry, partial thumbnail/metadata and cleanup feedback are incomplete.
- [ ] `history.persistence` 迁移业务历史并持久化独立视图设置
  - 目标：Legacy neoview-history and neoview-unified-history data import once into compatible xr_ progress tables, History view/behavior settings use canonical [nodes.neoview], and Card layout remains separate.
  - 源码：`src/lib/stores/history.svelte.ts`、`src/lib/stores/unifiedHistory.svelte.ts`、`src/lib/stores/historySettings.svelte.ts`、`src/lib/stores/virtualPanelSettings.svelte.ts`、`src/lib/stores/cardConfig.svelte.ts`
  - 测试：`neoview.reader-data.codec`、`neoview.reader-data.import`、`neoview.library.sqlite`、`neoview.settings.card-layout`、`neoview.history.settings`
  - 备注：Legacy business import and xr_ tables exist; History-specific canonical UI settings and full migration evidence remain incomplete.
- [ ] `history.lifecycle` 取消分页、缩略图和清理并释放所有权
  - 目标：Refresh, query/view changes, collapse, unmount and backend disposal abort stale pages, thumbnails and cleanup, release subscriptions and contexts, and reject late publication.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/components/panels/folderPanel/utils/virtualPathLoader.ts`、`src/lib/utils/thumbnail/VisibleThumbnailLoader.ts`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.library.lifecycle`、`neoview.library.cleanup-cancel`、`neoview.history.lifecycle`、`neoview.history.thumbnail-visible`、`neoview.history.thumbnail-e2e`
  - 备注：Pagination and visible-thumbnail requests abort on replacement/unmount and the thumbnail owner context is released; cleanup, collapse and full backend disposal evidence remain pending.
- [ ] `history.shell` 保持 History full-height 无标题 Card shell
  - 目标：History remains independently lazy in the History Panel with default visible/expanded, canHide=false, fullHeight=true and hideHeader=true while retaining Panel collapse, window and failure boundaries.
  - 源码：`src/lib/cards/history/HistoryListCard.svelte`、`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/components/cardwindow/CardWindowContent.svelte`
  - 测试：`neoview.shell.registry-lazy`、`neoview.history.shell`、`neoview.history.chunk`、`neoview.history.thumbnail-e2e`
  - 备注：The manifest now restores canHide=false and the Card remains independently lazy; generic shell full-height/hide-header parity remains pending.
- [ ] `history.accessibility` 命名动作、键盘选择与焦点恢复
  - 目标：Rows, search, view/filter controls, menus, selection and destructive dialogs are keyboard/touch operable with accessible names, input guards, visible focus and focus restoration.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/components/panels/file/components/VirtualizedFileListV2.svelte`、`src/lib/components/panels/file/components/FileItemListView.svelte`、`src/lib/components/panels/folderPanel/utils/keyboardHandler.ts`
  - 测试：`neoview.history.card`、`neoview.history.selection`、`neoview.history.selection-keyboard`、`neoview.history.thumbnail-e2e`
  - 备注：The multiselect list and named selection controls support Space/Enter, grid-aware arrows, Home/End, Ctrl/Cmd+A, Delete and Escape. Focus returns to the same stable item after view changes; search focus, keyboard context menus and dialog-close focus restoration remain pending.
- [ ] `history.ui-parity` 保持旧版历史信息密度与响应式几何
  - 目标：Progress, time, read/bookmark state, folder-style media hierarchy and toolbar density remain readable at desktop and 420x360 without overlap or horizontal overflow.
  - 源码：`src/lib/cards/history/HistoryListCard.svelte`、`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/components/panels/file/components/FileItemListView.svelte`
  - 测试：`neoview.history.views`、`neoview.history.thumbnail-e2e`、`neoview.history.selection`
  - 备注：Desktop and 420x360 Chromium prove compact/content rows, two-column banners and three-column thumbnails preserve cover media, progress hierarchy, selection density and zero horizontal overflow; read/bookmark badges and the full toolbar remain pending.
- [ ] `history.performance` 有界分页、DOM、缩略图、清理与独立 chunk
  - 目标：A 10K history corpus keeps bounded paging and DOM, registers only visible thumbnails, bounds path checks and cleanup batches, performs zero hidden work and stays in an independent deferred chunk.
  - 源码：`src/lib/cards/folder/cards/FileListCard.svelte`、`src/lib/components/panels/file/components/VirtualizedFileListV2.svelte`、`src/lib/utils/thumbnail/VisibleThumbnailLoader.ts`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.library.contract`、`neoview.library.lifecycle`、`neoview.library.cleanup-invalid`、`neoview.history.thumbnail-visible`、`neoview.history.views`、`neoview.history.chunk`、`neoview.history.thumbnail-e2e`
  - 备注：All four modes share the bounded one/multi-column virtual engine, compact mode performs zero thumbnail work, and production audit keeps History in an independent 8,039-byte chunk plus a shared 4,464-byte ReaderLibraryList chunk; 10K Chromium and advanced cleanup budgets remain pending.
- [ ] `history.image-stability` 历史交互不重挂活动阅读媒体
  - 目标：Opening History, refreshing, searching, changing views, scrolling thumbnails, selecting and cleaning records preserve the active Reader media node and asset URL until an explicit history entry is opened.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/utils/thumbnail/VisibleThumbnailLoader.ts`
  - 测试：`neoview.history.image-stability`、`neoview.history.views`、`neoview.history.thumbnail-e2e`
  - 备注：Desktop and 420x360 Chromium prove opening, thumbnail loading, all four view changes, selection and batch removal preserve the active image node; search and scrolling identity remain pending.
- [ ] `history.deviations` 记录共享后端、键盘扩展与 shell 差异
  - 目标：Document authenticated paged xr_ history storage, shared React entry/thumbnail primitives and full keyboard operation as XR replacements while preserving legacy fields and controls; explicitly resolve current canHide=true against legacy canHide=false/fullHeight/hideHeader, and replace unbounded in-process invalid-path checks with cancellable bounded cleanup.
  - 源码：`src/lib/cards/history/HistoryListCard.svelte`、`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/stores/unifiedHistory.svelte.ts`、`src/lib/components/panels/folderPanel/utils/keyboardHandler.ts`、`src/lib/cards/registry.ts`
  - 测试：`neoview.history.shell`、`neoview.history.selection`、`neoview.history.thumbnail-visible`、`neoview.history.thumbnail-e2e`
  - 备注：XR replaces localStorage and unbounded Promise.all path checks with authenticated paged xr_ history, visible-window thumbnail contexts and bounded cancellable services; keyboard focus additions are intentional, canHide=false is restored, while fullHeight/hideHeader remain unresolved.

### Panel: `bookmark`（1）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `bookmarkList` | 书签列表 | core | partial | `src/lib/cards/bookmark/BookmarkListCard.svelte` | 历史、书签、阅读进度和数据洞察；XR `bookmark-list` |

#### `bookmarkList` 书签列表

- 细项清单：`migration/neoview/bookmark-list-compatibility.json`
- [ ] 虚拟化显示书签和自定义列表
- [ ] 搜索、排序、筛选、打开和定位源
- [ ] 创建/重命名/删除列表并单项/批量编辑书签
- UI 基线：`src/lib/cards/bookmark/BookmarkListCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

##### 专用逐控件库存（17 组，224 项）

- `bookmark-ui.shared-folder-surface` 共享文件浏览器外观与条目 renderer
  - 源码：`src/lib/cards/bookmark/BookmarkListCard.svelte`、`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/cards/folder/cards/FileListCard.svelte`
  - 映射：`bookmark.shared-renderer`、`bookmark.thumbnails`、`bookmark.selection`、`bookmark.ui-parity`
  - [ ] virtual://bookmark 初始源
  - [ ] 复用 FileListPanel
  - [ ] 复用 FileListCard
  - [ ] 列表/内容/横幅/缩略图视觉语义
  - [ ] 文件与文件夹图标
  - [ ] 可见条目缩略图
  - [ ] 名称与路径层级
  - [ ] 选中背景
  - [ ] 键盘焦点 ring
  - [ ] hover 状态
  - [ ] 缩略图失败占位
  - [ ] 窄 Card 响应式密度
- `bookmark-ui.lists` 书签列表切换与管理
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/stores/bookmark.svelte.ts`
  - 映射：`bookmark.lists`、`bookmark.list-management`、`bookmark.persistence`、`bookmark.accessibility`
  - [ ] 全部列表 chip
  - [ ] 默认列表
  - [ ] 收藏列表
  - [ ] 自定义列表 chip
  - [ ] 活动列表强调
  - [ ] 横向滚动
  - [ ] + 新建列表
  - [ ] 列表名称输入
  - [ ] 收藏夹列表标记
  - [ ] 重命名自定义列表
  - [ ] 删除自定义列表
  - [ ] 删除列表后移除成员关系
  - [ ] 持久化活动列表
- `bookmark-ui.navigation-selection` 虚拟浏览、选择与键盘
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/components/panels/folderPanel/utils/keyboardHandler.ts`、`src/lib/cards/folder/cards/FileListCard.svelte`
  - 映射：`bookmark.virtualization`、`bookmark.selection`、`bookmark.actions`、`bookmark.accessibility`
  - [ ] 虚拟列表分页
  - [ ] 单选
  - [ ] Ctrl/Meta 切换
  - [ ] Shift 范围选择
  - [ ] 全选
  - [ ] 取消选择
  - [ ] Enter 打开
  - [ ] 双击打开
  - [ ] 方向键移动焦点
  - [ ] Home/End
  - [ ] Delete
  - [ ] Ctrl/Cmd+F
  - [ ] 右键菜单
  - [ ] Shift+F10
  - [ ] 打开文件夹/书籍
- `bookmark-ui.actions` 书签与文件操作
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/cards/shared/useFileActions.ts`、`src/lib/components/panels/folderPanel/components/FolderContextMenu.svelte`
  - 映射：`bookmark.actions`、`bookmark.batch-edit`、`bookmark.thumbnails`、`bookmark.deviations`
  - [ ] 添加当前书籍
  - [ ] 添加单项到列表
  - [ ] 批量添加到多个列表
  - [ ] 收藏/取消收藏
  - [ ] 移除书签
  - [ ] 复制路径
  - [ ] 复制名称
  - [ ] 系统定位
  - [ ] 系统打开
  - [ ] 重命名
  - [ ] 删除与确认
  - [ ] 撤销删除
  - [ ] 重载缩略图
  - [ ] 编辑标签
  - [ ] 打开新标签页
- `bookmark-ui.states-lifecycle` 状态、持久化与生命周期
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/stores/bookmark.svelte.ts`、`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`
  - 映射：`bookmark.states`、`bookmark.data-contract`、`bookmark.lifecycle`、`bookmark.shell`、`bookmark.performance`、`bookmark.deviations`
  - [ ] 加载状态
  - [ ] 空列表状态
  - [ ] 分页错误
  - [ ] 操作错误
  - [ ] 刷新
  - [ ] 路径失效降级
  - [ ] Card 折叠零缩略图工作
  - [ ] 切列表取消旧请求
  - [ ] 卸载释放 thumbnail context
  - [ ] 书签去重
  - [ ] 旧 localStorage 导入
  - [ ] NeoView 主数据库持久化
  - [ ] 独立 lazy chunk
  - [ ] 大列表有界 DOM
- `bookmark-ui.shell` Bookmark Panel 与无标题 full-height Card shell
  - 源码：`src/lib/components/panels/BookmarkPanel.svelte`、`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`
  - 映射：`bookmark.shell`、`bookmark.ui-parity`、`bookmark.deviations`
  - [ ] Bookmark 图标
  - [ ] 书签列表标题
  - [ ] bookmark Panel
  - [ ] defaultVisible
  - [ ] defaultExpanded
  - [ ] canHide=false
  - [ ] fullHeight=true
  - [ ] hideHeader=true
  - [ ] 动态 loader
  - [ ] Panel 折叠
  - [ ] Card Window
  - [ ] 失败边界
- `bookmark-ui.virtual-toolbar` 书签虚拟源工具栏与清理
  - 源码：`src/lib/cards/folder/cards/ToolbarCard.svelte`、`src/lib/components/panels/folderPanel/components/FolderToolbar/FolderToolbar.svelte`、`src/lib/components/panels/folderPanel/components/FolderToolbar/ActionButtons.svelte`
  - 映射：`bookmark.actions`、`bookmark.states`、`bookmark.lifecycle`、`bookmark.deviations`
  - [ ] 重新加载书签
  - [ ] 同步文件夹开关
  - [ ] 清理下拉菜单
  - [ ] 清理失效书签
  - [ ] 最近清理数量
  - [ ] 高级清理
  - [ ] 清空全部确认
  - [ ] 操作 pending
  - [ ] disabled 状态
  - [ ] 成功/错误反馈
- `bookmark-ui.search-sort-filter` 搜索、八字段排序与类型筛选
  - 源码：`src/lib/components/panels/folderPanel/components/FolderToolbar/FolderToolbar.svelte`、`src/lib/components/panels/folderPanel/components/FolderToolbar/SortPanel.svelte`、`src/lib/components/panels/folderPanel/components/FolderToolbar/TypeFilterBar.svelte`
  - 映射：`bookmark.shared-renderer`、`bookmark.virtualization`、`bookmark.persistence`、`bookmark.ui-parity`
  - [ ] 搜索书签
  - [ ] 名称排序
  - [ ] 路径排序
  - [ ] 添加时间排序
  - [ ] 大小排序
  - [ ] 类型排序
  - [ ] 随机排序
  - [ ] 评分排序
  - [ ] 收藏标签数排序
  - [ ] 升序
  - [ ] 降序
  - [ ] 全部类型
  - [ ] 压缩包
  - [ ] 文件夹
  - [ ] 视频
  - [ ] 独立书签设置
- `bookmark-ui.views` 四种文件视图与尺寸设置
  - 源码：`src/lib/components/panels/folderPanel/components/FolderToolbar/ViewPanel.svelte`、`src/lib/cards/folder/cards/FileListCard.svelte`
  - 映射：`bookmark.shared-renderer`、`bookmark.thumbnails`、`bookmark.persistence`、`bookmark.ui-parity`
  - [ ] list
  - [ ] content
  - [ ] banner
  - [ ] thumbnail
  - [ ] 活动视图图标
  - [ ] 紧凑网格
  - [ ] 缩略图宽度 10..90
  - [ ] 响应式列数
  - [ ] 列表尺寸 Slider
  - [ ] 书签视图独立持久化
- `bookmark-ui.thumbnail-detail` 可见缩略图与文件夹多图预览
  - 源码：`src/lib/utils/thumbnail/VisibleThumbnailLoader.ts`、`src/lib/components/panels/file/components/FolderPreviewGrid.svelte`、`src/lib/components/panels/file/components/folderPreviewLoader.ts`
  - 映射：`bookmark.thumbnails`、`bookmark.lifecycle`、`bookmark.performance`、`bookmark.image-stability`
  - [ ] 32ms 可见范围 debounce
  - [ ] 中心优先
  - [ ] 有限预取
  - [ ] 鉴权 opaque URL
  - [ ] 稳定 bookmark id
  - [ ] folder 1/4/9/16 preview
  - [ ] 单图
  - [ ] 多格
  - [ ] skeleton
  - [ ] 失败 fallback
  - [ ] lazy
  - [ ] async decode
  - [ ] 切换取消
  - [ ] context release
- `bookmark-ui.item-renderer` 文件条目字段、徽章与状态
  - 源码：`src/lib/components/panels/file/components/FileItemCard.svelte`、`src/lib/components/panels/file/components/FileItemListView.svelte`、`src/lib/components/panels/file/components/FileItemGridView.svelte`
  - 映射：`bookmark.shared-renderer`、`bookmark.selection`、`bookmark.ui-parity`、`bookmark.deviations`
  - [ ] 名称
  - [ ] 完整路径
  - [ ] 文件/文件夹图标
  - [ ] 译名
  - [ ] 评分
  - [ ] 收藏标签
  - [ ] 手工标签
  - [ ] EMM 标签
  - [ ] 书签标记
  - [ ] 已读标记
  - [ ] 创建时间
  - [ ] 大小
  - [ ] 进度
  - [ ] 视频元数据
  - [ ] selected
  - [ ] focused
  - [ ] delete
  - [ ] check
- `bookmark-ui.selection-toolbar` 多选、链选与批量操作栏
  - 源码：`src/lib/components/panels/folderPanel/components/SelectionBar.svelte`、`src/lib/cards/shared/FileListPanel.svelte`
  - 映射：`bookmark.selection`、`bookmark.batch-edit`、`bookmark.accessibility`、`bookmark.performance`
  - [ ] checkbox
  - [ ] 点选
  - [ ] 点开
  - [ ] Ctrl/Meta 切换
  - [ ] Shift 链选
  - [ ] 全选
  - [ ] 反选
  - [ ] 取消
  - [ ] 选择计数
  - [ ] 批量删除
  - [ ] 批量添加到列表
  - [ ] 焦点与选择分离
- `bookmark-ui.context-actions` 文件上下文菜单
  - 源码：`src/lib/components/panels/folderPanel/components/FolderContextMenu.svelte`、`src/lib/cards/shared/useFileActions.ts`
  - 映射：`bookmark.actions`、`bookmark.batch-edit`、`bookmark.accessibility`、`bookmark.deviations`
  - [ ] 打开为书籍
  - [ ] 浏览
  - [ ] 新标签页
  - [ ] 系统打开
  - [ ] 资源管理器定位
  - [ ] 复制
  - [ ] 剪切
  - [ ] 粘贴
  - [ ] 复制路径
  - [ ] 复制名称
  - [ ] 重命名
  - [ ] 删除
  - [ ] 撤销
  - [ ] 重载缩略图
  - [ ] 编辑标签
  - [ ] 添加到列表
  - [ ] 按类型禁用
- `bookmark-ui.add-dialog` 批量添加到书签列表对话框
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`
  - 映射：`bookmark.list-management`、`bookmark.batch-edit`、`bookmark.states`、`bookmark.accessibility`
  - [ ] 目标项目清单
  - [ ] 多列表 checkbox
  - [ ] 内嵌新列表名称
  - [ ] 收藏夹 toggle
  - [ ] 新建并选中
  - [ ] 无目标状态
  - [ ] 未选列表校验
  - [ ] 取消
  - [ ] 确认
  - [ ] 成功反馈
  - [ ] 错误反馈
- `bookmark-ui.keyboard` 键盘命令与输入保护
  - 源码：`src/lib/components/panels/folderPanel/utils/keyboardHandler.ts`、`src/lib/cards/shared/FileListPanel.svelte`
  - 映射：`bookmark.selection`、`bookmark.actions`、`bookmark.accessibility`、`bookmark.deviations`
  - [ ] input/contenteditable guard
  - [ ] Enter
  - [ ] Backspace
  - [ ] F5
  - [ ] Delete
  - [ ] Ctrl/Cmd+A
  - [ ] Ctrl/Cmd+F
  - [ ] Escape
  - [ ] Arrow
  - [ ] Home/End
  - [ ] context menu keyboard equivalent
  - [ ] 焦点恢复
- `bookmark-ui.persistence` 书签业务数据与视图设置持久化
  - 源码：`src/lib/stores/bookmark.svelte.ts`、`src/lib/stores/virtualPanelSettings.svelte.ts`
  - 映射：`bookmark.data-contract`、`bookmark.persistence`、`bookmark.lifecycle`、`bookmark.deviations`
  - [ ] legacy bookmarks key
  - [ ] legacy lists key
  - [ ] legacy active-list key
  - [ ] bookmark panel settings
  - [ ] createdAt
  - [ ] path normalize
  - [ ] dedupe
  - [ ] 最大数量
  - [ ] list membership
  - [ ] 旧数据导入
  - [ ] xr_ 业务表
  - [ ] [nodes.neoview] UI 设置
- `bookmark-ui.accessibility-parity` 可访问性、响应式与视觉 characterization
  - 源码：`src/lib/cards/bookmark/BookmarkListCard.svelte`、`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/cards/folder/cards/FileListCard.svelte`
  - 映射：`bookmark.accessibility`、`bookmark.ui-parity`、`bookmark.image-stability`、`bookmark.performance`
  - [ ] 命名 icon button
  - [ ] pressed 状态
  - [ ] destructive confirmation
  - [ ] live feedback
  - [ ] 焦点可见
  - [ ] 触摸可达操作
  - [ ] desktop screenshot
  - [ ] 420x360 screenshot
  - [ ] 无重叠
  - [ ] 旧信息密度
  - [ ] 缩略图不重挂 Reader 图像

##### 专用源码级验收项

- [x] `bookmark.shared-renderer` 复用文件浏览器条目视觉契约
  - 目标：Bookmark rows use a shared folder-entry visual primitive for compact/rich list and thumbnail surfaces instead of a divergent icon-only list.
  - 源码：`src/lib/cards/bookmark/BookmarkListCard.svelte`、`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/cards/folder/cards/FileListCard.svelte`
  - 测试：`neoview.shared-entry.variants`、`neoview.shared-entry.interaction`、`neoview.bookmark.thumbnail-visible`、`neoview.bookmark.view-modes`、`neoview.bookmark.thumbnail-e2e`
  - 备注：Bookmark exposes the legacy 列表/内容/横幅/缩略图 controls and renders every mode through ReaderEntrySurface rather than a Bookmark-only item renderer; Folder migration remains owned by its separate checklist.
- [ ] `bookmark.thumbnails` 显示可见书签缩略图
  - 目标：Only the virtual visible bookmark window registers authenticated file/folder thumbnails; stale batches cancel and contexts release on list change or unmount.
  - 源码：`src/lib/cards/folder/cards/FileListCard.svelte`、`src/lib/utils/thumbnail/VisibleThumbnailLoader.ts`
  - 测试：`neoview.bookmark.thumbnail-visible`、`neoview.bookmark.view-modes`、`neoview.bookmark.thumbnail-lease`、`neoview.bookmark.thumbnail-e2e`、`neoview.bookmark.thumbnail-lease-e2e`、`neoview.shared-thumbnail.fit`
  - 备注：Content, banner and thumbnail modes reuse the Folder entry surface and register authenticated cover thumbnails only for the scoped virtual visible window; compact or empty modes release the active context immediately, folder entries request four-image preview semantics, and invalid-path parity remains pending.
- [ ] `bookmark.lists` 切换系统与自定义书签列表
  - 目标：All, default, favorites and custom lists remain distinguishable and the active list filters the virtual source.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/stores/bookmark.svelte.ts`
  - 测试：`neoview.bookmark.card`、`neoview.bookmark.thumbnail-e2e`
  - 备注：React now preserves the legacy horizontal chip hierarchy; active-list persistence and the full management surface remain incomplete.
- [x] `bookmark.list-management` 创建、重命名、收藏与删除列表
  - 目标：Custom lists support create, rename, favorite and delete with protected system lists and membership cleanup.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/stores/bookmark.svelte.ts`
  - 测试：`neoview.library.bookmarks`、`neoview.bookmark.list-management`、`neoview.bookmark.thumbnail-e2e`
  - 备注：GUI uses controlled dialogs for create/rename/favorite/delete, system lists stay protected, and all mutations reuse the shared service used by CLI/TUI.
- [ ] `bookmark.virtualization` 虚拟化大书签列表
  - 目标：List rendering, pagination and thumbnail demand remain bounded by the visible window at 10K items.
  - 源码：`src/lib/cards/folder/cards/FileListCard.svelte`
  - 测试：`neoview.library.lifecycle`、`neoview.bookmark.thumbnail-visible`
  - 备注：Rows and thumbnail registration are bounded by the virtual window; the dedicated 10K Chromium request-count corpus remains pending.
- [x] `bookmark.selection` 共享选择与焦点语义
  - 目标：Single, toggle, range and keyboard focus selection match the folder Card without materializing unbounded DOM.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/components/panels/folderPanel/utils/keyboardHandler.ts`
  - 测试：`neoview.bookmark.selection`、`neoview.bookmark.thumbnail-e2e`
  - 备注：Stable bookmark IDs back single, Ctrl/Meta toggle and Shift range selection; Arrow/Home/End move visible focus, Space selects and Enter opens without adding DOM rows.
- [ ] `bookmark.actions` 打开、定位、收藏与移除书签
  - 目标：Single bookmark actions preserve legacy file commands and authenticated host capabilities.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/cards/shared/useFileActions.ts`
  - 测试：`neoview.bookmark.card`、`neoview.library.bookmarks`、`neoview.bookmark.thumbnail-e2e`
  - 备注：Single/double-click and explicit open, star, single remove and confirmed batch remove exist; copy, reveal, system-open, rename, tags and new-tab actions remain pending.
- [ ] `bookmark.batch-edit` 批量编辑书签与列表成员关系
  - 目标：Selected bookmarks can be added to multiple lists or removed through one bounded operation.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/stores/bookmark.svelte.ts`
  - 测试：`neoview.bookmark.batch-contract`、`neoview.bookmark.batch-delete`、`neoview.bookmark.batch-edit`、`neoview.bookmark.thumbnail-e2e`
  - 备注：GUI sends one bounded authenticated request for multi-list membership and one for confirmed delete; explicit CLI/TUI batch commands remain pending.
- [ ] `bookmark.data-contract` GUI/CLI/TUI 共用书签契约
  - 目标：All surfaces share canonical source identity, list membership, favorite state and timestamps without a second bookmark store.
  - 源码：`src/lib/stores/bookmark.svelte.ts`
  - 测试：`neoview.library.contract`、`neoview.library.bookmarks`、`neoview.library.cli`、`neoview.library.tui`
  - 备注：Core persistence is shared; remaining UI commands must use it.
- [ ] `bookmark.states` 加载、空、错误、刷新与失效路径
  - 目标：Stable loading, empty, request error, action error, retry and invalid-path states retain existing rows when optional thumbnails fail.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`
  - 测试：`neoview.library.lifecycle`
  - 备注：Thumbnail failure must degrade independently.
- [ ] `bookmark.persistence` 持久化列表、活动筛选与 Card 布局
  - 目标：Bookmark business data remains in the compatible NeoView database while Card layout uses canonical [nodes.neoview].
  - 源码：`src/lib/stores/bookmark.svelte.ts`、`src/lib/stores/cardConfig.svelte.ts`
  - 测试：`neoview.library.bookmarks`、`neoview.settings.card-layout`
  - 备注：Active-list persistence and legacy import still require evidence.
- [ ] `bookmark.lifecycle` 取消分页和缩略图并释放上下文
  - 目标：List switches, collapse, unmount and backend disposal abort stale loads and release thumbnail contexts.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/utils/thumbnail/VisibleThumbnailLoader.ts`
  - 测试：`neoview.library.lifecycle`、`neoview.bookmark.thumbnail-visible`、`neoview.bookmark.thumbnail-lease`、`neoview.bookmark.thumbnail-stale`、`neoview.bookmark.thumbnail-e2e`、`neoview.bookmark.thumbnail-lease-e2e`
  - 备注：Visible batches abort and use list-scoped rotating context IDs; compact/empty transitions and unmount release the active lease without allowing a late DELETE or registration response to affect the next scope. Backend disposal and a dedicated 10K corpus remain pending.
- [x] `bookmark.shell` 保持共享 Card shell 行为
  - 目标：Bookmark remains independently lazy, hideable, collapsible, movable, resizable and window-capable.
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.shell.registry-lazy`、`neoview.bookmark.chunk`、`neoview.shared-entry.chunk`、`neoview.bookmark.thumbnail-e2e`
  - 备注：The shared shell and independent 11,399-byte Bookmark plus 1,969-byte entry-surface deferred production chunks are gated in desktop and constrained Card flows.
- [ ] `bookmark.accessibility` 键盘选择、命名动作与焦点恢复
  - 目标：List tabs, rows, selection, menus and destructive confirmations are keyboard/touch operable with stable accessible names.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/components/panels/folderPanel/utils/keyboardHandler.ts`
  - 测试：`neoview.bookmark.card`
  - 备注：Row actions are named; selection and context actions remain incomplete.
- [x] `bookmark.ui-parity` 保持旧版文件条目信息密度
  - 目标：Folder-style thumbnails, title/path hierarchy, action density and selection states fit desktop and 420x360 Cards without overlap.
  - 源码：`src/lib/cards/shared/FileListPanel.svelte`、`src/lib/cards/folder/cards/FileListCard.svelte`
  - 测试：`neoview.bookmark.view-modes`、`neoview.bookmark.thumbnail-e2e`、`neoview.bookmark.selection`
  - 备注：Desktop and 420x360 Chromium cover compact/content rows, two-column banners and three-column thumbnails with cover fit, shared selection state, stable Reader media and zero horizontal overflow.
- [ ] `bookmark.performance` 有界 DOM、可见缩略图与独立 chunk
  - 目标：The Card renders a bounded virtual window, registers only visible thumbnails, performs zero hidden work and stays in an independent deferred chunk.
  - 源码：`src/lib/cards/folder/cards/FileListCard.svelte`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.bookmark.thumbnail-visible`、`neoview.bookmark.view-modes`、`neoview.bookmark.thumbnail-lease`、`neoview.bookmark.thumbnail-e2e`、`neoview.bookmark.thumbnail-lease-e2e`、`neoview.bookmark.chunk`
  - 备注：Single- and multi-column modes share a bounded virtual row engine, compact mode releases thumbnail work, and the 13.71 KiB Card remains deferred; a 10K Chromium request-count run and visited-page metadata eviction remain pending.
- [ ] `bookmark.image-stability` 缩略图工作不重挂活动阅读图像
  - 目标：Opening the Card, scrolling thumbnails and switching lists preserve the active Reader media node and asset URL.
  - 源码：`src/lib/utils/thumbnail/VisibleThumbnailLoader.ts`、`src/lib/cards/shared/FileListPanel.svelte`
  - 测试：`neoview.bookmark.thumbnail-e2e`
  - 备注：Real Chromium proves opening and thumbnail mutation preserve the active image; scrolling and list-switch identity checks remain pending.
- [x] `bookmark.deviations` 记录共享后端与视觉 primitive 扩展
  - 目标：Document authenticated thumbnail batching and the shared React entry visual as XR implementations of the legacy FileListPanel reuse contract.
  - 源码：`src/lib/cards/bookmark/BookmarkListCard.svelte`、`src/lib/cards/shared/FileListPanel.svelte`
  - 测试：`neoview.shared-entry.variants`、`neoview.bookmark.thumbnail-visible`、`neoview.bookmark.batch-contract`、`neoview.bookmark.thumbnail-e2e`
  - 备注：Authenticated visible-window thumbnails, stable ID selection, bounded batch routes and the shared slot-based entry surface replace the legacy in-process FileListPanel wiring without removing bookmark fields or creating a second business store.

### Panel: `pageList`（1）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `pageListMain` | 页面列表 | core | partial | `src/lib/cards/pageList/PageListCard.svelte` | 页面构建、排序、跳转与边界行为；XR `page-navigation` |

#### `pageListMain` 页面列表

- 细项清单：`migration/neoview/page-list-compatibility.json`
- [ ] list/grid/thumb 三种虚拟化页面视图
- [ ] 搜索、当前页跟随、页码输入和 Slider 跳转
- [ ] 可见批次缩略图预热、超分状态与页面上下文删除
- UI 基线：`src/lib/cards/pageList/PageListCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

##### 专用逐控件库存（16 组，191 项）

- `page-list-ui.toolbar` 搜索、跟随、视图与预热工具栏
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`
  - 映射：`page-list.search`、`page-list.modes`、`page-list.follow`、`page-list.prewarm`、`page-list.states`
  - [ ] 搜索输入
  - [ ] 名称/页码过滤
  - [ ] 跟随进度 toggle
  - [ ] list 按钮
  - [ ] grid 按钮
  - [ ] thumb 按钮
  - [ ] 活动模式强调
  - [ ] 预热全部缩略图按钮
  - [ ] 预热中禁用
  - [ ] 页数统计
  - [ ] 过滤结果统计
  - [ ] 预热中/完成/失败状态
- `page-list-ui.renderers` 文本、带图列表与缩略图网格
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/cards/pageList/PageIndexBadge.svelte`
  - 映射：`page-list.modes`、`page-list.shared-thumbnail`、`page-list.current-state`、`page-list.ui-parity`
  - [ ] 纯文本列表
  - [ ] 页码 badge
  - [ ] 页面名称
  - [ ] 带图列表
  - [ ] 12x16 缩略图比例
  - [ ] object-contain
  - [ ] 缩略图加载 spinner
  - [ ] 缩略图失败占位
  - [ ] 三列 thumb 网格
  - [ ] 3:4 比例
  - [ ] 当前页背景
  - [ ] 当前页 ring
  - [ ] 超分 glow
  - [ ] hover 状态
  - [ ] data-page-index
- `page-list-ui.ordering` 原始页面顺序与无本地排序控件
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/stores/book/pageNavigation.svelte.ts`
  - 映射：`page-list.ordering`、`page-list.data-contract`、`page-list.modes`、`page-list.deviations`
  - [ ] 无排序按钮
  - [ ] 无排序菜单
  - [ ] 无升降序选项
  - [ ] 按 book.pages 原始顺序构建 items
  - [ ] 搜索过滤保持相对顺序
  - [ ] page.index 保持原始页面身份
  - [ ] 列表/带图列表/缩略图网格使用同一顺序
  - [ ] 阅读方向不在 Page List 内重排 catalog
- `page-list-ui.thumbnail-sizing` 固定缩略图 profile 与显示几何
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/stores/unifiedThumbnailStore.svelte.ts`
  - 映射：`page-list.thumbnail-sizing`、`page-list.shared-thumbnail`、`page-list.ui-parity`、`page-list.deviations`
  - [ ] 无缩略图尺寸选择器
  - [ ] 无缩略图尺寸 Slider
  - [ ] 统一 256px thumbnail key
  - [ ] 请求 maxSize 256
  - [ ] 带图列表缩略图 48x64
  - [ ] 带图列表 object-contain
  - [ ] 缩略图网格三列
  - [ ] 缩略图网格 3:4 aspect-ratio
  - [ ] 缩略图网格 object-contain
  - [ ] 任何 XR profile 差异显式记录
- `page-list-ui.navigation` 当前页跟随、Slider 与页码跳转
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/stores/book/pageNavigation.svelte.ts`
  - 映射：`page-list.follow`、`page-list.navigation`、`page-list.current-state`、`page-list.accessibility`
  - [ ] 跟随当前页自动滚动
  - [ ] 关闭跟随后保持预览索引
  - [ ] Slider 最小 0
  - [ ] Slider 最大 total-1
  - [ ] Slider 两侧页码
  - [ ] 跟随模式拖动即时跳转
  - [ ] 预览模式拖动不翻页
  - [ ] 页码输入
  - [ ] Enter 跳转
  - [ ] 范围校验
  - [ ] 当前页更新同步
- `page-list-ui.thumbnail-pipeline` 可见批次缩略图与全部预热
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/stores/unifiedThumbnailStore.svelte.ts`、`src/lib/utils/thumbnail/VisibleThumbnailLoader.ts`
  - 映射：`page-list.shared-thumbnail`、`page-list.prewarm`、`page-list.lifecycle`、`page-list.performance`
  - [ ] list 模式零缩略图请求
  - [ ] grid/thumb 可见批次请求
  - [ ] 本地页面 source
  - [ ] archive entry source
  - [ ] EPUB entry source
  - [ ] 统一 256px key
  - [ ] 请求去重
  - [ ] loading 状态
  - [ ] 失败降级
  - [ ] 后台全部预热
  - [ ] 切模式取消过期请求
  - [ ] 卸载释放 owner
- `page-list-ui.context` 页面右键菜单与删除
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/cards/pageList/PageContextMenu.svelte`
  - 映射：`page-list.context-actions`、`page-list.lifecycle`、`page-list.accessibility`、`page-list.deviations`
  - [ ] 列表右键
  - [ ] 网格右键
  - [ ] 跳转到页面
  - [ ] 删除页面
  - [ ] 目录页移入回收站
  - [ ] 归档 entry 删除
  - [ ] 删除后夹紧当前索引
  - [ ] 释放资源
  - [ ] 成功提示
  - [ ] 失败提示
  - [ ] 菜单外部/Escape 关闭
  - [ ] 键盘菜单位置
- `page-list-ui.states-shell` 空、加载、错误、shell 与有界渲染
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`、`src/lib/core/virtualPageList.ts`
  - 映射：`page-list.states`、`page-list.shell`、`page-list.lifecycle`、`page-list.performance`、`page-list.ui-parity`
  - [ ] 未加载书籍空状态
  - [ ] 无匹配结果
  - [ ] catalog 加载
  - [ ] catalog 错误与重试
  - [ ] Card 无 session 零 DOM
  - [ ] 标题折叠
  - [ ] 不可隐藏
  - [ ] 上下移动
  - [ ] 独立窗口
  - [ ] 高度调整
  - [ ] 独立 lazy chunk
  - [ ] 10K/100K 有界 DOM
  - [ ] 切书取消
  - [ ] 关闭 session 释放
- `page-list-ui.card-shell` Page List Panel 与无标题 full-height Card
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/cards/CardRenderer.svelte`
  - 映射：`page-list.shell`、`page-list.ui-parity`、`page-list.deviations`
  - [ ] List 图标
  - [ ] 页面列表标题
  - [ ] pageList Panel
  - [ ] canHide=false
  - [ ] fullHeight=true
  - [ ] hideHeader=true
  - [ ] 动态 loader
  - [ ] Card Window
  - [ ] 统一 shell 偏离记录
- `page-list-ui.toolbar-controls` 跟随、三视图与预热 icon controls
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`
  - 映射：`page-list.follow`、`page-list.modes`、`page-list.prewarm`、`page-list.accessibility`、`page-list.settings`
  - [ ] Navigation toggle
  - [ ] 动态开关 title
  - [ ] 默认跟随
  - [ ] 外部设置同步
  - [ ] List icon
  - [ ] Grid3x3 icon
  - [ ] Image icon
  - [ ] active variant
  - [ ] Sparkles 预热
  - [ ] 预热禁用
  - [ ] aria-label
  - [ ] tooltip
- `page-list-ui.summary-prefetch` 总数、过滤数与预热三态
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`
  - 映射：`page-list.prewarm`、`page-list.states`、`page-list.lifecycle`
  - [ ] 共 N 页
  - [ ] 显示 M
  - [ ] 预加载中
  - [ ] 全部完成
  - [ ] 预加载失败
  - [ ] 切书重置
  - [ ] 防重复预热
  - [ ] 错误不隐藏 catalog
- `page-list-ui.list-renderer` 纯文本页列表与 PageIndexBadge
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/cards/pageList/PageIndexBadge.svelte`
  - 映射：`page-list.modes`、`page-list.current-state`、`page-list.upscale`、`page-list.context-actions`、`page-list.ui-parity`
  - [ ] 34px 文本行
  - [ ] data-page-index
  - [ ] #N monospace
  - [ ] 页面名称
  - [ ] 当前 badge
  - [ ] 条件 badge
  - [ ] 超分 badge
  - [ ] 当前背景
  - [ ] 超分 glow
  - [ ] 单击跳转
  - [ ] 右键菜单
- `page-list-ui.detail-renderer` 48x64 带图列表
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/cards/pageList/PageIndexBadge.svelte`
  - 映射：`page-list.modes`、`page-list.shared-thumbnail`、`page-list.current-state`、`page-list.context-actions`、`page-list.ui-parity`
  - [ ] 48x64
  - [ ] contain
  - [ ] loading spinner
  - [ ] Image fallback
  - [ ] 页码 badge
  - [ ] 名称
  - [ ] hover visible request
  - [ ] 当前背景
  - [ ] 超分 glow
  - [ ] click
  - [ ] context menu
- `page-list-ui.page-badge-upscale` 页码、当前页、条件与超分状态
  - 源码：`src/lib/cards/pageList/PageIndexBadge.svelte`、`src/lib/cards/pageList/PageListCard.svelte`
  - 映射：`page-list.current-state`、`page-list.upscale`、`page-list.ui-parity`、`page-list.deviations`
  - [ ] none
  - [ ] pending
  - [ ] checking
  - [ ] processing
  - [ ] completed
  - [ ] skipped
  - [ ] failed
  - [ ] 队列中
  - [ ] 超分中
  - [ ] 已超分
  - [ ] 已跳过
  - [ ] 失败
  - [ ] conditionName
  - [ ] 当前
  - [ ] sm/md
  - [ ] pulse/glow
- `page-list-ui.page-file-actions` 复制、定位、系统打开与删除页面
  - 源码：`src/lib/cards/pageList/PageContextMenu.svelte`、`src/lib/cards/pageList/PageListCard.svelte`
  - 映射：`page-list.file-actions`、`page-list.context-actions`、`page-list.lifecycle`、`page-list.deviations`
  - [ ] 复制普通页面
  - [ ] 提取并复制 archive entry
  - [ ] 定位普通页面
  - [ ] 定位 archive
  - [ ] 系统打开普通页
  - [ ] 提取后打开 archive entry
  - [ ] 删除目录页
  - [ ] 删除 archive entry
  - [ ] 释放资源
  - [ ] 重开书籍
  - [ ] 夹紧索引
  - [ ] 最后一页
  - [ ] 成功/失败提示
- `page-list-ui.keyboard-performance-parity` 键盘、稀疏虚拟化与两视口验收
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/core/virtualPageList.ts`
  - 映射：`page-list.accessibility`、`page-list.performance`、`page-list.chunk`、`page-list.image-stability`、`page-list.ui-parity`
  - [ ] Ctrl/Cmd+F
  - [ ] roving focus
  - [ ] Arrow
  - [ ] Home/End
  - [ ] PageUp/PageDown
  - [ ] Enter
  - [ ] context keyboard
  - [ ] Slider keyboard
  - [ ] Input keyboard
  - [ ] 10K/100K O(viewport)
  - [ ] 稳定 page id key
  - [ ] 搜索取消
  - [ ] 隐藏零工作
  - [ ] active image identity
  - [ ] desktop
  - [ ] 420x360
  - [ ] 独立 chunk

##### 专用源码级验收项

- [ ] `page-list.modes` list/grid/thumb 三种虚拟视图
  - 目标：Text list, thumbnail list and three-column thumbnail grid preserve legacy hierarchy and use one sparse page catalog.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`
  - 测试：`neoview.page-list.virtual`、`neoview.page-list.thumbnail-mode`、`neoview.page-list.thumbnail-e2e`
  - 备注：All three sparse virtual modes use the shared thumbnail surface; remaining legacy context and upscale states keep this item partial.
- [x] `page-list.shared-thumbnail` 复用文件条目缩略图表面
  - 目标：Page list and bookmark/folder entries share one accessible thumbnail surface while preserving page-specific contain fit and 3:4 geometry.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/cards/folder/cards/FileListCard.svelte`
  - 测试：`neoview.page-list.shared-thumbnail`、`neoview.page-list.thumbnail-e2e`、`neoview.shared-thumbnail.fit`
  - 备注：Page, bookmark and bottom-strip media reuse ReaderThumbnailSurface while page thumbnails retain contain fit and page-specific geometry.
- [ ] `page-list.search` 搜索页面名称与页码
  - 目标：Search is cancellable, generation-safe and returns a sparse virtual result set with totals.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`
  - 测试：`neoview.page-list.search`
  - 备注：Server-side GUI search exists; headless parity remains incomplete.
- [ ] `page-list.follow` 跟随进度与独立预览索引
  - 目标：Follow mode centers and navigates with the active page; preview mode changes only the local preview position until commit.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`
  - 测试：`neoview.page-list.follow-preview`、`neoview.page-list.thumbnail-e2e`
  - 备注：Focused and Chromium coverage freeze the legacy Slider split: follow-off changes preview only, while follow-on navigates each latest value. Canonical settings persistence remains pending.
- [ ] `page-list.navigation` Slider、页码输入与页面跳转
  - 目标：Slider, numeric entry, Enter and row activation use the shared session navigation contract with strict bounds.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/stores/book/pageNavigation.svelte.ts`
  - 测试：`neoview.page-list.follow-preview`、`neoview.page-list.keyboard`、`neoview.page-list.thumbnail-e2e`、`neoview.session.navigation`、`neoview.cli.pages`、`neoview.tui.navigation`
  - 备注：Slider, row activation and bounded keyboard navigation are covered; the legacy numeric input and context actions remain incomplete.
- [ ] `page-list.current-state` 当前页与超分状态
  - 目标：All renderers expose the active page consistently and show truthful upscale state only when backed by the current pipeline.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/cards/pageList/PageIndexBadge.svelte`
  - 测试：待补
  - 备注：Active state exists; upscale state is not wired in React.
- [ ] `page-list.prewarm` 可取消的全部缩略图预热
  - 目标：An explicit background action prewarms the complete page catalog with progress/error state and cancellation without delaying navigation.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/stores/unifiedThumbnailStore.svelte.ts`
  - 测试：`neoview.page-list.prewarm`、`neoview.page-list.prewarm-lifecycle`、`neoview.page-list.prewarm-e2e`
  - 备注：The source-compatible Sparkles action now prewarms the complete GUI catalog in sequential batches of at most 500 pages, publishes running/complete/error state, and cancels on session replacement or unmount. Explicit CLI/TUI commands and a 100K backend job corpus remain pending.
- [ ] `page-list.context-actions` 页面上下文跳转与删除
  - 目标：Directory and archive pages expose shared, confirmable, resource-safe delete behavior and clamp navigation afterward.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/cards/pageList/PageContextMenu.svelte`
  - 测试：待补
  - 备注：No React page context menu exists.
- [x] `page-list.ordering` 保持原始 page.index 页面顺序
  - 目标：The Card exposes no local sorting control and preserves the book page catalog's original page.index order across list, detail, thumbnail and filtered result views; reading direction affects frame composition rather than reordering this catalog.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/stores/book/pageNavigation.svelte.ts`
  - 测试：`neoview.page-list.ordering`、`neoview.page-list.thumbnail-e2e`
  - 备注：The sparse catalog keeps result position separate from original page identity, and all three views consume that same ordered map without a local sorting control.
- [x] `page-list.thumbnail-sizing` 保持固定 thumbnail profile 与 48x64 / 3:4 几何
  - 目标：The Card exposes no thumbnail-size control, retains the legacy 256px request/key contract or records an explicit replacement profile, renders detail thumbnails at 48x64 with contain fit, and preserves a three-column 3:4 contain-fit thumbnail grid.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/stores/unifiedThumbnailStore.svelte.ts`
  - 测试：`neoview.page-list.shared-thumbnail`、`neoview.page-list.shared-renderer`、`neoview.page-list.thumbnail-e2e`
  - 备注：Focused tests and both Chromium viewports freeze 48x64 contain-fit details and a three-column 3:4 contain-fit grid. XR intentionally reuses the canonical 320px page profile instead of the legacy 256px key to avoid a second thumbnail cache profile.
- [ ] `page-list.data-contract` GUI/CLI/TUI 共用稀疏页面目录
  - 目标：All surfaces share bounded page identity, original index order, name, media kind and thumbnail availability without materializing page content.
  - 源码：`src/lib/core/virtualPageList.ts`、`src/lib/stores/book/pageNavigation.svelte.ts`
  - 测试：`neoview.page-list.catalog`、`neoview.page-list.sparse-100k`、`neoview.page-list.sparse-active`、`neoview.page-list.sparse-protected`、`neoview.page-list.ordering`、`neoview.cli.pages`、`neoview.tui.navigation`
  - 备注：GUI uses a bounded eight-batch sparse catalog around the active page while preserving original identity; shared context and prewarm commands remain incomplete.
- [ ] `page-list.states` 加载、空、错误、重试与预热状态
  - 目标：Catalog and optional thumbnail/prewarm failures degrade independently with stable loading, empty and retry states.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`
  - 测试：`neoview.page-list.retry`、`neoview.page-list.empty`、`neoview.page-list.prewarm`、`neoview.page-list.prewarm-e2e`
  - 备注：Empty books now settle to the empty state, catalog retry is bounded, and prewarm exposes running/complete/error feedback without hiding rows. Per-thumbnail retry and non-initial batch error isolation remain pending.
- [ ] `page-list.lifecycle` 取消目录与缩略图并忽略迟到结果
  - 目标：Search, mode, session, collapse and unmount changes cancel obsolete catalog/thumbnail work and release owners.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/utils/thumbnail/VisibleThumbnailLoader.ts`
  - 测试：`neoview.page-list.search`、`neoview.page-list.prewarm-lifecycle`
  - 备注：Catalog generations and background prewarm abort on replacement/unmount, while Slider navigation generations cannot continue into a replacement session. Explicit visible-thumbnail owner and collapsed request-count proof remain pending.
- [ ] `page-list.shell` 保持页面列表 Card shell
  - 目标：Page List remains independently lazy, non-hideable, collapsible, movable, resizable and window-capable.
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.shell.registry-lazy`、`neoview.page-list.chunk`
  - 备注：The independent PageNavigationCard chunk is frozen below 16 KiB by page-list.chunk. Shell parity remains partial until full-height, hidden-header, Card Window and all shared layout states have focused evidence.
- [ ] `page-list.accessibility` 命名视图、页面与上下文动作
  - 目标：Mode toggles, page rows, Slider, numeric jump and context actions have accessible names and full keyboard operation.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/cards/pageList/PageContextMenu.svelte`
  - 测试：`neoview.page-list.virtual`、`neoview.page-list.keyboard`、`neoview.page-list.thumbnail-e2e`
  - 备注：Named listbox/option semantics, roving focus, Arrow/Home/End/PageUp/PageDown/Enter/Escape and Ctrl/Cmd+F are covered; the missing context menu keeps the item partial.
- [x] `page-list.ui-parity` 保持缩略图比例、密度与当前页状态
  - 目标：Legacy contain-fit thumbnails, exact 48x64 detail geometry, 3:4 grid tiles, page badges, current-page emphasis and responsive three-column geometry remain readable at desktop and 420x360.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/cards/pageList/PageIndexBadge.svelte`
  - 测试：`neoview.page-list.shared-thumbnail`、`neoview.page-list.shared-renderer`、`neoview.page-list.thumbnail-e2e`
  - 备注：Desktop and 420x360 Chromium measure the exact 48x64 detail box and 3:4 three-column grid while proving page badges, current state and zero horizontal overflow.
- [ ] `page-list.performance` 稀疏分页、可见缩略图与独立 chunk
  - 目标：10K/100K books retain bounded DOM and requests, list mode performs zero thumbnail work, and the Card remains a deferred chunk.
  - 源码：`src/lib/core/virtualPageList.ts`、`src/lib/utils/thumbnail/VisibleThumbnailLoader.ts`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.page-list.virtual`、`neoview.page-list.thumbnail-mode`、`neoview.page-list.sparse-100k`、`neoview.page-list.sparse-active`、`neoview.page-list.sparse-protected`、`neoview.page-list.prewarm`、`neoview.page-list.prewarm-e2e`、`neoview.page-list.thumbnail-e2e`、`neoview.page-list.chunk`
  - 备注：A 100K catalog retains at most eight batches and list requests disable implicit prewarm. The Page Card remains a 13,714-byte deferred chunk; its 2,793-byte toolbar and 360-byte prewarm loop are second/third-level deferred chunks. A dedicated 100K Chromium scroll corpus remains pending.
- [ ] `page-list.upscale` 共享页面超分与条件状态
  - 目标：The Card consumes one shared upscale snapshot for pending, processing, completed, skipped and failed states without starting another sampler.
  - 源码：`src/lib/cards/pageList/PageIndexBadge.svelte`、`src/lib/cards/pageList/PageListCard.svelte`
  - 测试：待补
  - 备注：No React upscale snapshot is currently exposed.
- [ ] `page-list.file-actions` 平台安全的页面文件动作
  - 目标：Copy, reveal, system-open and directory/archive deletion run through authenticated application commands and atomically update the session catalog.
  - 源码：`src/lib/cards/pageList/PageContextMenu.svelte`、`src/lib/cards/pageList/PageListCard.svelte`
  - 测试：待补
  - 备注：Must not expose Tauri invokes or raw archive mutations in React.
- [ ] `page-list.settings` 持久化跟随与页面列表视图
  - 目标：Follow state and page-list-specific view preferences persist through canonical [nodes.neoview] settings.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`
  - 测试：待补
  - 备注：Current React state resets per mount.
- [x] `page-list.chunk` 独立延迟 Page List chunk
  - 目标：PageNavigationCard and its shared thumbnail primitive stay deferred and outside Reader entry/sidebar base chunks.
  - 源码：`src/lib/cards/registry.ts`、`src/lib/cards/CardRenderer.svelte`
  - 测试：`neoview.page-list.chunk`、`neoview.shared-thumbnail.chunk`
  - 备注：Production audit requires independent deferred PageNavigationCard and ReaderThumbnailSurface chunks with 16 KiB and 4 KiB budgets.
- [ ] `page-list.image-stability` 列表交互不重挂活动媒体
  - 目标：Mode switches, scrolling, search and thumbnail loading preserve the active Reader media node and asset URL.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`
  - 测试：`neoview.page-list.thumbnail-e2e`、`neoview.page-list.prewarm-e2e`
  - 备注：Desktop and 420x360 Chromium prove complete-catalog prewarm and visible thumbnail decoding preserve the active image node, exact asset URL and request count; scrolling and search identity checks remain pending.
- [x] `page-list.deviations` 记录 HTTP catalog 与共享 React 缩略图扩展
  - 目标：Document sparse authenticated HTTP catalog and shared thumbnail primitives as XR implementations without removing legacy modes or actions.
  - 源码：`src/lib/cards/pageList/PageListCard.svelte`、`src/lib/core/virtualPageList.ts`
  - 测试：`neoview.page-list.sparse-100k`、`neoview.page-list.shared-renderer`、`neoview.page-list.thumbnail-e2e`
  - 备注：XR replaces the legacy in-process virtual list with an authenticated bounded sparse HTTP catalog, adds roving keyboard focus, and reuses the canonical 320px thumbnail profile while preserving all three legacy renderers and display geometry.

### Panel: `folder`（1）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `folderMain` | 文件夹 | core | partial | `src/lib/cards/folder/FolderMainCard.svelte` | 文件与文件夹浏览、标签页和树导航；XR `folder-main` |

#### `folderMain` 文件夹

- 细项清单：`migration/neoview/folder-main-compatibility.json`
- [ ] 74 条独立源码级验收项覆盖架构、导航、标签、六种目标 renderer/四种旧视图、预览、八字段排序、搜索、文件树、文件操作、EMM、穿透、迁移、UI、设置和性能
- [ ] 排序完整支持 name/date/size/type/random/rating/path/collectTagCount、升降序、目录优先例外、稳定兜底、四级优先级和目录记忆
- [ ] 10K/100K 稀疏分页、虚拟化、历史恢复、选中定位、1/4/9/16 预览及 Card 关闭回收均为硬门禁
- UI 基线：`src/lib/cards/folder/FolderMainCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

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

#### `aiTags` AI 标签推断

- [ ] 从当前书籍元数据/内容推断 AI 标签
- [ ] 配置模型、提示和候选数量
- [ ] 审阅、选择、写入 EMM/manual 标签并处理失败
- UI 基线：`src/lib/cards/properties/AiTagsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `aiApiConfig` AI API 配置

- [ ] 配置 AI API 类型、地址、模型和鉴权
- [ ] 测试连接并发现可用模型
- [ ] 保存、重置并隐藏敏感字段
- UI 基线：`src/lib/cards/properties/AiApiConfigCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `aiTitleTranslation` 标题翻译

- [ ] 显示原标题、缓存译名和翻译状态
- [ ] 触发、重试、复制或应用译名
- [ ] 处理流式结果、取消和语言设置
- UI 基线：`src/lib/cards/ai/AiTitleTranslationCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `aiServiceConfig` 翻译服务配置

- [ ] 管理翻译服务/provider、模型、语言与提示词
- [ ] 配置并发、超时、重试、流式和降级链
- [ ] 连接测试、模型发现、导入导出与重置
- UI 基线：`src/lib/cards/ai/AiServiceConfigCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `aiTranslationCache` 翻译缓存

- [ ] 查看翻译缓存数量、大小、命中和条目
- [ ] 搜索、删除当前项/过期项/全部
- [ ] 配置 TTL/预算并导入导出
- UI 基线：`src/lib/cards/ai/AiTranslationCacheCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `aiTranslationTest` 翻译测试

- [ ] 输入测试文本并选择服务/语言
- [ ] 运行可取消的流式或非流式翻译
- [ ] 显示阶段、耗时、token、结果和错误
- UI 基线：`src/lib/cards/ai/AiTranslationTestCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `translationOverlay` 翻译叠加层

- [ ] 在阅读画面叠加标题/文本翻译
- [ ] 配置位置、样式、透明度、字体和自动隐藏
- [ ] 切换原文/译文并处理加载、错误和多页更新
- UI 基线：`src/lib/cards/ai/TranslationOverlayCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `voiceControl` 语音控制

- [ ] 启用语音识别并开始/停止监听
- [ ] 配置语言、连续监听、反馈和置信阈值
- [ ] 查看/编辑/重置命令短语、历史和识别统计
- UI 基线：`src/lib/cards/ai/VoiceControlCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

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
| `settingsBindings` | 操作绑定 | deferred | partial | `src/lib/cards/settings/BindingsSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一；XR `input-bindings-settings` |
| `settingsData` | 数据设置 | deferred | pending | `src/lib/cards/settings/DataSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一 |

#### `settingsGeneral` 通用设置

- [ ] 承载旧通用设置分组的全部字段、说明和重置
- [ ] 搜索/定位设置并显示默认与当前值
- [ ] 写入唯一 TOML 规范版本并导入旧设置
- UI 基线：`src/lib/cards/settings/GeneralSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `settingsSystem` 系统设置

- [ ] 承载窗口、启动、托盘和系统集成设置
- [ ] 显示平台能力与不可用状态
- [ ] 保存、重置和应用需重启设置
- UI 基线：`src/lib/cards/settings/SystemSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `settingsView` 视图设置

- [ ] 承载阅读布局、缩放、方向和导航视图设置
- [ ] 实时预览并区分全局/书籍覆盖
- [ ] 保存、重置和导入旧值
- UI 基线：`src/lib/cards/settings/ViewSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `settingsImage` 影像设置

- [ ] 承载解码、质量、颜色、裁边和图像效果设置
- [ ] 按格式/能力显示条件选项
- [ ] 保存、重置并避免多版本运行链
- UI 基线：`src/lib/cards/settings/ImageSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `settingsBook` 书籍设置

- [ ] 承载书籍识别、排序、打开和进度行为设置
- [ ] 区分全局默认与当前书籍覆盖
- [ ] 保存、重置和旧配置迁移
- UI 基线：`src/lib/cards/settings/BookSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `settingsPerformance` 性能设置

- [ ] 配置预读、并发、内存/磁盘缓存和 Worker 预算
- [ ] 显示估算影响、当前使用和安全范围
- [ ] 应用、重置并与全局 ResourceScheduler 统一
- UI 基线：`src/lib/cards/settings/PerformanceSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `settingsTheme` 外观设置

- [ ] 配置主题、颜色、字体、背景和透明效果
- [ ] 实时预览亮/暗/跟随系统
- [ ] 保存、重置和导入旧主题
- UI 基线：`src/lib/cards/settings/ThemeSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `settingsNotification` 通知设置

- [ ] 配置 Toast/系统通知类别、位置和持续时间
- [ ] 控制声音、重复合并和安静模式
- [ ] 测试、保存和重置
- UI 基线：`src/lib/cards/settings/NotificationSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `settingsPanels` 边栏管理

- [ ] 管理四边 Panel 的显隐、顺序、位置、pin 和几何
- [ ] 预览布局并恢复默认
- [ ] 一次批量写入且不影响阅读热路径
- UI 基线：`src/lib/cards/settings/PanelManagementCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `settingsCards` 卡片管理

- [ ] 管理 77 张 Card 的显隐、Panel、顺序和折叠
- [ ] 拖动到隐藏/未停靠或任意 Panel
- [ ] 保存/重置布局并支持设置 Card 停靠
- UI 基线：`src/lib/cards/settings/CardManagementCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `settingsBindings` 操作绑定

- 细项清单：`migration/neoview/input-bindings-compatibility.json`
- [ ] 查看和编辑键盘、鼠标、触摸等操作绑定
- [ ] 搜索、冲突检测、禁用和恢复默认
- [ ] 导入导出并提供无障碍等价操作
- UI 基线：`src/lib/cards/settings/BindingsSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

##### 专用逐控件库存（9 组，82 项）

- `bindings-ui.shell` 设置 Card 与统一面板
  - 源码：`src/lib/cards/settings/BindingsSettingsCard.svelte`、`src/lib/components/dialogs/UnifiedBindingPanel.svelte`
  - 映射：`bindings.shell`、`bindings.states`、`bindings.ui-parity`
  - [ ] 操作绑定标题
  - [ ] 统一面板
  - [ ] 搜索
  - [ ] 类别/上下文筛选
  - [ ] 恢复默认
  - [ ] 保存反馈
  - [ ] 空结果
- `bindings-ui.keyboard` 键盘绑定与录制
  - 源码：`src/lib/components/dialogs/KeyBindingPanel.svelte`、`src/lib/stores/keybindings/core.svelte.ts`、`src/lib/stores/keybindings/keyHandlers.svelte.ts`
  - 映射：`bindings.keyboard`、`bindings.recording`、`bindings.accessibility`、`bindings.context-routing`
  - [ ] 键盘标签
  - [ ] 组合键
  - [ ] 修饰键
  - [ ] 录制开始/取消/完成
  - [ ] 禁用
  - [ ] 删除
  - [ ] 恢复默认
  - [ ] IME 与输入框隔离
- `bindings-ui.mouse` 鼠标按键、滚轮与区域
  - 源码：`src/lib/components/dialogs/MouseSettingsPanel.svelte`、`src/lib/components/dialogs/MouseKeyRecorder.svelte`、`src/lib/components/dialogs/MouseRecordingArea.svelte`
  - 映射：`bindings.mouse`、`bindings.wheel`、`bindings.area-click`、`bindings.recording`
  - [ ] 左/中/右/侧键
  - [ ] 单击/双击/按住
  - [ ] 滚轮上下
  - [ ] 修饰键
  - [ ] 九宫格区域
  - [ ] 录制
  - [ ] 启停
  - [ ] 删除
  - [ ] 恢复默认
- `bindings-ui.gesture` 鼠标与触控手势
  - 源码：`src/lib/components/dialogs/GestureSettingsPanel.svelte`、`src/lib/components/dialogs/GestureVisualizer.svelte`、`src/lib/components/dialogs/MouseGestureRecorder.svelte`、`src/lib/stackview/layers/GestureLayer.svelte`
  - 映射：`bindings.touch`、`bindings.mouse-gesture`、`bindings.recording`、`bindings.lifecycle`
  - [ ] 手势启停
  - [ ] 方向序列
  - [ ] 触控滑动
  - [ ] 鼠标轨迹
  - [ ] 画布预览
  - [ ] 最小距离
  - [ ] 录制取消/完成
  - [ ] 冲突
  - [ ] 释放 pointer capture
- `bindings-ui.context` 动作与上下文优先级
  - 源码：`src/lib/stores/keybindings/constants.ts`、`src/lib/stores/keybindings/core.svelte.ts`、`src/lib/stores/keybindings/keyMappings.svelte.ts`
  - 映射：`bindings.actions`、`bindings.context-routing`、`bindings.conflicts`、`bindings.data-contract`
  - [ ] 动作 registry
  - [ ] BindingContext
  - [ ] CONTEXT_PRIORITY
  - [ ] 同输入按活动上下文解析
  - [ ] global fallback
  - [ ] 面板/阅读器/编辑器/对话框模式
  - [ ] 同上下文冲突
- `bindings-ui.radial` 径向菜单
  - 源码：`src/lib/components/dialogs/RadialMenuSettingsPanel.svelte`、`src/lib/components/radial/RadialInputLayer.svelte`、`src/lib/components/radial/RadialMenuOverlay.svelte`、`src/lib/stores/radialMenu/core.svelte.ts`
  - 映射：`bindings.radial-menu`、`bindings.lifecycle`、`bindings.accessibility`
  - [ ] 菜单组
  - [ ] 槽位
  - [ ] 动作选择
  - [ ] 排序
  - [ ] 触发输入
  - [ ] 按住/切换模式
  - [ ] 扇区命中
  - [ ] 恢复默认
  - [ ] 关闭释放
- `bindings-ui.persistence` 旧设置与规范持久化
  - 源码：`src/lib/stores/keybindings/core.svelte.ts`、`src/lib/stores/radialMenu/core.svelte.ts`、`src/lib/cards/settings/BindingsSettingsCard.svelte`
  - 映射：`bindings.persistence`、`bindings.legacy-import`、`bindings.data-contract`、`bindings.deviations`
  - [ ] 旧 dynamic storage key
  - [ ] appSettings.keybindings
  - [ ] appSettings.radialMenus
  - [ ] bindings.keybindings
  - [ ] bindings.radial_menus
  - [ ] 一次导入
  - [ ] canonical TOML
  - [ ] 不得双写 localStorage
  - [ ] 严格校验
  - [ ] 原子保存
  - [ ] 恢复默认
- `bindings-ui.gamepad` XR 标准手柄扩展
  - 源码：`src/lib/stores/keybindings/types.ts`、`src/lib/components/dialogs/UnifiedBindingPanel.svelte`
  - 映射：`bindings.gamepad`、`bindings.deviations`、`bindings.performance`
  - [ ] 旧版无手柄控件
  - [ ] 标准 Gamepad 按钮
  - [ ] 连接/断开
  - [ ] 只在存在绑定时轮询
  - [ ] 页面不可见暂停
  - [ ] 录制
  - [ ] 可禁用
  - [ ] 与其他设备共享动作/上下文
- `bindings-ui.states` 状态、无障碍与响应式
  - 源码：`src/lib/components/dialogs/UnifiedBindingPanel.svelte`、`src/lib/components/dialogs/KeyBindingPanel.svelte`
  - 映射：`bindings.states`、`bindings.accessibility`、`bindings.ui-parity`
  - [ ] 默认
  - [ ] hover
  - [ ] focus
  - [ ] enabled
  - [ ] disabled
  - [ ] recording
  - [ ] conflict
  - [ ] saving
  - [ ] success
  - [ ] error
  - [ ] empty
  - [ ] 键盘等价操作
  - [ ] 可访问名称
  - [ ] 桌面/420x360 无溢出

##### 专用源码级验收项

- [ ] `bindings.actions` 共享动作 registry
  - 目标：All devices target stable action IDs; the initial Reader set covers previous/next, zoom in/out/reset, clockwise rotation and opening settings without embedding callbacks in persisted data.
  - 源码：`src/lib/actions/actionRegistry.ts`、`src/lib/stores/keybindings/keyMappings.svelte.ts`
  - 测试：`neoview.bindings.context-routing`、`neoview.bindings.config`
  - 备注：Seven Reader actions use stable IDs. The full legacy action registry and explicit CLI/TUI dispatch commands remain pending.
- [ ] `bindings.context-routing` 按活动操作上下文解析绑定
  - 目标：Global, reader, panel, editor and modal contexts have deterministic priority; editable/IME targets suppress Reader actions and the same input may map differently across contexts.
  - 源码：`src/lib/stores/keybindings/constants.ts`、`src/lib/stores/keybindings/core.svelte.ts`、`src/lib/stores/keybindings/keyHandlers.svelte.ts`
  - 测试：`neoview.bindings.context-routing`、`neoview.bindings.dom-context`
  - 备注：The browser route derives editor/modal/panel/reader mode and falls back to global. CLI/TUI context-stack projection remains pending.
- [ ] `bindings.keyboard` 键盘与修饰键绑定
  - 目标：Dynamic keyboard bindings use a maintained hotkey engine, preserve physical codes/modifiers, ignore repeat/composition and remain disabled in incompatible contexts.
  - 源码：`src/lib/components/dialogs/KeyBindingPanel.svelte`、`src/lib/stores/keybindings/keyHandlers.svelte.ts`
  - 测试：`neoview.bindings.devices`、`neoview.bindings.editor`
  - 备注：react-hotkeys-hook owns the global listener and dynamic key set. Interactive recording and full modifier editor remain pending.
- [ ] `bindings.mouse` 鼠标按键绑定
  - 目标：Left/middle/right/side buttons and single/double variants resolve through the same action/context route without stealing unbound pointer input.
  - 源码：`src/lib/components/dialogs/MouseSettingsPanel.svelte`、`src/lib/components/dialogs/MouseKeyRecorder.svelte`
  - 测试：`neoview.bindings.devices`、`neoview.bindings.editor`
  - 备注：Buttons 0..7 and single/double descriptors are editable and routed. Press/hold and recorder feedback remain pending.
- [ ] `bindings.wheel` 滚轮方向绑定
  - 目标：Up/down wheel gestures and modifiers use the maintained gesture engine and prevent default only when a binding handles the event.
  - 源码：`src/lib/components/dialogs/MouseSettingsPanel.svelte`、`src/lib/components/dialogs/MouseKeyRecorder.svelte`
  - 测试：`neoview.bindings.devices`、`neoview.bindings.editor`
  - 备注：@use-gesture/react owns wheel recognition; modifier editing and browser E2E remain pending.
- [ ] `bindings.area-click` 九宫格区域点击
  - 目标：Configurable viewport areas resolve clicks without coupling bindings to pixel coordinates.
  - 源码：`src/lib/components/dialogs/MouseRecordingArea.svelte`、`src/lib/stores/keybindings/keyHandlers.svelte.ts`
  - 测试：待补
  - 备注：Not included in the first route.
- [ ] `bindings.touch` 触控滑动绑定
  - 目标：One-to-three-finger directional swipes use the maintained gesture engine, respect active context and release all pointer work on unmount.
  - 源码：`src/lib/components/dialogs/GestureSettingsPanel.svelte`、`src/lib/components/dialogs/GestureVisualizer.svelte`
  - 测试：`neoview.bindings.devices`、`neoview.bindings.editor`
  - 备注：Directional swipe descriptors and runtime routing use @use-gesture/react; multi-finger recording and real touch E2E remain pending.
- [ ] `bindings.mouse-gesture` 鼠标轨迹手势
  - 目标：Recorded direction sequences match with a bounded gesture engine and visual preview.
  - 源码：`src/lib/components/dialogs/MouseGestureRecorder.svelte`、`src/lib/stackview/layers/GestureLayer.svelte`
  - 测试：待补
  - 备注：Not included in the first route.
- [ ] `bindings.gamepad` 标准手柄按钮绑定
  - 目标：XR adds standard Gamepad buttons through a maintained listener, starts polling only when an enabled gamepad binding exists and routes through the same action/context map.
  - 源码：`src/lib/stores/keybindings/types.ts`
  - 测试：`neoview.bindings.devices`、`neoview.bindings.editor`
  - 备注：gamepad.js owns connection and button events; visual recording, connection state and Chromium gamepad injection remain pending. This is an XR extension, not legacy parity.
- [ ] `bindings.radial-menu` 径向菜单配置与运行时
  - 目标：Menu definitions, slots, trigger binding, hold/toggle mode and hit testing share the action registry and canonical persistence.
  - 源码：`src/lib/components/dialogs/RadialMenuSettingsPanel.svelte`、`src/lib/components/radial/RadialInputLayer.svelte`、`src/lib/stores/radialMenu/core.svelte.ts`
  - 测试：待补
  - 备注：Legacy opaque data remains importable but no XR editor/runtime exists yet.
- [x] `bindings.conflicts` 冲突检测、禁用与删除
  - 目标：Enabled bindings with the same normalized input in one context are blocked; disabled collisions remain editable and every row can be enabled, disabled or deleted.
  - 源码：`src/lib/components/dialogs/UnifiedBindingPanel.svelte`、`src/lib/stores/keybindings/core.svelte.ts`
  - 测试：`neoview.bindings.conflicts`、`neoview.bindings.validation`、`neoview.bindings.conflict-ui`
  - 备注：Pure domain, backend validation and GUI share the same normalized conflict key.
- [ ] `bindings.recording` 交互式输入录制
  - 目标：Keyboard, pointer, touch and gamepad recorders capture one bounded input with cancel/clear and no action leakage.
  - 源码：`src/lib/components/dialogs/KeyBindingPanel.svelte`、`src/lib/components/dialogs/MouseKeyRecorder.svelte`、`src/lib/components/dialogs/GestureVisualizer.svelte`
  - 测试：待补
  - 备注：The first Card exposes explicit descriptor editors; framework-backed recorders remain pending.
- [x] `bindings.data-contract` 严格有界多设备 DTO
  - 目标：A versioned bounded DTO accepts only known actions, contexts and device descriptors, rejects executable fields, duplicate IDs and ambiguous enabled bindings.
  - 源码：`src/lib/stores/keybindings/types.ts`、`src/lib/stores/keybindings/core.svelte.ts`
  - 测试：`neoview.bindings.config`、`neoview.bindings.validation`、`neoview.bindings.devices`
  - 备注：The canonical DTO is browser-safe, capped at 256 entries and shared by runtime config and HTTP.
- [ ] `bindings.persistence` 写入唯一 TOML 规范
  - 目标：Runtime writes only [nodes.neoview.bindings].items through the atomic config store and restores defaults with one command.
  - 源码：`src/lib/stores/keybindings/core.svelte.ts`、`src/lib/stores/radialMenu/core.svelte.ts`
  - 测试：`neoview.bindings.config`、`neoview.bindings.reset`、`neoview.bindings.reset-ui`
  - 备注：GUI HTTP persists canonical items atomically. Explicit CLI/TUI edit commands and a real TOML roundtrip test remain pending.
- [ ] `bindings.legacy-import` 一次性导入旧绑定与径向菜单
  - 目标：Legacy appSettings.keybindings/radialMenus and bindings.keybindings/radial_menus import once with a report and never remain a second runtime store.
  - 源码：`src/lib/stores/keybindings/core.svelte.ts`、`src/lib/stores/radialMenu/core.svelte.ts`、`src/lib/cards/settings/BindingsSettingsCard.svelte`
  - 测试：`neoview.settings.codec`、`neoview.bindings.reset`
  - 备注：LegacySettingsCodec preserves the opaque source and canonical reads tolerate it; action-level conversion/reporting remains pending.
- [ ] `bindings.states` 搜索、空、冲突、保存与错误状态
  - 目标：The editor exposes search/filter, empty, enabled/disabled, conflict, saving, success, failure and reset states without replacing the confirmed runtime configuration on failure.
  - 源码：`src/lib/components/dialogs/UnifiedBindingPanel.svelte`
  - 测试：`neoview.bindings.editor`、`neoview.bindings.conflict-ui`、`neoview.bindings.reset-ui`、`neoview.bindings.e2e`
  - 备注：Core states and real PATCH success are covered in Chromium; interactive recording states and failed HTTP rollback E2E remain pending.
- [ ] `bindings.accessibility` 输入保护与无障碍等价操作
  - 目标：Every row/control is named and keyboard operable; editor, IME and recording contexts suppress Reader actions; touch/mouse-only operations have accessible equivalents.
  - 源码：`src/lib/components/dialogs/UnifiedBindingPanel.svelte`、`src/lib/components/dialogs/KeyBindingPanel.svelte`
  - 测试：`neoview.bindings.dom-context`、`neoview.bindings.editor`
  - 备注：Native controls and DOM context suppression are covered; focus restoration, recorder capture and screen-reader E2E remain pending.
- [ ] `bindings.lifecycle` 按需监听并完整释放
  - 目标：One keyboard listener and one gesture route are stable; gamepad polling exists only with enabled bindings and all listener/gesture/recording work stops on unmount or hidden document.
  - 源码：`src/lib/stores/keybindings/core.svelte.ts`、`src/lib/stackview/layers/GestureLayer.svelte`、`src/lib/components/radial/RadialInputLayer.svelte`
  - 测试：`neoview.bindings.dom-context`
  - 备注：Framework adapters clean up on unmount and gamepad is conditionally loaded; focused listener-count and visibility E2E remain pending.
- [x] `bindings.shell` 延迟设置 Card 与旧层级
  - 目标：Operations Binding remains a deferred Settings Card with the legacy search/filter/list hierarchy and no Reader-entry editor code.
  - 源码：`src/lib/cards/settings/BindingsSettingsCard.svelte`、`src/lib/components/dialogs/UnifiedBindingPanel.svelte`、`src/lib/cards/registry.ts`
  - 测试：`neoview.settings.window`、`neoview.bindings.editor`、`neoview.bindings.e2e`、`neoview.bindings.chunk`
  - 备注：The Card is registered under Settings > Operations Binding, preserves the search/filter/list hierarchy and ships as a 7.6 KiB second-level deferred production chunk.
- [x] `bindings.ui-parity` 保持紧凑绑定表与响应式布局
  - 目标：Search, context filter, action/context/device editors, enable switch, conflict state and commands remain scan-friendly at desktop and 420x360.
  - 源码：`src/lib/components/dialogs/UnifiedBindingPanel.svelte`
  - 测试：`neoview.bindings.editor`、`neoview.bindings.conflict-ui`、`neoview.bindings.e2e`
  - 备注：Desktop and 420x360 Chromium cover editing, saving, immediate runtime replacement and zero horizontal overflow with captured screenshots.
- [ ] `bindings.performance` 稳定监听、条件手柄轮询与独立 chunk
  - 目标：Runtime adapters do not rerender Reader on raw input, settings editor is deferred, gamepad polling is conditional and explicit chunk/listener latency budgets pass.
  - 源码：`src/lib/cards/settings/BindingsSettingsCard.svelte`、`src/lib/stores/keybindings/core.svelte.ts`
  - 测试：`neoview.bindings.chunk`
  - 备注：Ref-backed adapters avoid raw-input state updates; the 7.6 KiB editor, 29.1 KiB gesture runtime and 10.4 KiB conditional gamepad runtime are independent production chunks. Listener-count and input-dispatch latency benchmarks remain pending.
- [x] `bindings.deviations` 记录框架替代与手柄扩展
  - 目标：Document react-hotkeys-hook, @use-gesture/react and gamepad.js as maintained replacements for legacy custom listeners, and gamepad as an XR extension without removing legacy devices.
  - 源码：`src/lib/stores/keybindings/types.ts`、`src/lib/components/dialogs/UnifiedBindingPanel.svelte`
  - 测试：`neoview.bindings.devices`、`neoview.bindings.dom-context`
  - 备注：The runtime delegates recognition to mature libraries; project code owns only action/context DTOs, persistence and conflict keys.

#### `settingsData` 数据设置

- [ ] 管理设置/阅读数据的导入、导出、备份和恢复
- [ ] 显示数据库路径、大小、迁移和清理入口
- [ ] 预览变更、原子提交、回滚并遵守 NeoView 数据库边界
- UI 基线：`src/lib/cards/settings/DataSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

## 每张 Card 的专用清单模板

每张 Card 的专用 JSON 至少包含以下 10 类，不能以这份模板本身代替源码逐项清单：

1. `source-ui-inventory`：逐个控件、菜单项、选项值、字段、快捷键和状态，含源码证据及验收项映射。
2. `capabilities`：全部命令、模式、数据字段、批量动作和跨模块联动。
3. `ui-parity`：层级、控件、图标、文字、密度、尺寸和响应式几何。
4. `interaction-states`：默认、hover、focus、selected、disabled、loading、empty、partial、error、retry、disposed。
5. `settings`：默认值、旧键、优先级、TOML 目标字段、重置和导入。
6. `keyboard-accessibility`：快捷键、焦点顺序、语义角色、IME 排除和可访问名称。
7. `data-contract`：DTO、稳定身份、分页/流、取消、generation、错误和过期结果。
8. `lifecycle`：lazy load、open、suspend、resume、close、dispose 和失败清理。
9. `performance`：代表性语料、延迟、内存、DOM、任务和缓存预算。
10. `tests`：稳定测试 ID、交互、截图/几何和性能回归。
11. `deviations`：删减、替换或有意改变的旧行为及理由。
