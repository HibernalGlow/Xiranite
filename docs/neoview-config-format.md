# NeoView TOML 配置格式

NeoView 的规范写入格式保留根表和一级业务分区，并将分区内更深的对象行内化：

```toml
[nodes.neoview]
schema_version = 1

[nodes.neoview.reader]
reading_direction = "right-to-left"
double_page_view = true
subtitle = { font_size = 24, color = "#ffffff", bg_opacity = 0.65 }

[nodes.neoview.panels]
sidebars = { left = { pinned = true, width = 320 }, right = { pinned = false, width = 300 } }
edges = { top = { enabled = true }, left = { enabled = true } }

[nodes.neoview.bindings]
items = [ { action = "next-page", input = { key = "ArrowRight" } }, { action = "previous-page", input = { key = "ArrowLeft" } } ]
```

这种布局保留 `reader`、`panels`、`folder`、`image`、`bindings`、`super_resolution` 等可扫描分区，同时避免 `[nodes.neoview.panels.card_state.*]`、`[[nodes.neoview.bindings.items]]` 一类大量深层表头。解析后的业务对象结构不变，GUI、CLI 与 TUI 不需要感知存储布局。

## 兼容规则

读取端同时接受以下输入：

- 当前规范：根表 + 一级业务分区，分区内更深值使用 inline table/inline array。
- 原始旧格式：任意深度的 `[nodes.neoview.*]` 表及 `[[nodes.neoview.*]]` 对象数组。
- 上一版 envelope：`[nodes.neoview]` 下的 `config = { ... }`，以及被普通 TOML writer 展开的 `[nodes.neoview.config.*]`。
- 混合格式：直接字段先作为基线，再递归合并 `config`；冲突时 `config` 值优先，未知字段保留。

所有 `commitNeoviewConfig` 写入和共享 `saveXiraniteConfig` 写入都会生成当前规范格式，因此修改其他节点或应用设置也不会再次把 NeoView 展开成深层表。旧格式不会仅因启动而静默重写；下一次配置提交或显式迁移时才转换，并继续使用备份、跨进程锁、原子替换和回读验证。

TOML 1.0 inline table 必须保持单行。一级业务分区应保持独立，不要把整个 NeoView 配置重新塞进一个超长 `config` 行。

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
