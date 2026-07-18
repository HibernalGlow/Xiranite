# Xiranite performance optimization plan

> 给实现 AI：这份文档用于规划 Xiranite 的 React 编译、Vite 构建、TypeScript 编译和本地后端性能优化。请按阶段实施，每阶段都要用构建产物和测试验证，不要凭感觉改 chunk 或 memo。

## 参考资料

- React Compiler installation: https://react.dev/learn/react-compiler/installation
- Vite dep optimization options: https://vite.dev/config/dep-optimization-options.html
- 本仓库现状：
  - `vite.config.ts`
  - `package.json`
  - `tsconfig.json`
  - `tsconfig.app.json`
  - `tsconfig.node.json`
  - `packages/backend/tsconfig.json`
  - `packages/backend/src/index.ts`
  - `scripts/generate-node-registries.ts`
  - `scripts/audit-build-chunks.ts`
  - `src/components/modules/packageModules.generated.ts`
  - `src/components/workspace/WorkspaceLayout.tsx`
  - `src/components/modules/BlockNoteModule.tsx`

## 现状校准

不要直接照旧结论改。当前仓库已有一些优化：

- React 版本是 `^19.2.4`，适合接入 React Compiler。
- `@vitejs/plugin-react` 是 `^5.2.0`，当前还能使用 `react({ babel: { plugins: [...] } })` 方式接入 compiler。
- `src/components/modules/packageModules.generated.ts` 已经是静态 `NodeDef` metadata + 动态 `entry` loader。25 个节点不是全部静态 import 进主入口。
- `src/components/workspace/WorkspaceLayout.tsx` 已经 lazy 加载 `DockviewView`、`FlowView`、`LaneView`、`BentoView`。
- `src/components/modules/BlockNoteModule.tsx` 已经二段 lazy 加载 `BlockNoteEditor`。
- `scripts/audit-build-chunks.ts` 已经检查 `FlowCanvasView`、`BlockNoteEditor`、`DatabaseDataView` 等重资产不能出现在 `dist/index.html` 初始资源里。

因此本计划的重点是：

1. 安全试点 React Compiler。
2. 验证并收紧 chunk 边界，而不是重复做节点懒加载。
3. 补后端增量编译和本地文件缓存。
4. 用 selector / transition / virtualization 处理运行时热点。

## Phase 1: baseline first

先建立基线，避免优化后无法判断收益。

运行：

```powershell
bun run build
Get-ChildItem -LiteralPath dist/assets | Sort-Object Length -Descending | Select-Object -First 30 Name,Length
```

记录：

- 初始 JS 数量和大小。
- 最大主入口 chunk 大小。
- 是否出现 `vendor-dockview`、`vendor-gridstack`、`BlockNoteEditor`、`FlowCanvasView` 在 `dist/index.html` 初始 preload 中。
- `bun run build` 总耗时。
- `bun run test:packages` 总耗时。

建议新增脚本：

```json
{
  "scripts": {
    "audit:build-assets": "bun scripts/audit-build-chunks.ts"
  }
}
```

如果已有 `audit:build-chunks`，不要重复新增，只扩展现有脚本即可。

## Phase 2: React Compiler incremental adoption

React 官方文档说明 compiler 以 Babel 插件集成，并且必须在 Babel plugin pipeline 中最先运行。当前仓库 `@vitejs/plugin-react@5.2.0` 仍支持 inline Babel 配置；如果以后升级到 `@vitejs/plugin-react@6+`，inline Babel 选项已移除，要改用 `reactCompilerPreset` + `@rolldown/plugin-babel`。

### 当前版本接入方式

安装：

```powershell
bun add -d babel-plugin-react-compiler
```

修改 `vite.config.ts`：

```ts
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          ["babel-plugin-react-compiler", {
            compilationMode: "annotation",
          }],
        ],
      },
    }),
    tailwindcss(),
  ],
})
```

先使用 `annotation` 模式，不要全仓库一次性开启。试点组件手动加：

