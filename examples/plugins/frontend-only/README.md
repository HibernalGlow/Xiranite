# frontend-only 示例插件（POC）

一个**在本仓之外构建**的前端插件：它有自己的 `package.json`、lock 与 `node_modules`，不在根
workspace 里（根 workspace 只收 `packages/*` 与 `packages/nodes/*`）。Xiranite 在运行时通过
Module Federation 加载它，加载一个插件不需要重新构建 Xiranite。

## 构建并本地提供

```sh
cd examples/plugins/frontend-only
bun install
bun run build            # 产出 dist/mf-manifest.json 与 dist/remoteEntry.js
bun run serve            # 127.0.0.1:4173，带 CORS（ESM remote 需要）
```

## 在宿主里加载

```sh
bun run dev              # 宿主 Vite dev server
```

打开：

```
http://localhost:5173/plugin-host.html?plugin=poc-frontend&entry=http://127.0.0.1:4173/mf-manifest.json
```

面板会打印它自己解析到的 `react` 版本与宿主授予的能力名。两处判据：

1. **React 单实例**：`useState` 能工作就说明没拿到第二份 React（两份会直接 `Invalid hook call`）；
   打印的版本应与宿主一致。
2. **懒加载**：`registerRemotes` 只登记 URL，不取字节；只有渲染该模块时才抓
   `mf-manifest.json` / `remoteEntry.js`（Network 面板可证）。

## 宿主侧接线位置

- `src/plugins/frontendRuntime.ts`：唯一的 MF 实例 + 宿主 shared 注入。
- `src/plugins/dynamicEntries.ts`：`resolveEntryLoader(moduleId)`，静态表优先、其次远程。
- `src/components/modules/ModuleRenderer.tsx`：原先两处直接下标生成表的地方，现在走上面这个解析器。
  `AppNodeEntry` / `Component.tsx` / `NodeHostApi` 的形状都没改——变的是 entry 从哪来。

## 这个 POC 故意没做的东西

PluginManager（install/update/registry）、`.xplugin` 容器、`manifest.toml` 解析、capability
过滤后的 `XiraniteFrontendHost`。入口 URL 从 query 传，是因为要先证明「外部构建的 remote 能不能在
这个 realm 里跑」；那几件事在 `docs/plugin-architecture.md` §10 里有排期理由。

## 契约状态

`AppNodeEntry.core` 已改为可选（`packages/contract/src/index.ts`）：`HeadlessNodePackage.core` 仍然必填
（节点包没有 core 就是坏包），只有 GUI 侧的 entry 允许缺。本示例因此可以省略 core 而不伪造一个。
宿主代码里没有任何路径读 `entry.core`；唯一的读者是节点自己的测试（例如
`src/nodes/clipm/entry.browser.test.tsx` 断言它打包的 core 仍可达），该断言已改成可选链、core 缺失照旧失败。

`manifest.toml` 已随清单格式迁移补在本目录（`manifest.toml`）：那是 Xiranite 侧的声明，`dist/mf-manifest.json`
是 MF runtime 自己的 metadata，两者职责不同。今天还没有读它的 Plugin Manager，所以它是**声明文件**，
不是已接通的开关。
