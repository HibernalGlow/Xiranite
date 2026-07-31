# NeoView TOML 配置格式

NeoView 的规范写入格式保留根表、一级业务分区和一层相关项分组；分组内每个相关对象各占一行：

```toml
[nodes.neoview]
schema_version = 1

[nodes.neoview.reader]
reading_direction = "right-to-left"
double_page_view = true
hover_scroll_enabled = true
hover_scroll_speed = 2.0

[nodes.neoview.startup]
restore_last_book = true

[nodes.neoview.view.magnifier]
zoom = 2.0
size = 200

[nodes.neoview.view.mouse_cursor]
auto_hide = true
hide_delay = 0.8
show_movement_threshold = 26
show_on_button_click = false
show_on_key_down = false
show_on_wheel = false

[nodes.neoview.reader.subtitle]
font_size = 24
color = "#ffffff"
bg_opacity = 0.65

[nodes.neoview.panels.card_state]
page-navigation = { height = 570, expanded = true, visible = true, order = 0, panel_id = "pageList" }
book-information = { expanded = true, visible = true, order = 0, panel_id = "info", height = 122 }
folder-main = { expanded = true, height = "auto", visible = true, order = 0, panel_id = "folder" }

[nodes.neoview.bindings]
items = [
  { action = "next-page", input = { key = "ArrowRight" } },
  { action = "previous-page", input = { key = "ArrowLeft" } },
]
```

这种布局保留 `reader`、`startup`、`panels`、`folder`、`image`、`bindings`、`super_resolution` 等可扫描分区。`startup.restore_last_book` 默认 `true`，控制应用启动时是否恢复最近阅读的书籍。`card_state`、`panel_state`、`sidebars`、`edges` 等相关项集合拥有自己的二级表，但不会继续为每个 Card 或边缘生成三级表头；对象数组允许多行，每个对象一行。解析后的业务对象结构不变，GUI、CLI 与 TUI 不需要感知存储布局。

## 兼容规则

读取端同时接受以下输入：

- 当前规范：根表 + 一级业务分区 + 最多一层相关项分组；分组成员使用一行一个 inline table，对象数组一行一个对象。
- 原始旧格式：任意深度的 `[nodes.neoview.*]` 表及 `[[nodes.neoview.*]]` 对象数组。
- 上一版 envelope：`[nodes.neoview]` 下的 `config = { ... }`，以及被普通 TOML writer 展开的 `[nodes.neoview.config.*]`。
- 混合格式：直接字段先作为基线，再递归合并 `config`；冲突时 `config` 值优先，未知字段保留。

所有 `commitNeoviewConfig` 写入和共享 `saveXiraniteConfig` 写入都会生成当前规范格式，因此修改其他节点或应用设置也不会再次把 NeoView 展开成深层表。旧格式不会仅因启动而静默重写；下一次配置提交或显式迁移时才转换，并继续使用备份、跨进程锁、原子替换和回读验证。

TOML 1.0 inline table 必须保持单行，因此一个相关对象对应一个 inline table 行；不要把整个相关项集合重新压进同一个超长行。

## File Presentation 继承与覆盖

File Card、History Card 和 Bookmark Card 的文件条目展示使用同一份 File Presentation 契约。`[nodes.neoview.folder]` 是共享展示基线，History/Bookmark 只保存用户明确修改过的稀疏覆盖：

```toml
[nodes.neoview.folder]
view_mode = "cover-grid"
content_width_percent = 35
thumbnail_width_percent = 24
banner_width_percent = 50

[nodes.neoview.history_list.view_overrides]
thumbnail_width_percent = 36

[nodes.neoview.history_list.auto_cleanup]
enabled = false
trigger = "on-show"
interval_minutes = 60

[nodes.neoview.bookmark_list]
active_list_id = "all"

[nodes.neoview.bookmark_list.view_overrides]
view_mode = "mosaic-list"
```

History 自动清理使用 `auto_cleanup` 分组。`trigger = "on-show"` 仅在 History Card 呼出时扫描；`trigger = "interval"` 会在呼出时扫描，并在 Card 保持可见期间按 `interval_minutes` 重复扫描。默认关闭。扫描复用 Reader library cleanup，只删除明确判定为 `missing` 的记录；离线磁盘、权限失败等 `unknown` 状态不会删除。

当前共享字段是 `view_mode`、`content_width_percent`、`thumbnail_width_percent` 和 `banner_width_percent`。有效值按以下顺序解析：

1. 当前 Card 的 `view_overrides` 显式字段。
2. `[nodes.neoview.folder]` 的同名字段。
3. NeoView 内建默认值。

未写入的字段必须持续继承；不得在 History/Bookmark 初始化时复制一份 File 默认值。GUI 的“恢复继承”通过配置 PATCH 将对应 override 字段写为 `null`，配置事务会删除 TOML 叶子，而不是写入一个伪默认值。删除最后一个字段后允许保留空的 `view_overrides` 分组，读取结果等价于无覆盖。

`view_mode` 的共享虚拟源取值为 `compact`、`cover-list`、`mosaic-list`、`cover-grid`。File Card 的 `details` 在虚拟源中降级为 `compact`，`mosaic-grid` 降级为 `cover-grid`；这是 renderer capability 映射，不是持久化覆盖。

文件夹导航、Home 路径、目录树、删除确认、穿透策略和文件系统写操作不属于 File Presentation，不得被虚拟源盲目继承。History 的清理/恢复、Bookmark 的列表成员关系、各自搜索排序和业务动作继续由 Card 自己拥有。

文件 Card 的确认开关位于同一根表的二级分组 `[nodes.neoview.folder.confirmations]`。`trash` 和 `batch_trash` 默认关闭，分别控制单项与批量“已删除到回收站”；`permanent_delete` 和 `batch_permanent_delete` 默认开启。根字段 `confirm_delete` 不再支持。

新增共享展示字段时，必须同时进入共享类型、同一校验器、有效配置 resolver、共用 renderer/control 和跨 Card 测试；禁止在各 Card 建立字段 allowlist 或逐字段复制 props。这样旧 Card 在没有 override 时会自动获得新字段，只有 capability 不支持时才允许显式降级。

读取端继续接受旧 `[nodes.neoview.history_list].view_mode = "content|banner|thumbnail"`。旧值映射为稀疏 `viewOverrides.viewMode`；新 `view_overrides.view_mode` 与旧字段同时存在时新分组优先。下一次修改 History 视图模式时写入新分组并删除旧字段。

## 验收与测试

```powershell
bun run audit:neoview-config
bun run audit:neoview-config -- --strict
bun run audit:neoview-config -- --config C:\path\to\xiranite.config.toml
bun run migrate:neoview-config
bun run migrate:neoview-config -- --config C:\path\to\xiranite.config.toml
bun run test:neoview-config
```

默认审计对旧深层格式、全量 envelope 和混合格式输出 warning 但返回成功；无效 TOML 始终失败。`--strict` 会把这些兼容输入视为未完成迁移。`migrate:neoview-config` 通过正式 Store 获取跨进程锁、创建 `.neoview-import.bak`、原子写入并回读验证。
