# 前端节点配置统一方案

> CLI 侧 14 个节点已完成 TOML 统一改造，但前端节点 UI 仍通过 `host.getData/patchData` 把所有输入、输出、日志混存在 `comp.data` 中，没有"默认配置"概念。本文档定义前端如何接入 `xiranite.config.toml` 体系，与 CLI 保持一致。

## 现状问题

1. **无 config 路由**：backend API 仅有 13 个 endpoint（nodes/workspace/operations），没有 `/config` 路由。
2. **无 ConfigService**：services 层只有 `WorkspaceService` 和 `NodeRunnerService`。
3. **@xiranite/config 包仅限 Node 环境**：依赖 `node:fs/promises`、`node:os`，浏览器端不能直接使用。
4. **节点 Component 无配置分层**：所有数据（路径输入、执行结果、日志、临时参数）混在 `comp.data` 中，用户无法保存/恢复默认参数。
5. **前端与 CLI 配置割裂**：CLI 读写 `xiranite.config.toml [nodes.<id>]`，前端完全不感知这个文件。

## 设计目标

- `xiranite.config.toml` 是人工配置主源，前端不直接读写文件，通过 backend config service 读写。
- 节点 UI 只关心自己的 section（`nodes.<nodeId>`），不感知其他节点配置。
- 区分"本次输入"（`comp.data`）和"默认配置"（TOML），用户可保存/恢复默认值。
- 运行结果、日志、history 不进 TOML，继续存 `comp.data` 或 DB。
- 节点包保持独立可用：不引入 `@/store/*`、`@/components/*` 等应用层依赖。

## 三层架构

```text
┌─────────────────────────────────────────────────────┐
│  Node Component (packages/nodes/*/Component.tsx)     │
│  显示配置 + 提供保存/恢复/打开配置文件                │
│  通过 host.getNodeConfig / host.saveNodeConfig        │
├─────────────────────────────────────────────────────┤
│  Frontend Hook (src/hooks/useNodeConfig.ts)          │
│  useNodeConfig(nodeId) → { config, save, reset }      │
│  合并优先级: comp.data > nodes.<id> > 包默认值         │
├─────────────────────────────────────────────────────┤
│  Config Service (packages/services + packages/api)   │
│  GET /config/nodes/:id    → 读取节点配置              │
│  PUT /config/nodes/:id    → 写入节点配置              │
│  GET /config/path          → 获取配置文件路径           │
│  POST /config/import-legacy → 导入旧配置文件           │
│  内部调用 @xiranite/config 包                         │
└─────────────────────────────────────────────────────┘
```

## 第一层：Config Service（backend 侧）

### 新增 API 路由

在 `packages/api/src/index.ts` 中新增 4 个 endpoint：

```text
GET    /config                       返回完整 xiranite.config.toml 解析结果
GET    /config/path                   返回配置文件路径
GET    /config/nodes/:nodeId          返回 [nodes.<nodeId>] 段
PUT    /config/nodes/:nodeId          写入/合并 [nodes.<nodeId>] 段
POST   /config/import-legacy          从旧配置文件导入
```

### 新增 ConfigService

在 `packages/services/src/` 中新增 `configService.ts`：

```ts
export interface ConfigService {
  /** 读取完整配置 */
  getConfig(): Promise<{ config: XiraniteConfig; path: string }>
  /** 读取单个节点配置 */
  getNodeConfig(nodeId: string): Promise<{ config: unknown | undefined; path: string }>
  /** 写入单个节点配置（merge 语义） */
  updateNodeConfig(nodeId: string, patch: unknown): Promise<{ config: unknown; path: string }>
  /** 获取配置文件路径 */
  getConfigPath(): string
  /** 从旧配置文件导入 */
  importLegacy(legacyPath: string, nodeId: string): Promise<{ imported: boolean; config: unknown }>
}
```

内部直接调用 `@xiranite/config` 包的 `loadXiraniteConfig` / `saveXiraniteConfig` / `getNodeConfig` / `updateNodeConfig`。

### 新增 API client

在 `packages/api/src/client.ts` 中新增 `createXiraniteConfigClient`：

```ts
export function createXiraniteConfigClient(baseUrl: string, options?: { token?: string }) {
  return createXiraniteApp(baseUrl, options).config
}
```

## 第二层：Frontend Hook

### useNodeConfig

在 `src/hooks/useNodeConfig.ts` 中新增：

