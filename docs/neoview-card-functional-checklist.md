# NeoView Card 完整功能与 UI 验收清单

> 本文件由 `bun run generate:neoview-card-checklist` 生成。机器事实源为 `migration/neoview/time-information-compatibility.json`、`migration/neoview/folder-main-compatibility.json`、`migration/neoview/card-functional-scopes.json`、`migration/neoview/card-compatibility.json`，请勿只改本文件。

## 完成规则

- 所有 Card 都执行“先冻结源码清单，再实现，再验收”；只有标题或后端 API 不算完成。
- `complete/migrated` 必须覆盖功能、UI 层级、控件与图标、交互状态、持久化、键盘/无障碍、共享 GUI/CLI/TUI 契约、生命周期、性能、测试和有意偏离。
- UI 默认保持旧版信息层级、密度和操作位置；只允许使用 XR 设计 token 和既有通用组件做等价适配。桌面侧栏、窄侧栏和独立 Card 窗口都要有截图或几何证据。
- `pending/partial` 是真实状态，不得为了提高数字提前改成完成；旧版自身缺失的能力必须标为 `registry-only` 或记录替代决策。
- Windows 重验证严格串行，Vitest 固定 `--maxWorkers=1`，防止清单验证本身触发内存耗尽。

## 文件浏览器 `folderMain`

共 74 项：`partial=44`，`pending=30`。以下是完整验收项，不是自然排序或单列表的缩减版。

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
- [ ] `folder.arch.watch` 文件树增量监听
  - 目标：按需动态加载 @parcel/watcher，仅监听活动根；事件合并后增量修补 generation，最后消费者关闭即 unsubscribe。
  - 源码：`utils/directoryTreeCache.ts`、`components/FolderTree.svelte`
  - 测试：`neoview.file-tree.watcher`、`neoview.file-tree.watcher-native`、`neoview.folder.file-tree-service`、`neoview.folder.watch-http`、`neoview.folder.watch-cancellation`
  - 备注：watch:true 显式 session 已接入目录快照失效、单飞重读、generation 递增、导航换根和关闭 unsubscribe；前端默认 opt-in、事件推送/轮询和增量行补丁仍待完成。
- [ ] `folder.arch.dispose` 取消、释放与休眠
  - 目标：折叠、切目录、关闭标签和卸载 Card 时取消过期分页/扫描/缩略图，释放 watcher、thumbnail context、browser session 和 Worker。
  - 源码：`components/FolderStack.svelte`、`utils/directoryTreeCache.ts`
  - 测试：`neoview.folder.file-tree-service`、`neoview.folder.watch-http`、`neoview.folder.watch-cancellation`
  - 备注：ReaderFileTreeService 已在 DELETE、导航换根、session 淘汰和 dispose 释放 watcher；Card 分页与缩略图 context 已释放，完整树/搜索/Worker 休眠仍待完成。

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

- [ ] `folder.select.basic` 单选、Ctrl/Meta toggle 与焦点项
  - 目标：单击单选，Ctrl/Meta 切换，focused item 与 selected set 分离，虚拟化卸载不丢身份。
  - 源码：`stores/folderPanelStore/selectionState.svelte.ts`、`components/FolderListItem.svelte`
  - 测试：`neoview.folder.selection-basic`
  - 备注：当前基础单选和 Ctrl/Meta 已有。
- [ ] `folder.select.range` Shift 范围与链式选择
  - 目标：Shift 以稳定 anchor index 范围选择；链式选择按标签隔离，跨未加载分页也正确。
  - 源码：`stores/chainSelectStore.svelte.ts`、`components/FolderStack/FolderSelectionHandler.ts`
  - 测试：`neoview.folder.selection-range-sparse`、`neoview.folder.selection-range-ui`、`neoview.folder.selection-chain`、`neoview.folder.selection-chain-mode`、`neoview.folder.selection-chain-ui`
  - 备注：当前使用索引区间 + 少量显式路径表达 Shift/Ctrl+Shift 选择；100K 范围不物化路径，list/grid/details 共用同一 selection model。SelectionBar 已支持独立链选开关和逐次推进 anchor；真正多标签隔离仍待标签宿主迁移。
