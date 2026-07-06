# CLI 命名与引导式 UI

Xiranite 节点包暴露独立的命令行工具。当前公共命令命名策略为：

```ts
nodeCliName("repacku") // xrepacku
nodeCliName("lata")    // xlata
```

策略定义在 `@xiranite/cli-runtime` 中：

- `NODE_CLI_PREFIX`：当前前缀，现为 `x`
- `LEGACY_NODE_CLI_PREFIX`：旧版兼容前缀，现为 `xiranite-`
- `nodeCliName(nodeId)`：格式化公共命令名称
- `normalizeNodeCliName(value)`：将 `xrepacku`、`xiranite-repacku` 或 `repacku` 解析为 `repacku`

## 为何存在

大多数 CLI 框架可以自定义显示名称、帮助输出、别名和子命令，但它们无法使 `package.json#bin` 动态化。

`package.json#bin` 是一个静态的 npm 清单字段。它不能引用 `${prefix}${name}` 这样的变量。由于每个节点包都是独立可安装的，每个包仍然需要一个真实的静态 `bin` 入口。

为避免手动编辑 26 个包清单，Xiranite 使用一个小的同步脚本：

```powershell
bun run sync:cli-bins
```

该脚本根据 `nodeCliName(id)` 重写每个 `packages/nodes/<id>/package.json` 的 bin 字段。如果后续前缀变更，更新 `NODE_CLI_PREFIX` 并重新运行脚本即可。

## 引导式 UI

`lata` 是核心引导式命令行应用。其他命令应复用它，而非实现自己的 Taskfile 选择器。

当前渲染层有意使用维护良好的终端库：

- `chalk` 用于终端颜色
- `boxen` 用于 Rich 风格的带边框面板
- `string-width` 用于中日韩文字宽度测量
- `citty` 用于显式的 Typer 风格命令

Xiranite 自有代码仅定义工作流和视觉约定：

- 显示当前 Taskfile 路径
- 渲染 `Taskfile 任务选择器`
- 列出带有彩色任务名称和描述的任务
- 提示输入编号选择
- 执行所选任务
- 在红色错误面板中渲染失败的命令
- 询问是否继续选择任务

## 更改命令名称

要从 `xrepacku` 切换到其他方案：

1. 编辑 `packages/cli-runtime/src/index.ts` 中的 `NODE_CLI_PREFIX`。
2. 运行 `bun run sync:cli-bins`。
3. 运行 `bun run build:packages`。
4. 使用 `bun scripts/install-cli-shims.ts` 重新安装 shim。

要稍后移除前缀，将 `NODE_CLI_PREFIX` 设为空字符串并重新执行相同步骤。

## 节点包规则

- 使用 `nodeCliName("<node-id>")` 作为 CLI `name` 和 `citty` `meta.name`。
- 不要在源文件中硬编码 `xiranite-*`、`x*` 或未来的命令名称。
- 在引导式工作流中使用 Taskfile `vars` 作为命令。
- 对无参数的引导式 Taskfile 流程，复用 `runLataTaskSelector()`。
- 保持 `package.json#bin` 由 `bun run sync:cli-bins` 生成。