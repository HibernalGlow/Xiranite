# 外部 Xiranite 节点包

本文档是在此仓库外部编写 Xiranite 节点并后续集成时的交接契约。

## 什么是外部节点

外部节点是一个普通的 npm 包，导出 Xiranite `NodeEntry`：

- UI 入口：无壳的 `Component.tsx`
- 共享逻辑：纯 `core.ts`
- 命令行：`cli.ts`
- 原生适配器：`platform.ts`
- 可选的独立演示外壳：`src/demo/CardShell.tsx`

该包不得导入 Xiranite 应用内部模块。Xiranite 是消费者。

## 必需的包结构

```text
my-node-package/
  package.json
  tsconfig.json
  src/
    index.ts
    core.ts
    core.test.ts
    Component.tsx
    cli.ts
    platform.ts
    demo/
      CardShell.tsx
```

`src/index.ts` 是 Xiranite 唯一应导入的集成入口。

## 公开入口

```ts
import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "example",
    name: "Example",
    version: "0.1.0",
    category: "file",
    description: "简短描述。",
    icon: "FileText",
    keywords: ["example"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
```

不要从 `index.ts` 导出 `cli`、`platform`、`demo` 或 `CardShell`。

## 包清单

本地工作区开发使用此结构：

```json
{
  "name": "@xiranite/node-example",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "xexample": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./core": {
      "types": "./dist/core.d.ts",
      "default": "./dist/core.js"
    },
    "./cli": {
      "types": "./dist/cli.d.ts",
      "default": "./dist/cli.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "bun test"
  },
  "dependencies": {
    "@xiranite/cli-runtime": "workspace:*",
    "@xiranite/contract": "workspace:*",
    "@xiranite/ui": "workspace:*"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "lucide-react": "^1.0.0"
  }
}
```

在发布到 monorepo 外部之前，将 `workspace:*` 替换为已发布的版本号。

## 组件规则

`Component.tsx` 仅包含内容。Xiranite 提供卡片外壳、停靠面板、流程形状、浮动窗口和演示包装器。

允许：

- 来自 `@xiranite/contract` 的 `NodeComponentProps`
- `@xiranite/ui` 内容原语
- 源自 `host.getData` / `host.patchData` 的本地组件状态
- 粘贴的输入、本地预览、日志和 CLI 回退消息

禁止：

- `CardShell`、本地 `Panel`、shadcn `Card` 或嵌套卡片外壳
- `@/store`、`@/components`、`@/lib` 或其他 Xiranite 应用导入
- `host.runNode`、`host.runner` 或任何后端运行器假设
- 固定卡片尺寸，如 `min-h-[320px]`
- 固定任意网格，如 `grid-cols-[1.1fr_1fr_130px]`

## 核心逻辑与平台分离

`core.ts` 应包含纯逻辑和运行时注入的操作：

- 解析输入
- 验证配置
- 构建计划
- 转换数据
- 计算统计
- 通过注入的运行时接口执行

`platform.ts` 负责具体的原生工作：

- 文件系统
- Shell/子进程
- Windows 注册表
- 浏览器/网络
- 归档工具
- 操作系统特定行为

这种分离使得 UI、CLI、测试和未来的后端执行都能使用相同的逻辑，无需适配器。

## CLI 规则

通过 `@xiranite/cli-runtime` 使用 `citty`。

- `xexample` 在当前 Xiranite CLI 命名策略下应可直接执行。
- `xiranite example ...` 可通过聚合注册表调用相同的 CLI。
- 无参数 TTY 可进入 Ink 引导模式。
- 无参数非 TTY 应返回用法/错误代码以供自动化使用。
- CLI 不得导入 `Component.tsx` 或 `@xiranite/ui`。
- 在需要时，应为脚本提供 JSON 输出。

## 集成到 Xiranite

当前集成通过生成器维护静态 import：

1. 将包依赖添加到根 `package.json`。
2. 如果是 workspace 内节点，确认包位于 `packages/nodes/<id>` 且名称为 `@xiranite/node-<id>`。
3. 运行 `bun run generate:node-registries`，生成前端 package module 清单与 runtime node-runner 清单。
4. 不要手改 `src/components/modules/registry.ts`、`src/components/modules/ModuleRenderer.tsx` 或 `packages/runtime/src/node-runner.ts` 的节点清单。

仅导入默认包入口。不要导入 `./cli`、`./platform` 或 `./demo`。

## 验证

从外部包：

```powershell
bun test
bun run build
```

从 Xiranite 仓库（链接或复制包后）：

```powershell
bun --filter @xiranite/node-example test
bun --filter @xiranite/node-example build
bun scripts/validate-node-architecture.ts --node example
bun run test:packages
bun run build:packages
bun run build
```

架构验证器有意比 TypeScript 更严格。仅通过 TypeScript 检查是不够的；节点必须保持 Xiranite 的无壳组件和 CLI/core 边界。

## Codex 技能

本地 Codex 技能安装在：

```text
C:\Users\30902\.codex\skills\xiranite-node-authoring
```

从任何仓库使用：

```text
使用 $xiranite-node-authoring 创建或审核一个无适配器的 Xiranite 节点包。
```
