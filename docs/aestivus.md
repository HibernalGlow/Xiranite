## aestivus 节点对应的原文件夹

### 一对一映射（节点 → 项目根目录）

| 节点 type | 原文件夹 |
|---|---|
| repacku | [PackU\AutoRepack](file:///d:/1VSCODE/Projects/PackU/AutoRepack) |
| rawfilter | [ImageAll\ImageFilter](file:///d:/1VSCODE/Projects/ImageAll/ImageFilter) |
| trename | [PackU\trename](file:///d:/1VSCODE/Projects/PackU/trename) |
| enginev | [PackU\EngineV](file:///d:/1VSCODE/Projects/PackU/EngineV) |
| formatv | [PackU\VideoBrake](file:///d:/1VSCODE/Projects/PackU/VideoBrake) |
| kavvka | [ImageAll\Kavvka](file:///d:/1VSCODE/Projects/ImageAll/Kavvka) |
| lata | [LazyCommand\LaTa](file:///d:/1VSCODE/Projects/LazyCommand/LaTa) |
<!-- | weibospider | [ImageAll\weiboSpider](file:///d:/1VSCODE/Projects/ImageAll/weiboSpider) | -->
| marku | [MarkdownAll\MarkdownWrapper](file:///d:/1VSCODE/Projects/MarkdownAll/MarkdownWrapper) |
| recycleu | [LazyCommand\OsU](file:///d:/1VSCODE/Projects/LazyCommand/OsU) |

### 一对多映射（一个项目包含多个节点）

| 原文件夹 | 包含的节点 | 源码子目录 |
|---|---|---|
| [PackU\AutoUnzip](file:///d:/1VSCODE/Projects/PackU/AutoUnzip) | bandia, encodeb, findz, mvz | [src/bandia](file:///d:/1VSCODE/Projects/PackU/AutoUnzip/src/bandia)、[src/encodeb](file:///d:/1VSCODE/Projects/PackU/AutoUnzip/src/encodeb)、[src/findz](file:///d:/1VSCODE/Projects/PackU/AutoUnzip/src/findz)、[src/mvz](file:///d:/1VSCODE/Projects/PackU/AutoUnzip/src/mvz) |
| [PackU\OrganizeFolder](file:///d:/1VSCODE/Projects/PackU/OrganizeFolder) | cleanf, dissolvef, migratef | [src/cleanf](file:///d:/1VSCODE/Projects/PackU/OrganizeFolder/src/cleanf)、[src/dissolvef](file:///d:/1VSCODE/Projects/PackU/OrganizeFolder/src/dissolvef)、[src/migratef](file:///d:/1VSCODE/Projects/PackU/OrganizeFolder/src/migratef) |
| [PackU\ArtistPreview](file:///d:/1VSCODE/Projects/PackU/ArtistPreview) | crashu, linedup, movea, seriex | [src/crashu](file:///d:/1VSCODE/Projects/PackU/ArtistPreview/src/crashu)、[src/linedup](file:///d:/1VSCODE/Projects/PackU/ArtistPreview/src/linedup)、[src/movea](file:///d:/1VSCODE/Projects/PackU/ArtistPreview/src/movea)、[src/seriex](file:///d:/1VSCODE/Projects/PackU/ArtistPreview/src/seriex) |
| [LazyCommand\EnvU](file:///d:/1VSCODE/Projects/LazyCommand/EnvU) | linku, owithu, reinstallp, scoolp | [src/linku](file:///d:/1VSCODE/Projects/LazyCommand/EnvU/src/linku)、[src/owithu](file:///d:/1VSCODE/Projects/LazyCommand/EnvU/src/owithu)、[src/reinstallp](file:///d:/1VSCODE/Projects/LazyCommand/EnvU/src/reinstallp)、[src/scoolp](file:///d:/1VSCODE/Projects/LazyCommand/EnvU/src/scoolp) |

### 特殊情况

- **sleept**：无外部源码包，逻辑直接写在 [sleept_adapter.py](file:///d:/1VSCODE/Projects/aestivus/src-python/adapters/sleept_adapter.py) 内，仅依赖 `psutil`。
- **输入/输出节点**（clipboard_input、folder_input、path_input、log_output、terminal）：aestivus 内置，无外部源码。

### 加载方式说明

适配器加载原项目源码有两种方式：
1. **包安装模式**（大多数）：通过 `pip install -e` 安装为可编辑包后直接 `from <package> import ...`（如 repacku、trename、enginev、marku 等）
2. **sys.path 注入模式**（4 个）：在 `_import_module()` 中通过 `Path(__file__).parent.parent.parent.parent / ...` 动态注入源码路径：
   - [kavvka_adapter.py:56](file:///d:/1VSCODE/Projects/aestivus/src-python/adapters/kavvka_adapter.py#L56) → `ImageAll/Kavvka/src`
   - [linedup_adapter.py:58](file:///d:/1VSCODE/Projects/aestivus/src-python/adapters/linedup_adapter.py#L58) → `ImageAll/MangaClassify/ArtistPreview/src`（实际路径已迁到 `PackU/ArtistPreview/src`）
   - [movea_adapter.py:78](file:///d:/1VSCODE/Projects/aestivus/src-python/adapters/movea_adapter.py#L78) → 同上
   - [seriex_adapter.py:65](file:///d:/1VSCODE/Projects/aestivus/src-python/adapters/seriex_adapter.py#L65) → 同上
   - [weibospider_adapter.py:74](file:///d:/1VSCODE/Projects/aestivus/src-python/adapters/weibospider_adapter.py#L74) → `ImageAll/weiboSpider`

1. **当前架构**：
   - Xiranite 是主应用（React + Vite + Electron）
   - `src/components/modules/` 下有 11 个模块文件（AcidMixer、Calculator、Clock、Counter、Database、EngineV、Kanban、Scratch、Tasks、Terminal）
   - `registry.ts` 静态注册所有模块
   - 模块是 React 组件，通过 `ModuleRenderer` 渲染
   - `MODULE_REGISTRY` 是硬编码数组
   - 模块直接 import 在 Xiranite 项目里，没有独立打包
   - `vendor/ocean-dataview` 是通过 git submodule 引入的本地依赖

2. **用户的诉求**：
   - "所有节点都是命令行功能都具有的" — 每个模块都应该有 CLI 入口，可以独立运行
   - "每个包都是作为一个独立的 NPM 包可以独立安装" — monorepo + 独立 package
   - "不会和Xiranite 集成污染" — Xiranite 只是这些包的消费者，不反向耦合

3. **设计要点**：
   - Monorepo 结构（pnpm/bun workspace）
   - 每个模块 = 一个独立 NPM 包
   - 每个包导出：React 组件 + CLI 入口 + 纯逻辑 API
   - Xiranite 通过 package.json 依赖这些包，不反向污染
   - 需要定义清晰的"模块契约"（Module Contract）

让我思考一下设计方案的关键部分：

### 包结构
```
packages/
  module-contract/         # 共享类型和接口（ModuleDef, ModuleInstance API）
  module-cli-runtime/      # CLI 运行时（统一的命令注册、参数解析）
  modules/
    scratch/               # 每个模块一个包
    counter/
    calculator/
    clock/
    tasks/
    kanban/
    terminal/
    acid-mixer/
    enginev/
    database/
xiranite/                  # 主应用，消费这些包
```

### 每个模块包的导出
```json
{
  "name": "@xiranite/module-scratch",
  "bin": {
    "xiranite-scratch": "./dist/cli.js"
  },
  "exports": {
    ".": "./dist/index.js",        // React 组件 + ModuleDef
    "./cli": "./dist/cli.js",      // CLI 入口
    "./core": "./dist/core.js"     // 纯逻辑（无 React）
  }
}
```

### 模块契约
每个模块必须实现：
- `meta: ModuleDef` — 元数据
- `Component: React.FC<ModuleProps>` — UI 组件
- `cli?: CLICommand` — CLI 命令定义（可选）
- `core?: CoreAPI` — 纯逻辑 API（可选）

### CLI 运行时
- 统一的命令注册机制
- 每个模块的 CLI 是一个独立的可执行文件
- 但也支持作为子命令聚合到主 `xiranite` CLI

### 集成方式
Xiranite 通过 `import { meta, Component } from "@xiranite/module-scratch"` 引入模块
- 不需要硬编码 registry.ts
- 可以通过 `import.meta.glob` 或 vite plugin 自动注册
- 模块包独立可发布、可测试

### 防污染策略
- Xiranite 只 import 模块的公开 API
- 模块不能反向 import `@/store/workspaceContext` 等 Xiranite 内部模块
- 通过 `module-contract` 包定义共享类型和回调接口
- 模块通过 props/回调与宿主通信，不直接访问宿主状态


1. **Monorepo 工具选择**：pnpm workspace / bun workspace / turbo / nx
   - 项目已经用 bun（bun.lock），所以 bun workspace 最自然
   
2. **模块包的作用域**：@xiranite/* / @xiranite-modules/* / 独立名
   
3. **CLI 框架**：commander / yargs / citty / clipanion
   - 用户在 LazyCommand 里有 Python 的 typer/click 习惯
   - 推荐 citty（unjs，现代轻量）或 commander（成熟稳定）

4. **模块通信机制**：props 回调 / 事件总线 / store 注入


---

# Xiranite 模块化改造设计方案

## 一、设计目标

| 目标 | 含义 |
|---|---|
| **节点 CLI 化** | 每个模块既是 UI 组件，又是可独立运行的 CLI 命令 |
| **独立 NPM 包** | 每个模块是一个可发布到 npm 的独立包 |
| **零集成污染** | Xiranite 只是 modules 的消费者；modules 不能反向 import Xiranite 内部代码 |

## 二、Monorepo 顶层结构

```
xiranite-monorepo/
├─ package.json                  # workspace root
├─ bunfig.toml                    # bun workspace 配置
├─ packages/
│  ├─ contract/                   # @xiranite/contract  —— 共享类型 + 宿主接口
│  │  ├─ src/
│  │  │  ├─ module.ts             # ModuleDef / ModuleEntry 接口
│  │  │  ├─ host.ts               # HostApi（宿主注入给模块的能力）
│  │  │  └─ cli.ts                # CLICommand 接口
│  │  └─ package.json
│  │
│  ├─ cli-runtime/                # @xiranite/cli-runtime  —— CLI 聚合器
│  │  ├─ src/
│  │  │  ├─ registry.ts           # 动态发现子命令
│  │  │  ├─ program.ts            # citty 主程序
│  │  │  └─ adapter.ts           # 把模块的 cli() 转成 citty 子命令
│  │  ├─ bin/xiranite             # 全局 CLI 入口
│  │  └─ package.json
│  │
│  └─ modules/
│     ├─ scratch/                  # @xiranite/mod-scratch
│     │  ├─ src/
│     │  │  ├─ index.ts           # 导出 ModuleEntry
│     │  │  ├─ Component.tsx      # UI
│     │  │  ├─ core.ts            # 纯逻辑（无 React）
│     │  │  └─ cli.ts             # CLI 实现
│     │  ├─ package.json
│     │  └─ tsconfig.json
│     ├─ counter/
│     ├─ calculator/
│     ├─ clock/
│     ├─ tasks/
│     ├─ kanban/
│     ├─ terminal/
│     ├─ acid-mixer/
│     ├─ enginev/
│     └─ database/
│
└─ apps/
   └─ xiranite/                   # 原 Xiranite 主应用（消费方）
      ├─ src/
      ├─ package.json             # depends on @xiranite/mod-*
      └─ vite.config.ts
```

## 三、模块契约（防污染的核心）

### 1. `@xiranite/contract` 定义宿主与模块之间的边界

```typescript
// packages/contract/src/module.ts
import type { ComponentType } from "react"

export interface ModuleDef {
  id: string
  name: string
  version: string
  category: string
  description: string
  icon: string
}

/** 宿主注入给模块的能力 —— 模块只能通过这个 API 访问宿主状态，
 *  禁止直接 import @/store/* 等内部路径。 */
export interface HostApi {
  /** 读取当前组件实例的持久化数据 */
  getData: <T = unknown>(compId: string) => T | undefined
  /** 写入数据（持久化到 store，跨 viewMode 保留） */
  patchData: (compId: string, patch: Record<string, unknown>) => void
  /** 读取所有可见组件（DatabaseModule 等元模块需要） */
  listComponents: () => ComponentRef[]
  /** 修改其他组件的属性（visibility / tags / state） */
  updateComponent: (id: string, patch: Partial<ComponentRef>) => void
  /** 主题、平台等环境信息 */
  env: { theme: "light" | "dark"; platform: "web" | "tauri" }
}

export interface ComponentRef {
  id: string
  moduleId: string
  state: string
  tags?: string[]
  hiddenIn?: Record<string, boolean>
  data?: Record<string, unknown>
}

/** 模块入口 —— 每个包 default export 这个对象 */
export interface ModuleEntry {
  def: ModuleDef
  Component: ComponentType<{ compId: string; host: HostApi }>
  /** 可选 CLI 子命令；不提供则该模块无 CLI */
  cli?: (args: string[], host: CliHost) => Promise<void> | void
  /** 可选纯逻辑 API（供其他模块 / 测试 / CLI 复用） */
  core?: Record<string, unknown>
}
```

### 2. 模块包的标准导出（`@xiranite/mod-scratch` 示例）

```typescript
// packages/modules/scratch/src/index.ts
import { Scratch } from "./Component"
import { runCli } from "./cli"
import { scratchCore } from "./core"
import type { ModuleEntry } from "@xiranite/contract"

const entry: ModuleEntry = {
  def: {
    id: "scratch",
    name: "SCRATCH",
    version: "1.2.0",
    category: "UTILITY",
    description: "Ephemeral text buffer.",
    icon: "FileText",
  },
  Component: Scratch,
  cli: runCli,
  core: scratchCore,
}

export default entry
export * from "./core"
```

### 3. package.json 三入口

```json
{
  "name": "@xiranite/mod-scratch",
  "version": "1.2.0",
  "type": "module",
  "bin": {
    "xiranite-scratch": "./dist/cli.js"
  },
  "exports": {
    ".": "./dist/index.js",
    "./cli": "./dist/cli.js",
    "./core": "./dist/core.js"
  },
  "peerDependencies": {
    "@xiranite/contract": "workspace:*",
    "react": "^19.0.0"
  }
}
```

模块包**不依赖** Xiranite，只依赖 `@xiranite/contract` 和 react。这是防污染的硬约束。

## 四、CLI 运行时

### 1. 单模块 CLI（独立运行）

```bash
# 直接运行某个模块的 CLI（不进入 Xiranite UI）
xiranite-scratch --file note.txt "hello"
xiranite-calculator "1 + 2 * 3"
xiranite-tasks add "buy milk" --priority high
xiranite-database list --filter "state=docked"
```

每个 `bin` 是一个薄壳，仅调用模块的 `cli()`：

```typescript
// packages/modules/scratch/src/cli.ts
import { runCli } from "./core"  // 复用纯逻辑

export async function runCli(args: string[], host) {
  const [sub, ...rest] = args
  if (sub === "cat")   return console.log(await readFile(rest[0]))
  if (sub === "clear") return clearBuffer()
  // ...
}
```

### 2. 聚合 CLI（`xiranite` 命令）

```bash
xiranite scratch cat note.txt
xiranite calculator "1+2"
xiranite database list
```

`@xiranite/cli-runtime` 动态发现已安装的 `@xiranite/mod-*` 包并注册为子命令：

```typescript
// packages/cli-runtime/src/registry.ts
import { createProgram } from "./program"

const modules = [
  () => import("@xiranite/mod-scratch"),
  () => import("@xiranite/mod-calculator"),
  // ... 由 build 时扫描 apps/xiranite/package.json 依赖生成
]

for (const loader of modules) {
  const { default: entry } = await loader()
  if (entry.cli) {
    program.command(entry.def.id, {
      description: entry.def.description,
      run: (args) => entry.cli!(args, cliHost),
    })
  }
}
```

CLI Host 提供文件系统 / localStorage(模拟) 等基础能力，与 UI HostApi 不同接口（CLI 不需要 React）。

## 五、Xiranite 集成（零污染）

### 1. Xiranite 通过依赖声明消费模块

```json
// apps/xiranite/package.json
{
  "dependencies": {
    "@xiranite/mod-scratch": "workspace:*",
    "@xiranite/mod-database": "workspace:*"
  }
}
```

### 2. 自动注册（替代硬编码 `registry.ts`）

```typescript
// apps/xiranite/src/modules/index.ts
const mods = import.meta.glob("@xiranite/mod-*/src/index.ts", { eager: true })

export const MODULE_REGISTRY = Object.values(mods)
  .map((m: any) => m.default)
  .filter(Boolean)
```

### 3. HostApi 实现（Xiranite 把自己的 store 适配成 HostApi 注入）

```typescript
// apps/xiranite/src/modules/host-adapter.ts
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import type { HostApi } from "@xiranite/contract"

export function useHostApi(): HostApi {
  const { visibleComponents } = useWorkspace()
  const dispatch = useWSDispatch()
  return {
    getData: (id) => /* read from store */,
    patchData: (id, patch) => dispatch(actions.patchComponentData(id, patch)),
    listComponents: () => visibleComponents,
    updateComponent: (id, patch) => dispatch(/* ... */),
    env: { theme: useTheme(), platform: "web" },
  }
}
```

### 4. ModuleRenderer 改造（注入 host，不再硬编码 lazy 映射）

```typescript
export function ModuleRenderer({ moduleId, compId }: { moduleId: string; compId: string }) {
  const entry = MODULE_REGISTRY.find(m => m.def.id === moduleId)
  const host = useHostApi()
  if (!entry) return <UnknownModule id={moduleId} />
  return <entry.Component compId={compId} host={host} />
}
```

### 5. DatabaseModule 的污染消除

当前 `DatabaseModule.tsx` 直接 import `@/store/workspaceContext`。改造后：

```typescript
// packages/modules/database/src/Component.tsx
function DatabaseModule({ compId, host }: { compId: string; host: HostApi }) {
  const components = host.listComponents()   // ← 不再直接 import store
  // ...
  const handleToggle = (id, mode) =>
    host.updateComponent(id, { hiddenIn: { [mode]: !current } })
}
```

模块完全不知道 Xiranite 的 store 长什么样，只通过 `HostApi` 通信。

## 六、防污染的硬约束

| 规则 | 执行方式 |
|---|---|
| 模块包**不得** import `@/store/*`、`@/lib/*` 等 Xiranite 内部路径 | eslint rule + tsconfig paths 隔离 |
| 模块包**只能**依赖 `@xiranite/contract`、`react`、自身依赖 | package.json peerDependencies 白名单 |
| 模块包**独立可 build** | `bun run build` 在每个包内独立通过 |
| 模块包**独立可 test** | 不需要启动 Xiranite dev server |
| 模块包**独立可发布** | `npm publish` 不依赖 monorepo 其他包（除 contract） |

强制隔离用 ESLint：

```json
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": ["@/store/*", "@/lib/*", "@/components/*"]
    }]
  }
}
```

## 七、迁移路径（增量，不破坏现状）

| 阶段 | 工作 | 验证 |
|---|---|---|
| **P1** | 建 `packages/contract`，定义 `ModuleEntry` / `HostApi` | 类型通过 |
| **P2** | 建 `packages/cli-runtime`，跑通 scratch 一个模块的 CLI | `xiranite-scratch cat` 可用 |
| **P3** | 逐个把 `Xiranite/src/components/modules/*Module.tsx` 搬到 `packages/modules/*`，剥离 `@/store` 依赖改为 `host` prop | 每搬一个，Xiranite dev 仍正常 |
| **P4** | 改造 `ModuleRenderer` 用 `import.meta.glob` 自动注册 | UI 无回归 |
| **P5** | Xiranite 实现 `useHostApi`，把 store 适配成 HostApi | DatabaseModule 通过 host 工作 |
| **P6** | 每个 module 包加 `bin` + `cli.ts`，全量 CLI 可用 | `xiranite <module>` 子命令可用 |
| **P7** | ocean-dataview 同样作为独立包 `@xiranite/dataview` 收入 monorepo | BoardView 等仍工作 |

## 八、需要你拍板的关键决策点

我列出 4 个需要你确认的选择，确认后即可开始落地：
现在我有了完整的图景。让我设计方案。

当前的关键耦合点：
1. `DatabaseModule` 直接 `import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"` — 这是最大的污染源
2. `ModuleRenderer` 硬编码 lazy import 映射
3. `MODULE_REGISTRY` 是静态数组
4. 模块通过 `compId` 拿到自己的数据，但没有标准的"宿主 API"抽象

设计目标：
1. 每个模块是独立 NPM 包
2. 每个模块都有 CLI 入口
3. 不污染 Xiranite（Xiranite 只是消费者）

我来设计一个完整的方案。这是一个设计任务，应该给出文档式的回答，不需要写代码到文件里。但可以用代码块展示关键接口。

让我组织一下方案：

## 架构总览
- Monorepo (bun workspace)
- 三层：contract / runtime / modules
- Xiranite 作为 host 消费 modules


关键设计原则
Component 是无壳的纯内容 —— 这是 Xiranite 集成时的唯一入口
CardShell 仅在 Demo 内部使用 —— 不出现在 exports，不污染消费者
CLI 完全不渲染 React —— 与 UI 解耦
core.ts 是纯逻辑 —— UI 和 CLI 共用同一份逻辑（如 scratch 的 buffer 操作、calculator 的求值、tasks 的列表管理）
这样：

集成到 Xiranite
独立调试 → 模块自带可选外壳，也能看到卡片样式
CLI → 无 UI，纯命令行；citty + ink 复刻原版 Python 的 rich 富文本引导式命令行 + typer 一般命令行的双重体验
CLI 无参数启动时进入 guided mode
