# Xiranite 节点编写指南

本指南定义了 Xiranite 节点的无适配器包契约。适用于迁移 aestivus 适配器、在外部仓库中编写节点，或审核节点包能否独立安装且不污染 Xiranite 时参考。

关于面向外部仓库作者的交接风格指南，请参见 [external-node-packages.md](external-node-packages.md)。

## 包结构

每个节点是 Bun 工作区下的独立 npm 包：

```text
packages/nodes/<node-id>/
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

对于外部仓库，保持相同的 `src/` 结构，并将包发布为 `@xiranite/node-<id>` 或其他作用域名。Xiranite 应仅通过其公开包 API 消费。

## 公开契约

包的主入口是 Xiranite 集成表面：

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
    description: "面向用户的简短描述。",
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

不要从 `src/index.ts` 导出 `CardShell`、`demo`、`platform` 或 CLI 符号。包可以在 `package.json` 中暴露 `./cli`、`./core` 和供 Xiranite host runtime 使用的 `./platform` 子路径，但 Xiranite UI 集成必须使用默认的 `NodeEntry`。

## package.json

使用 ESM、可发布的文件、包本地二进制文件和显式子路径导出：

```json
{
  "name": "@xiranite/node-example",
  "version": "0.1.0",
  "type": "module",
  "private": false,
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
    },
    "./platform": {
      "types": "./dist/platform.d.ts",
      "default": "./dist/platform.js"
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

外部包在发布前应将工作区范围版本替换为已发布的版本号。

## 核心逻辑

`core.ts` 是 UI、CLI 和测试共享的纯逻辑。

允许：

- 数据解析、验证、规划、转换、评分、格式化、状态归约器。
- 运行时注入接口，如 `readFile(path)`、`writeFile(path, data)`、`listDir(path)`、`fetch(url)`。
- 可在 Bun 测试中运行而不依赖真实文件系统的确定性函数（除非测试注入了假运行时）。

禁止：

- `node:*` 导入。
- 直接调用 `Bun`、`process`、文件系统、路径、注册表、Shell 或网络。
- React、Ink、Xiranite store、DOM、Electron 或浏览器 API。

将 Node/Bun 的文件系统、Shell、注册表、浏览器和网络适配器放在 `platform.ts` 中。

## 组件

`Component.tsx` 是无壳内容。Xiranite 提供外部卡片、流程形状、停靠面板、浮动窗口或演示包装器。

规则：

- 仅接受来自 `@xiranite/contract` 的 `NodeComponentProps`。
- 使用 `host.getData`、`host.patchData`、`host.clipboard` 和 `host.downloadText`。
- 切勿在 `Component.tsx` 中调用 `host.runNode`、`host.runner?.runNode` 或任何后端运行器。
- 切勿从 `@/store`、`@/components`、`@/lib` 或任何 Xiranite 应用路径导入。
- 使用 `@xiranite/ui` 原语（`NodeContent`、`NodeHeader`、`NodeBody`、`NodeFooter`、`Field`、`TextArea`、`ActionButton`、`IconButton`、`SegmentButton`、`StatPill`、`ResultView`、`LogView`）。
- 不要在节点组件中定义本地 `Panel`、本地卡片外壳、嵌套卡片布局或 shadcn `Card` 包装器。
- 不要硬编码卡片尺寸布局约束，如 `min-h-[320px]`、`min-h-[330px]` 或固定多列网格如 `grid-cols-[1.1fr_1fr_130px]`。

原生的文件系统、注册表、Shell、浏览器和网络执行属于包 CLI 或 Xiranite 后端服务。保持组件适用于本地状态、粘贴输入、可在 `core.ts` 中运行的预览，以及解释 CLI/后端回退的日志。

## 演示外壳

`src/demo/CardShell.tsx` 是可选的，仅用于独立演示。它可以渲染类似卡片的外框，但不得出现在 `src/index.ts` 的导出中，且不得被 Xiranite 要求。

## CLI

`cli.ts` 仅限命令行。它可以使用 `citty`、`ink` 和 `@xiranite/cli-runtime`，但不得渲染或导入包的 React UI 组件。

规则：

- 在 TTY 中无参数时进入 Ink 引导模式。
- 在非 TTY 中无参数时以退出码 `2` 退出并显示用法错误。
- 显式命令使用 citty 风格的标志和子命令。
- CLI 显示名称应使用 `nodeCliName("<node-id>")`；包 `bin` 字段由 `bun run sync:cli-bins` 生成。
- CLI 通过 `platform.ts` 读取/写入文件、执行 Shell 命令、发起网络请求和与原生系统交互，然后调用 `core.ts`。
- Xiranite Local Backend 可通过包的 `./platform` 子路径复用同一份 Node/Bun runtime；这不是 UI 集成入口，也不得从 `src/index.ts` 再导出。
- 在需要时，应为自动化提供 JSON 输出。
- 二进制文件在 `bun --filter @xiranite/node-<id> build` 后必须可执行。

## Xiranite 集成

当前集成通过生成器维护静态 import：

1. 将包添加到根 `package.json` 依赖中。
2. 确认节点包位于 `packages/nodes/<id>`，且 `package.json.name` 使用 `@xiranite/node-<id>`。
3. 运行 `bun run generate:node-registries`，生成 `packages/runtime/src/node-runner.generated.ts` 与 `src/components/modules/packageModules.generated.ts`。
4. 不要手改 `src/components/modules/registry.ts`、`src/components/modules/ModuleRenderer.tsx` 或 `packages/runtime/src/node-runner.ts` 的节点清单。
5. 不要导入 `cli.ts`、`platform.ts`、`demo/*` 或任何非公开的应用内部模块。

未来的插件发现机制可以替代生成的静态 import，但节点包仍必须遵守相同的公开契约。

## 验证

在认为节点完成之前，运行以下命令：

```powershell
bun --filter @xiranite/node-example test
bun --filter @xiranite/node-example build
bun run generate:node-registries
bun scripts/validate-node-architecture.ts --node example
bun run test:packages
bun run build:packages
bun run build
```

验证脚本是首选的架构门控。如需手动调试失败，从仓库根目录运行以下等效扫描：

```powershell
rg -n "NodeCardSchema|NodeCardProps|card:\s*NodeCard" packages src
rg -n "host\.runNode|host\.runner|runner\?:" packages src
rg -n "<Panel|function Panel|const Panel" packages/nodes -g Component.tsx
rg -n "min-h-\[3|grid-cols-\[1\.1fr|grid-cols-\[.*130px" packages/nodes -g Component.tsx
rg -n "CliHost|CliCommand|cli\?:" packages/contract/src/index.ts
rg -n "@xiranite/contract" packages/nodes -g cli.ts
rg -n "demo|CardShell|from \"\.\/cli|from \"\.\/platform|from \"\.\/demo" packages/nodes -g index.ts
```

预期结果：仅有意使用的演示 `CardShell` 文件可能包含演示外壳样式；包的 `Component.tsx` 和 `index.ts` 必须保持干净。

## 迁移清单

- 将原始 Python 适配器操作表面映射为 TypeScript 输入和输出类型。
- 将纯解析/规划/状态逻辑移至 `core.ts`。
- 将文件系统、Shell、注册表、浏览器和网络工作移至 `platform.ts`。
- 在 `core.ts` 中使用注入的运行时实现 `run<NodeId>`。
- 添加针对性的 `core.test.ts` 覆盖，涵盖解析、规划、试运行、通过假运行时执行以及撤销/历史（如支持）。
- 将 `Component.tsx` 实现为一个密集、无壳的内容表面。
- 实现包含引导式和显式命令路径的 `cli.ts`。
- 确认包构建、包测试、仓库包测试、仓库构建和架构扫描全部通过。
