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

打开（dev 下多页面的真实 URL 带 `/src/entrypoints/` 前缀；直接敲 `/plugin-host.html` 会被 SPA 回退
静默加载成主应用，页面标题是唯一线索）：

```
http://localhost:5173/src/entrypoints/plugin-host.html?plugin=poc_frontend&entry=http://127.0.0.1:4173/mf-manifest.json&type=module
```

`plugin` 必须等于 remote `mf-manifest.json` 里的 `name`（本工程是 `poc_frontend`，下划线）；
`vite preview` 若端口被占会自己往上跳，`entry` 按它打印的实际端口填。

能力授权也从 query 传（`docs/plugin-architecture.md` §2.4 的三层里，安装方那一格今天还没有 UI）：

| 参数 | 效果 |
| --- | --- |
| 不写 `capabilities` | **默认拒绝**：插件只拿到 `contract`，`host.env` 是 `undefined`（面板会打 `unknown`） |
| `capabilities=state,env` | 授权到天花板内的这两项，插件里 `host.env.theme` 变 `light` |
| `capabilities=runner` | 被拒并在页面上打 `refused=[runner]`——`runner` 今天不在天花板内（§10.3 第 1 条的插件级凭证没做） |
| `trust=internal` | 内部 trusted 路径：拿完整 `NodeHostApi`（阶段二/三那些示范需要这条） |

资源完整性与来源限制（MF 自己没有的那两件）：

```sh
bun scripts/plugin-integrity.ts http://127.0.0.1:4176/mf-manifest.json http://127.0.0.1:4176/remoteEntry.js
```

把打印出来的两行拼成 `&pin=<url>|<sha384-…>`（可重复）与 `&origin=<origin>`（可重复）加到 URL 上。
pin 对了插件照常渲染；**故意改错一位**会让页面直接打「插件资源校验失败：integrity mismatch …」并且
不加载该 remote——这条改错就是那把尺的阳性对照。注意只有被 pin 的 URL 受保护，remote 的异步 chunk
不在内（要全覆盖得逐文件 pin）。

装过一次之后，记录就留在宿主里（`localStorage` 的 `xiranite.frontendPlugins`），**再打开不需要带
任何 URL 参数**：

```
http://localhost:5173/src/entrypoints/plugin-host.html?module=poc_frontend
```

页面会标「来自已安装记录（未带 URL 参数）」，来源、pin、能力授权全部跟着记录走。产品入口
`src/main.tsx` 启动时调的是同一个 `activateInstalledFrontendPlugins()`，所以主应用里也一样能加载。

想让它**作为新模块出现在模块库/A–Z 栏里**（而不是顶替某个内置节点），安装时再带一条贡献：

```
&module=poc_frontend.panel&contributes=poc_frontend.panel|POC%20PANEL
```

`contributes=<id>[|显示名]` 可重复；只有 `component` 这一类今天有消费者，`tray`/`window` 会被记一条
note 并忽略，其它 kind 在安装期就被拒。与内置 id 撞车的贡献不会多出第二行。

面板会打印它自己解析到的 `react` 版本与宿主授予的能力名。两处判据：

1. **React 单实例**：`useState` 能工作就说明没拿到第二份 React（两份会直接 `Invalid hook call`）；
   打印的版本应与宿主一致。
2. **懒加载**：`registerRemotes` 只登记 URL，不取字节；只有渲染该模块时才抓
   `mf-manifest.json` / `remoteEntry.js`（Network 面板可证）。

## 宿主侧接线位置

- `src/plugins/frontendRuntime.ts`：唯一的 MF 实例 + 宿主 shared 注入。
- `src/plugins/dynamicEntries.ts`：`resolveEntryLoader(moduleId)`，**绑定的 remote 优先、静态表兜底**
  （顺序就是语义：`moduleId` 同时是打后端用的 nodeId）。
- `src/plugins/frontendHost.ts`：能力投影（声明 ∩ 天花板 → 只带授权到的命名空间 + 如实的
  `contract.supportedCapabilities`）。
- `src/components/modules/ModuleRenderer.tsx`：原先两处直接下标生成表的地方，现在走上面这个解析器，
  并在把 host 交给组件前过一次投影。`AppNodeEntry` / `Component.tsx` / `NodeHostApi` 的形状都没改——
  变的是 entry 从哪来、以及插件能看见多少。

## 这个 POC 故意没做的东西

PluginManager（install/update/registry）、`.xplugin` 容器、`manifest.toml` 解析。入口 URL 从 query 传，是因为要先证明「外部构建的 remote 能不能在
这个 realm 里跑」；那几件事在 `docs/plugin-architecture.md` §10 里有排期理由。

## 契约状态

`AppNodeEntry.core` 已改为可选（`packages/contract/src/index.ts`）：`HeadlessNodePackage.core` 仍然必填
（节点包没有 core 就是坏包），只有 GUI 侧的 entry 允许缺。本示例因此可以省略 core 而不伪造一个。
宿主代码里没有任何路径读 `entry.core`；唯一的读者是节点自己的测试（例如
`src/nodes/clipm/entry.browser.test.tsx` 断言它打包的 core 仍可达），该断言已改成可选链、core 缺失照旧失败。

`manifest.toml` 已随清单格式迁移补在本目录（`manifest.toml`）：那是 Xiranite 侧的声明，`dist/mf-manifest.json`
是 MF runtime 自己的 metadata，两者职责不同。今天还没有读它的 Plugin Manager，所以它是**声明文件**，
不是已接通的开关。
