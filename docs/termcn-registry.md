# termcn registry

Xiranite 的共享终端组件由 `@xiranite/cli-runtime` 统一持有。节点只使用共享工作台和语义 schema，不复制 termcn 组件源码。

## Registry

项目 registry 已保存在 `packages/cli-runtime/components.json`：

```json
"@termcn": "https://termcn.dev/r/{name}.json"
```

OpenTUI 组件必须使用 `opentui/` 命名空间：

```bash
bunx --bun shadcn@latest add @termcn/opentui/spinner
```

Ink 已不再属于项目运行时，不安装 `@termcn/ink/*`。

## 主题

主题也从 registry 安装，并交给 termcn `ThemeProvider`：

```bash
bunx --bun shadcn@latest add @termcn/opentui/theme-dracula
```

节点 CLI 的主题选择保存在 `nodes.<id>.cli.theme`；桌面主题保存在 `nodes.<id>.ui.theme`，两者互不继承彼此，但都可以选择 `inherit` 使用各自的全局默认值。

## 安装前检查

新增或手写任何共享 TUI 控件前必须按顺序执行：

```bash
bunx --bun shadcn@latest search @termcn -q "<capability>"
bunx --bun shadcn@latest view @termcn/opentui/<component>
bunx --bun shadcn@latest add @termcn/opentui/<component> --dry-run
bunx --bun shadcn@latest add @termcn/opentui/<component> --yes
```

安装后必须检查 registry 生成文件的导入路径、NodeNext `.js` 扩展、鼠标行为、焦点隔离以及浏览器边界。termcn 没有对应组件，或组件无法满足自动化验证过的安全交互时，才允许在共享 runtime 中写薄适配器。

## 已安装

| Registry item | 本地文件 | 自动依赖 |
| --- | --- | --- |
| `@termcn/opentui/spinner` | `packages/cli-runtime/src/components/ui/spinner.tsx` | `theme-provider`、`types`、默认主题、`use-animation`、`cli-spinners` |

后续安装组件时同步更新此表，避免重复搜索、重复安装或自行重写已有能力。
