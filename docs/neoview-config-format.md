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

这种布局保留 `reader`、`panels`、`folder`、`image`、`bindings`、`super_resolution` 等可扫描分区。`card_state`、`panel_state`、`sidebars`、`edges` 等相关项集合拥有自己的二级表，但不会继续为每个 Card 或边缘生成三级表头；对象数组允许多行，每个对象一行。解析后的业务对象结构不变，GUI、CLI 与 TUI 不需要感知存储布局。

## 兼容规则

读取端同时接受以下输入：

- 当前规范：根表 + 一级业务分区 + 最多一层相关项分组；分组成员使用一行一个 inline table，对象数组一行一个对象。
- 原始旧格式：任意深度的 `[nodes.neoview.*]` 表及 `[[nodes.neoview.*]]` 对象数组。
- 上一版 envelope：`[nodes.neoview]` 下的 `config = { ... }`，以及被普通 TOML writer 展开的 `[nodes.neoview.config.*]`。
- 混合格式：直接字段先作为基线，再递归合并 `config`；冲突时 `config` 值优先，未知字段保留。

所有 `commitNeoviewConfig` 写入和共享 `saveXiraniteConfig` 写入都会生成当前规范格式，因此修改其他节点或应用设置也不会再次把 NeoView 展开成深层表。旧格式不会仅因启动而静默重写；下一次配置提交或显式迁移时才转换，并继续使用备份、跨进程锁、原子替换和回读验证。

TOML 1.0 inline table 必须保持单行，因此一个相关对象对应一个 inline table 行；不要把整个相关项集合重新压进同一个超长行。

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
