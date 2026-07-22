# React Compiler 手写 memo 清理分析

## 结论

React Compiler 在 Vite 生产构建中以 `infer` 模式启用，开发服务器默认关闭以降低冷启动和 HMR 转换成本。生产包内由 `src/**` 引入的 React 组件会自动获得编译器的细粒度 memo；新增代码不应再把 `useMemo`、`useCallback` 或 `React.memo` 当作默认模板。

不要一次性删除现有调用。它们可分为三类：纯渲染缓存可以逐步删除；为外部 API 提供引用稳定性的调用要逐项核实；未进入 Vite 浏览器构建的 CLI/TUI 包不在本次范围内。

## 扫描范围（2026-07-14）

命令：

```powershell
rg -n --glob '*.{ts,tsx}' 'useMemo\(|useCallback\(|React\.memo\(|\bmemo\(' src packages
```

| 项目 | 调用数 |
| --- | ---: |
| `useMemo` | 191 |
| `useCallback` | 191 |
| `React.memo` / `memo` | 19 |
| 浏览器端 `src/**` | 376 |
| `packages/**`（主要为 CLI/TUI） | 25 |
| 节点 UI `src/nodes/**` | 76 |

计数是调用点而非组件数；同一组件可包含多处调用。

## 第一批：可删除候选（低风险）

这些是只从 props/state 派生渲染数据的缓存。Compiler 会自动进行等价的细粒度缓存；删除时仍需保留普通变量和原有依赖数据流。

| 位置 | 当前用途 | 处理建议 |
| --- | --- | --- |
| `src/nodes/findz/Component.tsx` | `splitPaths(data.pathText)` | 删除 `useMemo`，改为普通局部变量 |
| `src/nodes/cleanf/Component.tsx`、`formatv/Component.tsx`、`gifu/Component.tsx` | 路径数量统计 | 删除 `useMemo` |
| `src/nodes/bandia/Component.tsx`、`classq/Component.tsx`、`classf/Component.tsx` | 文本拆分与派生树模型 | 逐组件删除并运行既有测试 |
| `src/nodes/coveru/Component.tsx`、`crashu/Component.tsx`、`encodeb/Component.tsx` | 输入路径与候选项派生 | 删除 `useMemo` |
| `src/nodes/kavvka/Component.tsx`、`linedup/Component.tsx`、`mvz/Component.tsx` | 输入文本解析/统计 | 删除 `useMemo` |
| `src/nodes/xlchemy/*.tsx` | 日志、列表、树和统计派生 | 分文件删除；这是节点目录中收益最高的批次 |
| `src/store/workspaceContext.tsx` | `useMemo(() => <>{children}</>, [children])` | 直接返回 fragment，无需手写 memo |
| `src/components/workspace/AlphabetNodeRail.tsx`、`WorkspaceUrlState.tsx` | 纯集合派生 | 删除 `useMemo` 后验证 UI 状态 |

这些候选中，`classf`、`classq` 和 `xlchemy` 包含较重的树/列表计算：先删除 memo 并通过测试，再用 Profiler 验证交互路径；不要以“保留 useMemo”作为默认预防措施。

`findz` 已从首批实际改动中暂缓：其现有组件测试在保留原始 memo 时仍会失败，测试期待“打开配置文件”而实际控件文案为“打开文件”。Bandia 也有同类的既有配置管理测试故障。应先单独修复这些测试，再继续移除该组件的 3 处纯派生 memo，避免将不相关的回归混入优化提交。

## 第二批：需要逐项核实（中风险）

| 范围 | 原因 | 建议 |
| --- | --- | --- |
| `src/hooks/useNodeConfig.ts` | `load` 同时被 `useEffect`、`reload` 使用 | 先让 Compiler 接管；删除前确认 Effect 的触发语义与测试覆盖 |
| `src/components/context-menu/ContextMenuProvider.tsx` | 回调被注册进 `Map` 和全局菜单协议 | 检查外部注册/注销是否要求引用恒等；不要批量删除 |
| `src/lib/compose-refs.ts` | 回调 ref 的引用稳定性属于 API 行为 | 保留，除非有专门的 ref 行为测试 |
| `src/components/data-table/**` | TanStack Table 回调和 columns 配置可能被库按引用识别 | 逐个表格流程验证后再改 |
| `src/components/views/ModuleRegistry.tsx` | 列定义和打开帮助回调被表格/外部组件消费 | 按模块核实 |

## 暂不删除（高风险或非本次编译范围）

1. `src/components/niko-table/**` 的 17 个左右 `React.memo` 边界：这是虚拟化、拖拽和大表格行渲染层。先保持现状，需在大数据量性能场景中证明无回归后再移除。
2. `src/components/workspace/ComponentCard.tsx` 的 `memo(ComponentCardInner)`：它处于工作区高频卡片边界，优先以 Profiler 验证后处理。
3. `packages/cli/**` 和 `packages/cli-runtime/**`：它们使用 OpenTUI/独立包构建链，未由当前 Vite React Compiler 配置直接编译。本轮不改。

## 执行顺序

1. 先处理第一批中的简单节点：每次 3–5 个组件，删除纯派生 `useMemo`。
2. 每批运行 `bun run typecheck`、对应节点测试和相关 Playwright 流程。
3. 用 React Profiler 对高频节点（`classf`、`classq`、`xlchemy`）核对 commit 时长与次数。
4. 仅当发现 Compiler 与组件/第三方库确有兼容问题时，在最小作用域加入：

```tsx
"use no memo"
```

不要用它来保留旧代码风格，也不要把它加到整个项目的入口文件。

## 新代码准则

- 普通派生值、事件处理器和子组件：先直接写；由 Compiler 推断优化。
- 只有明确的外部引用稳定性契约、实测热点，或 Compiler 兼容性诊断时，才引入手写 memo 或 `"use no memo"`。
- 每次删除手写 memo 都应是可测试的小批次，不能与功能变更混合。

## 2026-07-14：节点宿主边界策略

Vite 生产构建继续以 `compilationMode: "infer"` 启用 React Compiler，开发服务器默认关闭。节点 UI 不能直接套用生产编译策略：节点入口在渲染期通过稳定的 `host.state.getData()` 读取 workspace store，而该命令式读取不是 Compiler 可追踪的 React 输入。

因此，以下边界必须保留 `"use no memo"`：

- `src/components/modules/ModuleRenderer.tsx` 中的 `PackageNodeRenderer`；
- 每个 `src/nodes/*/Component.tsx` 的导出节点入口 `Component`。

这不是关闭整个项目的 Compiler：普通页面、节点内拆出的子组件、结果面板仍由 `infer` 自动编译。不要为恢复节点入口的 Compiler 优化而迁移 `NodeComponentProps` 或把 store data 改为 prop；当前契约继续保留 `getData()` 供渲染和异步回调读取最新快照。

在这些 opt-out 入口中，停止机械删除手写 memo。尤其保留第三方库所要求的引用稳定性：TanStack Table 的 `columns` / sorting / row selection，虚拟列表的数据与测量配置，树结构与展开/选择映射，以及拖拽 sensors 和回调。只有普通页面或独立子组件中的纯派生值，才继续按小批次、带测试地移除 memo。