```ts
"use memo"
```

优先试点：

- `src/components/workspace/ComponentCard.tsx`
- `src/components/modules/ModuleRenderer.tsx`
- 一个状态比较复杂但副作用清晰的节点组件，例如 `src/nodes/findz/Component.tsx`

暂时不要先试：

- 频繁操作 DOM 或第三方 canvas 的组件。
- `FlowCanvasView` / tldraw 相关组件。
- 直接依赖外部 mutable instance 的编辑器组件。

### plugin-react 6+ 的未来写法

如果先升级到 `@vitejs/plugin-react@6+`：

```powershell
bun add -d babel-plugin-react-compiler @rolldown/plugin-babel
```

```ts
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import babel from "@rolldown/plugin-babel"

export default defineConfig({
  plugins: [
    react(),
    babel({
      presets: [
        reactCompilerPreset({
          compilationMode: "annotation",
        }),
      ],
    }),
    tailwindcss(),
  ],
})
```

### 验证

运行：

```powershell
bun run typecheck
bun run test:unit
bun run build
```

浏览器手动验证：

- React DevTools 中确认试点组件出现 compiler memo 标识。
- 观察 build output 是否出现 `react/compiler-runtime` 自动 memo cache 逻辑。
- 操作试点组件，确认交互和状态更新没有卡死或 stale closure。

注意：

- 这个仓库目前没有 ESLint 配置。不要为了 compiler 一次性引入完整 lint 改造。可以在后续单独建立 `eslint-plugin-react-hooks` 的 `recommended-latest` 检查。
- 如果某个组件编译后行为异常，临时加 `"use no memo"`，并记录原因。

## Phase 3: Vite chunk and lazy loading cleanup

### 节点懒加载已经完成，改为验证

当前 `scripts/generate-node-registries.ts` 生成：

```ts
export const PACKAGE_MODULES = [
  // static NodeDef literals
]

export const packageModuleLoaders = {
  findz: () => import("@/nodes/findz/entry"),
}
```

不要把它改回静态 `import { entry } from ...`。

应做：

- 保持 registry 只静态包含 `NodeDef` literal。
- Lazy import `AppNodeEntry` 只发生在 `ModuleRenderer` 实际渲染节点时。
- 扩展 `scripts/audit-build-chunks.ts`，检查节点 entry chunk 不进入初始 HTML。

建议新增检查模式：

```ts
const heavyInitialAssetPatterns = [
  /FlowCanvasView/i,
  /BlockNoteEditor/i,
  /DatabaseDataView/i,
  /vendor-tldraw/i,
  /vendor-blocknote/i,
  /vendor-ocean-dataview/i,
  /node-[a-z0-9-]+/i,
]
```

实际正则以构建产物命名为准，不要猜。

### Dockview / Gridstack / BlockNote

现状：

- `DockviewView` 是 route-level lazy import，但 `vite.config.ts` 仍有 `vendor-dockview` manual chunk。
- `BentoView` 是 lazy import，但 `vite.config.ts` 仍有 `vendor-gridstack` manual chunk。
- `BlockNoteEditor` 是二段 lazy import。

不要简单认为 manual chunk 一定会进入首屏。Vite/Rollup 仍可能把它作为动态依赖 chunk，只在对应 lazy view 请求时加载。正确做法是用 `dist/index.html` 和 network 面板确认。

任务：

1. 跑 `bun run build`。
2. 检查 `dist/index.html` 是否 preload `vendor-dockview`、`vendor-gridstack`、BlockNote 相关 chunk。
3. 如果它们没有出现在初始 HTML，先不改 manual chunks。
4. 如果出现初始 preload，再尝试从 `manualChunks` 中移除 `vendor-dockview` / `vendor-gridstack`，重新构建对比。
5. 对 BlockNote 不建议放入全局 `vendor-editor` manual chunk，除非确认不会被首屏 preload。更推荐让 `BlockNoteEditor` 自己形成动态 chunk。