- [ ] `folder.select.bulk` 全选、反选、取消与选择栏
  - 目标：全选/反选/取消作用于稳定 catalog，SelectionBar 显示数量与批量动作；大目录避免物化百万路径。
  - 源码：`components/SelectionBar.svelte`、`stores/folderPanelStore/selectionState.svelte.ts`
  - 测试：`neoview.folder.selection-bulk-sparse`、`neoview.folder.selection-bulk-rebase`、`neoview.folder.selection-bulk-ui`、`neoview.folder.selection-click-behavior`
  - 备注：当前使用 allSelected + 稀疏例外表达全选/反选/取消，100K 项不物化路径；选择栏显示数量并支持多选模式、点开/点选切换，排序 generation 变化后按路径保留例外。批量打开/复制/移动/删除等动作和 CLI/TUI 命令仍待迁移。
- [ ] `folder.select.restore` 导航状态恢复与自动定位
  - 目标：保存 scrollTop/snapshot、selectedItemPath、focused path/index 和 pendingFocusPath；前进后退/标签切换后自动定位。
  - 源码：`stores/folderTabStore/navigationHistory.svelte.ts`、`components/FolderStack/FolderStackState.svelte.ts`
  - 测试：`neoview.folder.restore-snapshot`、`neoview.folder.parent-suggested-selection`
  - 备注：当前单标签快照已覆盖基础路径。

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
  - 测试：`neoview.folder.tree-lazy`、`neoview.folder.tree-http`、`neoview.folder.tree-client`、`neoview.folder.tree-card`、`neoview.folder.tree-panel`、`neoview.folder.tree-keyboard`、`neoview.folder.tree-paths`、`neoview.folder.tree-path-identity`、`neoview.folder.tree-lifecycle`、`neoview.folder.tree-navigation-race`、`neoview.folder.tree-generation`、`neoview.folder.tree-layout-e2e`、`neoview.folder.tree-pins`、`neoview.folder.tree-pins-e2e`
  - 备注：GUI 已使用二级 lazy 的固定行高 Virtuoso Tree，作为独立 companion pane 与当前目录单层 list/grid/details 同时存在；Tree 焦点和右键 focus 不进入列表 selection，只有打开目录才更新当前目录 catalog。支持当前路径祖先自动展开、完整 ARIA tree 键盘模型、节点展开/折叠、活动路径同步、加载占位、逐节点错误重试，Ctrl+F 只替换文件内容区且保留 Tree；固定目录与当前磁盘根共同作为顶层，右键菜单支持打开、固定/取消固定和目标分支刷新。请求随路径/session/root 取消，前端 pages/errors/expanded/并发请求有界并按 backend generation 重基。后端 ReaderFileTreeIndex 使用 512 项、5 分钟 TTL 的 lru-cache，规范 key 不改写 provider 路径。仍待可靠的 all-drive roots 平台 API、完整文件上下文菜单和 watcher 实时呈现，因此保持 partial。
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
  - 测试：`neoview.folder.activate-entry`、`neoview.folder.open-file-location`
  - 备注：目录导航和受支持文件 onOpen 已接入；browser session 现在接受文件或目录路径，文件路径由平台 fs.stat/realpath 打开父目录并返回稳定 suggestedSelection，Reader 打开 CBZ 后文件浏览器可自动选中当前文件。新标签打开、系统默认动作和文件夹作为书籍的完整菜单仍待完成。
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
| `bookInfo` | 书籍信息 | core | partial | `src/lib/cards/info/BookInfoCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据；XR `book-information` |
| `infoOverlay` | 信息悬浮窗 | deferred | pending | `src/lib/cards/info/InfoOverlayCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据 |
| `imageInfo` | 图像信息 | core | partial | `src/lib/cards/info/ImageInfoCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据；XR `image-information` |
| `storage` | 存储信息 | core | partial | `src/lib/cards/info/StorageCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据；XR `storage-information` |
| `time` | 时间信息 | core | migrated | `src/lib/cards/info/TimeCard.svelte` | 文件信息、图片属性、尺寸扫描和系统元数据；XR `time-information` |