```ts
export interface UseNodeConfigResult<TConfig> {
  /** 当前生效配置（已合并 comp.data 覆盖值） */
  config: TConfig | undefined
  /** 从 TOML 读取的节点默认配置 */
  defaults: TConfig | undefined
  /** 是否有未保存的变更（comp.data 中存在覆盖字段） */
  isDirty: boolean
  /** 保存当前输入为默认值（写入 TOML） */
  saveAsDefault: (config: TConfig) => Promise<void>
  /** 从 TOML 恢复默认值到 comp.data */
  restoreDefault: () => Promise<void>
  /** 重置 comp.data 中的配置字段（清除覆盖） */
  resetOverride: () => void
  /** 打开配置文件（调用 host.platform.openPath） */
  openConfigFile: () => void
  /** 配置文件路径 */
  configFilePath: string | undefined
}

export function useNodeConfig<TConfig>(
  compId: string,
  nodeId: string,
  options?: {
    /** 标记 comp.data 中哪些字段属于"配置覆盖" */
    configFields?: (keyof TConfig)[]
  },
): UseNodeConfigResult<TConfig>
```

### 合并优先级

```text
1. comp.data 中的配置字段（本次运行覆盖）
2. xiranite.config.toml 的 [nodes.<nodeId>]（默认配置）
3. 节点包内导出的默认值（DEFAULT_CONFIG）
```

加载时机：

```text
Component mounted
  ↓
读取 comp.data
  ↓
如果配置字段为空，调用 GET /config/nodes/<nodeId>
  ↓
合并 comp.data 覆盖 → TOML 默认值 → 包默认值
  ↓
用户修改只改 comp.data
  ↓
点击"保存为默认"才写 TOML
```

### NodeHostApi 扩展

在 `packages/contract/src/index.ts` 的 `NodeHostApi` 中新增：

```ts
export interface NodeHostApi {
  // ... 现有成员 ...

  /** 读取节点默认配置（从 xiranite.config.toml） */
  getNodeConfig?: <T = unknown>() => Promise<{ config: T | undefined; path: string }>
  /** 保存节点默认配置（写入 xiranite.config.toml） */
  saveNodeConfig?: <T = unknown>(config: T) => Promise<void>
  /** 打开配置文件 */
  openConfigFile?: () => void
}
```

节点包通过 `host.getNodeConfig?.()` / `host.saveNodeConfig?.()` 访问，可选实现，不破坏现有接口。

## 第三层：Node Component

### 节点 UI 配置按钮

每个节点 Component 顶部或设置区新增一个"默认值"按钮：

```text
┌──────────────────────────────┐
│ [默认值 ▼]                    │
│   使用全局默认                 │
│   保存当前输入为默认            │
│   重置本节点默认                │
│   打开配置文件                  │
└──────────────────────────────┘
```

- **使用全局默认**：清除 `comp.data` 中的配置覆盖字段，回退到 TOML 默认值。
- **保存当前输入为默认**：将 `comp.data` 中的配置字段写入 `xiranite.config.toml [nodes.<nodeId>]`。
- **重置本节点默认**：删除 `xiranite.config.toml [nodes.<nodeId>]` 段，恢复到包默认值。
- **打开配置文件**：在系统默认编辑器中打开 `xiranite.config.toml`。

### 节点 UI 层级划分

```text
本次运行输入 (comp.data)
  ├─ 配置字段（path, target, workshop_root, ...）    ← 可保存到 TOML
  ├─ 执行结果 (result, links, wallpapers, ...)       ← 不进 TOML
  ├─ 运行日志 (logs, phase, progress, ...)           ← 不进 TOML
  └─ UI 临时态 (running, collapsed, ...)             ← 不进 TOML

默认配置 (xiranite.config.toml [nodes.<nodeId>])
  ├─ 默认路径
  ├─ 默认参数
  ├─ 映射表 / 链接记录
  └─ 行为开关 (enable_undo, dry_run, ...)
```

### 各节点配置字段映射

| 节点 | comp.data 中的配置字段 | TOML `[nodes.<id>]` 段 |
| --- | --- | --- |
| linku | `path`, `target`, `configPath` | `links[]`, 无额外默认 |
| owithu | `configText`, `hive`, `onlyKey` | `entries[]` |
| scoolp | `configText`, `packageName`, `dryRun` | `sync.enabled`, `sync.bucket` |
| lata | `taskfilePath`, `taskName` | `taskfile` |
| enginev | `workshopPath`, `outputPath`, `template` | `workshop_root`, `export_path`, `export_format` |
| repacku | `rootPath`, `outputDir` | `default_root`, `output_dir`, `types[]` |
| bandia | `mappingFile` | `mappings[]` |
| seriex | `similarity`, `prefix` | `similarity`, `prefix` |
| trename | `undoEnabled` | `enable_undo`, `history_path` |
| migratef | `undoEnabled` | `enable_undo`, `history_path` |
| dissolvef | `undoEnabled` | `enable_undo`, `history_path` |
| marku | `undoEnabled` | `enable_undo`, `history_path` |
| crashu | `outputDir` | `output.directory`, `output.format` |
| formatv | `outputDir` | `output.directory`, `output.overwrite` |
| findz | `outputDir`, `outputFormat` | `output.directory`, `output.format`, `defaults` |