### optimizeDeps

当前 `vite.config.ts` 的 `optimizeDeps` 是为 `use-sync-external-store` CommonJS 兼容和 `nuqs` 单例问题服务的。不要破坏这些注释里的约束。

可以添加：

```ts
optimizeDeps: {
  esbuildOptions: {
    target: "es2022",
  },
  include: [
    "use-sync-external-store",
    "use-sync-external-store/shim",
    "use-sync-external-store/shim/with-selector",
  ],
  exclude: ["nuqs"],
}
```

注意：Vite 官方文档说明 `optimizeDeps` 主要作用于开发期 dependency optimizer，不是生产构建优化。不要把它当成生产 bundle 体积优化手段。

## Phase 4: TypeScript build performance

### backend incremental build

目标文件：`packages/backend/tsconfig.json`

新增：

```json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  }
}
```

原因：

- `packages/backend/package.json` 使用 `tsc -p tsconfig.json`。
- backend 当前会 emit `dist`，适合启用 incremental。

验证：

```powershell
bun --filter @xiranite/backend build
bun --filter @xiranite/backend build
```

第二次构建应明显变快，并生成 `packages/backend/dist/.tsbuildinfo`。

### packages project references

当前根 `tsconfig.json` 只有：

```json
"references": [
  { "path": "./tsconfig.app.json" },
  { "path": "./tsconfig.node.json" }
]
```

但 `packages/*` 和 `packages/nodes/*` 各自已有 `tsconfig.json`。后续可以建立更细的 references。

建议单独做一轮，不要和 React Compiler 混在同 PR：

1. 确认每个 package tsconfig 都有 `composite: true`、`declaration: true`、稳定 `outDir`。
2. 生成根级 references：
   - `packages/config`
   - `packages/contract`
   - `packages/shared`
   - `packages/repository`
   - `packages/services`
   - `packages/api`
   - `packages/runtime`
   - `packages/backend`
   - `packages/cli`
   - `packages/nodes/*`
3. 调整 package 间 references 顺序，避免循环。
4. 将部分 build 脚本从串行 `bun --filter ... build` 改为 `tsc -b` 或 Bun workspace 并行策略。

不要第一步就开 `isolatedDeclarations`。它会要求大量显式类型标注，适合作为后续质量工程，不适合作为性能优化首个 PR。

## Phase 5: runtime rendering optimization

### Zustand selector 精细化

当前仓库已经有：

- `useWorkspaceSelector`
- `useWorkspaceShallowSelector`
- `useWorkspaceActions`
- `useWorkspaceComponentData`

后续优化原则：

- 不在组件里直接订阅整个 store。
- 动作对象和状态读取分开。
- 回调里才需要的状态优先用 `getWorkspaceState()`，避免 render 订阅。
- 派生布尔值直接 selector 计算，例如 `isFullscreen`，不要订阅整个 `ComponentInstance[]` 再在组件里找。

重点检查：

```powershell
rg -n "useWorkspaceStore\\(|useWorkspaceSelector\\(|useWorkspaceShallowSelector\\(" src
```

### startTransition

适用场景：

- 节点 registry 搜索/过滤。
- 大量组件布局切换。
- 操作历史筛选。
- 大型表格 view mode 切换。

示例：

```ts
const [isPending, startTransition] = useTransition()

function onSearchChange(value: string) {
  setInput(value)
  startTransition(() => {
    setQuery(value)
  })
}
```

不要用于：

- 输入框自身受控值。
- 必须同步反馈的拖拽/resize 坐标。
- 运行节点动作、删除组件等命令型状态。

### Virtualization

只有在列表变长后再引入，不要预优化。

候选：

- Module registry 列表。
- Node run history。
- Node operation monitor。
- Database/list/gallery views。

推荐依赖：

```powershell
bun add @tanstack/react-virtual
```

但前提是先用性能面板确认长列表渲染是瓶颈。

## Phase 6: backend performance

### local file cache headers

