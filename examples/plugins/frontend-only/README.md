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

## 已知契约缺口

`AppNodeEntry.core` 目前是必填，但纯前端插件没有 core，宿主也不读它（全仓 `entry.core` 零消费）。
这里省略 core 而不是伪造一个，`core` 需要改为可选——已记在架构文档里。
