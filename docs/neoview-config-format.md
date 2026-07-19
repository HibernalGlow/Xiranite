# NeoView TOML 配置格式

NeoView 节点配置的规范写入格式是 `[nodes.neoview]` 下的 `config` inline table：

```toml
[nodes.neoview]
config = { schema_version = 1, reader = { reading_direction = "right-to-left", double_page_view = true }, image = { auto_play_animated_images = true } }
```

解析后的业务对象仍是 `{ schema_version, reader, image, ... }`，`config` 只是 TOML 存储 envelope，不进入 GUI、CLI 或 TUI 的运行时契约。这样可以去掉大量 `[nodes.neoview.*]` 表头，同时保持原对象层级。

## 兼容规则

读取端同时接受三种输入：

- 优化格式：`[nodes.neoview]` + `config = { ... }`。
- 旧格式：`[nodes.neoview.reader]` 等嵌套表，继续正常读取。
- 混合格式：旧字段先作为基线，再递归合并 `config`；冲突时 `config` 中的新格式值优先，未知旧字段仍保留。

所有经过 `commitNeoviewConfig` 的实际写入都会原子化为优化格式，并继续保留 NeoView 节点之外的 Xiranite 配置。旧格式不会被启动时静默重写；下一次发生 NeoView 配置提交时才迁移，且仍沿用现有备份、跨进程锁、原子替换和回读验证。

TOML 1.0 inline table 必须位于单行。不要把 `{ ... }` 人工拆成多行，也不要在同一文件长期维护两份相互冲突的值。

## 验收与测试

```powershell
bun run audit:neoview-config
bun run audit:neoview-config -- --strict
bun run audit:neoview-config -- --config C:\path\to\xiranite.config.toml
bun run migrate:neoview-config
bun run migrate:neoview-config -- --config C:\path\to\xiranite.config.toml
bun run test:neoview-config
```

默认审计对旧格式和混合格式输出 warning 但返回成功，适合迁移期日常测试；无效 TOML/envelope 始终失败。`--strict` 会让旧格式或混合格式返回失败，适合准备合并、发布或确认设备已完成迁移时使用。`migrate:neoview-config` 通过正式 Store 获取跨进程锁、创建 `.neoview-import.bak`、原子写入并回读验证，不直接做 TOML 文本替换。