目标文件：`packages/backend/src/index.ts`

当前 `serveLocalFile`：

```ts
"cache-control": "private, max-age=60"
```

建议加 ETag 和 conditional 304：

```ts
const etag = `"${info.size}-${Math.trunc(info.mtimeMs)}"`
if (request.headers.get("if-none-match") === etag) {
  return new Response(null, { status: 304, headers })
}
headers.set("etag", etag)
```

为了拿到 request headers，需要把函数签名从：

```ts
serveLocalFile(url: URL)
```

改为：

```ts
serveLocalFile(request: Request, url: URL)
```

调用处同步改：

```ts
await writeNodeResponse(outgoing, await serveLocalFile(request, url))
```

缓存策略：

- 默认仍用 `private`，因为服务的是本地文件路径。
- 图片/预览文件可以提高到 `max-age=300` 或 `max-age=600`。
- 不要用 `immutable`，本地文件路径不一定带内容 hash。

### libsql connection lifecycle

当前 `createDefaultBackend()` 中 repository/historyRepository 是进程级 backend app 创建时建立，`close()` 中关闭。这个方向是对的。

不要在每个 request 内新建 libsql repository。

可补测试：

- `createDefaultBackend` 创建一次 repository。
- `close()` 调用 repository client close。

## 优先级

| Priority | Task | Expected impact | Risk |
|---|---|---:|---|
| P0 | 建立 build/chunk baseline | 防止误判 | Low |
| P1 | React Compiler annotation mode 试点 | 中高，减少重渲染 | Medium |
| P1 | 扩展 chunk audit，确认节点/重库不进首屏 | 高，保护首屏 | Low |
| P1 | backend incremental build | 中，改善开发构建 | Low |
| P2 | local file ETag / 304 | 中，改善图片预览重复加载 | Low |
| P2 | Zustand selector 热点收口 | 中，改善交互响应 | Medium |
| P2 | startTransition 用于搜索/筛选 | 中 | Low |
| P3 | package references 全量细化 | 中，工程量较大 | Medium |
| P3 | virtualization | 数据量大时高 | Medium |
| P3 | isolatedDeclarations | 长期收益，迁移成本高 | High |

## 建议 PR 拆分

### PR 1: measurement and compiler pilot

- 新增/扩展 build chunk audit。
- 接入 `babel-plugin-react-compiler` annotation mode。
- 给 1-3 个组件加 `"use memo"`。
- 验证 build/test。

### PR 2: backend compile and file cache

- `packages/backend/tsconfig.json` 加 incremental。
- `serveLocalFile` 加 ETag/304。
- 补后端测试。

### PR 3: bundle boundary cleanup

- 基于实际 build 结果决定是否调整 `manualChunks`。
- 不要无证据移除 `vendor-dockview` / `vendor-gridstack`。
- 扩展 `audit-build-chunks.ts` 保护节点 lazy chunks。

### PR 4: runtime hotspots

- 针对 profiler 结果优化 selectors。
- 对搜索/筛选引入 `startTransition`。
- 只在真实长列表处引入 virtualization。

## 验收命令

每个 PR 至少运行：

```powershell
bun run generate:node-registries
bun run typecheck
bun run test:unit
bun run build
```

涉及 packages/backend：

```powershell
bun --filter @xiranite/backend test
bun --filter @xiranite/backend build
```

涉及节点包/registry：

```powershell
bun run test:packages
bun run audit:node-architecture
```

## 不要做

- 不要把所有组件一次性全量开启 React Compiler。
- 不要移除现有 `nuqs` optimizeDeps exclude。
- 不要把动态节点 registry 改回静态 import。
- 不要仅凭 `manualChunks` 名字判断某库在首屏加载，必须看 `dist/index.html` 和浏览器 network。
- 不要在同一 PR 同时做 React Compiler、project references、manualChunks 大重排和运行时 selector 重构。
- 不要把 `isolatedDeclarations` 当作快速优化；它是后续类型质量工程。