### 节点包导出默认配置

每个节点包在 `core.ts` 或新增 `config.ts` 中导出：

```ts
// packages/nodes/linku/src/core.ts
export const LINKU_DEFAULT_CONFIG = {
  // 无额外默认；links 为空数组
}

// packages/nodes/enginev/src/core.ts
export const ENGINEV_DEFAULT_CONFIG = {
  workshop_root: "",
  export_path: "",
  export_format: "json",
}
```

前端 hook 在 TOML 无配置时使用此默认值。

## 实施步骤

### 阶段一：Backend Config Service（前置）

1. 在 `packages/services/src/` 新增 `configService.ts`，实现 `ConfigService` 接口。
2. 在 `packages/services/src/index.ts` 的 `XiraniteServices` 中加入 `config: ConfigService`。
3. 在 `packages/api/src/index.ts` 新增 4 个 `/config` 路由。
4. 在 `packages/api/src/client.ts` 新增 `createXiraniteConfigClient`。
5. 测试：`GET /config/nodes/linku` 返回 `nodes.linku` 段；`PUT` 写入后 `GET` 能读回。

### 阶段二：Frontend Hook + HostApi 扩展

1. 在 `src/backend/configRpcClient.ts` 新增 RPC client，调用 `createXiraniteConfigClient`。
2. 在 `src/hooks/useNodeConfig.ts` 实现 `useNodeConfig` hook。
3. 在 `src/components/modules/hostApi.ts` 扩展 `NodeHostApi`，注入 `getNodeConfig` / `saveNodeConfig` / `openConfigFile`。
4. 在 `packages/contract/src/index.ts` 的 `NodeHostApi` 接口中新增可选方法签名。
5. 测试：hook 能正确读取、合并、写入配置。

### 阶段三：节点 Component 改造

按优先级分批：

**第一批（有配置文件的节点，收益最高）**：
- `linku` — 链接记录从 TOML 读取展示
- `owithu` — TOML 配置文本预览/编辑
- `scoolp` — sync 配置展示
- `lata` — taskfile 路径

**第二批（有默认参数的节点）**：
- `enginev` — workshop_root / export_path / template
- `repacku` — default_root / output_dir
- `bandia` — mappings 展示
- `seriex` — similarity / prefix

**第三批（undo/history 节点）**：
- `trename` / `migratef` / `dissolvef` / `marku` — enable_undo 开关

**第四批（产物节点）**：
- `crashu` / `formatv` / `findz` — output.directory / format

### 阶段四：UI 组件

1. 在 `packages/ui/src/index.tsx` 新增 `NodeConfigButton` 组件（DropdownMenu 样式）。
2. 每个节点 Component 在 `NodeHeader` 区域放置 `NodeConfigButton`。
3. 提供 dirty state 提示（有未保存的配置覆盖时高亮）。

## 配置加载时序

```text
1. 节点 Component mounted
2. useNodeConfig 调用 GET /config/nodes/<nodeId>
3. 合并: comp.data 配置字段 > TOML 默认值 > 包默认值
4. 渲染 UI
5. 用户修改输入 → patchComponentData (只改 comp.data)
6. 用户点击"保存为默认" → PUT /config/nodes/<nodeId>
7. TOML 写入成功 → 更新 defaults → isDirty = false
```

## 与 CLI 的一致性

- 前端和 CLI 读写同一个 `xiranite.config.toml` 文件。
- 前端通过 backend HTTP 调用 `@xiranite/config`，CLI 直接 `import`。
- 配置路径解析逻辑完全相同（`resolveXiraniteConfigPath` 四级优先级）。
- 前端写入后，CLI 下次运行自动读到最新配置；反之亦然。

## DB 同步策略（后续）

文档 `node-config-toml-strategy.md` 中规划的 DB 同步（`config_snapshots` / `node_runtime_state` 表）在本方案之后实施：

1. backend 启动时解析 TOML 写入 DB 镜像。
2. 前端可优先从 DB 读取（更快），TOML 为 fallback。
3. 写入时双写（TOML + DB）。
4. 检测 TOML mtime 变化时自动刷新 DB 镜像。

本阶段不实现 DB 同步，前端直接通过 HTTP 读写 TOML 文件。

## 明确不要做的事

1. **不要让节点包直接依赖 `@xiranite/config`** — 节点包通过 `host.getNodeConfig` 间接访问。
2. **不要把执行结果/日志写进 TOML** — 只写用户可编辑的配置参数。
3. **不要在 Component mount 时自动写入 TOML** — 只在用户显式操作时写。
4. **不要让所有 comp.data 字段都同步到 TOML** — 只有标记为"配置字段"的才同步。
5. **不要在节点包里直接 fetch `/config`** — 通过 `host` 接口走，保持节点包环境无关。
6. **不要破坏现有 `NodeHostApi` 接口** — 新方法全部可选。