#### `preloadStatus` 预加载状态

- [ ] 显示当前书籍预读队列、活跃任务和缓存命中
- [ ] 区分当前页、相邻页、缩略图等优先级
- [ ] 提供取消/清理并在会话关闭时归零
- UI 基线：`src/lib/cards/info/PreloadStatusCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `bookInfo` 书籍信息

- [ ] 显示书名、源路径、类型、页数和阅读进度
- [ ] 显示文件/归档大小与可用书籍元数据
- [ ] 复制路径或打开系统位置并处理缺失源
- UI 基线：`src/lib/cards/info/BookInfoCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `infoOverlay` 信息悬浮窗

- [ ] 配置阅读画面信息悬浮层的字段与位置
- [ ] 控制可见性、透明度和自动隐藏
- [ ] 实时预览页码、尺寸、文件名等叠加信息
- UI 基线：`src/lib/cards/info/InfoOverlayCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `imageInfo` 图像信息

- [ ] 显示当前页文件名、路径、格式、MIME 与尺寸
- [ ] 显示帧/动画/视频等媒体属性
- [ ] 显示旋转、裁剪、解码或超分后的有效信息
- UI 基线：`src/lib/cards/info/ImageInfoCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

#### `storage` 存储信息

- [ ] 显示当前书籍/页面的压缩与实际字节大小
- [ ] 显示缓存、缩略图或解码资源占用
- [ ] 对缺失或不可统计字段稳定降级
- UI 基线：`src/lib/cards/info/StorageCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

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
| `sidebarControl` | 边栏控制 | integration | pending | `src/lib/cards/info/SidebarControlCard.svelte` | 左右边栏、顶部工具栏、底栏、面板和通知 |
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

- [ ] 控制 top/right/bottom/left 边栏显示与 pin
- [ ] 切换自动隐藏、触发区和展开行为
- [ ] 恢复布局默认值且不重挂活动阅读图像
- UI 基线：`src/lib/cards/info/SidebarControlCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

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

- [ ] 查看和编辑当前书籍覆盖设置
- [ ] 区分继承值、显式覆盖和恢复全局默认
- [ ] 保存后立即应用且可回滚失败
- UI 基线：`src/lib/cards/properties/BookSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

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

- [ ] 虚拟化显示最近阅读记录与进度
- [ ] 搜索、排序、筛选、恢复阅读和定位源
- [ ] 单项/批量删除、清空、缩略图/评分与上下文操作
- UI 基线：`src/lib/cards/history/HistoryListCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

### Panel: `bookmark`（1）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `bookmarkList` | 书签列表 | core | partial | `src/lib/cards/bookmark/BookmarkListCard.svelte` | 历史、书签、阅读进度和数据洞察；XR `bookmark-list` |

#### `bookmarkList` 书签列表

- [ ] 虚拟化显示书签和自定义列表
- [ ] 搜索、排序、筛选、打开和定位源
- [ ] 创建/重命名/删除列表并单项/批量编辑书签
- UI 基线：`src/lib/cards/bookmark/BookmarkListCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

### Panel: `pageList`（1）

| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |
|---|---|---:|---:|---|---|
| `pageListMain` | 页面列表 | core | partial | `src/lib/cards/pageList/PageListCard.svelte` | 页面构建、排序、跳转与边界行为；XR `page-navigation` |

#### `pageListMain` 页面列表

- [ ] list/grid/thumb 三种虚拟化页面视图
- [ ] 搜索、当前页跟随、页码输入和 Slider 跳转
- [ ] 可见批次缩略图预热、超分状态与页面上下文删除
- UI 基线：`src/lib/cards/pageList/PageListCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

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
| `settingsBindings` | 操作绑定 | deferred | pending | `src/lib/cards/settings/BindingsSettingsCard.svelte` | 设置、完整导入导出、备份、Gist 和 TOML 统一 |
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

- [ ] 查看和编辑键盘、鼠标、触摸等操作绑定
- [ ] 搜索、冲突检测、禁用和恢复默认
- [ ] 导入导出并提供无障碍等价操作
- UI 基线：`src/lib/cards/settings/BindingsSettingsCard.svelte`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。

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
