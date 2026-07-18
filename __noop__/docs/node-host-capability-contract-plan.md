# Xiranite NodeHostApi capability contract refactor plan

> 给实现 AI：这份文档是改造说明，不是讨论稿。目标是在不一次性打碎全部节点的前提下，把当前过胖的 `NodeHostApi` 拆成细粒度能力接口，增强组件数据类型安全，补上宿主契约版本协商，并为未来第三方节点隔离留下稳定入口。

## 当前问题定位

当前核心契约在 `packages/contract/src/index.ts`：

- `NodeHostApi` 同时包含状态、组件列表、组件更新、运行动作、剪贴板、下载、本地文件 URL、环境、TOML 配置、打开配置文件等能力。
- `getData<T>(compId)` 和 `patchData(compId, Record<string, unknown>)` 只靠调用处手写泛型约束，宿主无法知道节点真实 `data` 形状，也无法运行时校验。
- `NodeDef.version` 表示节点自身版本，但没有宿主 API 契约版本。宿主 API 变化时，旧节点可能只在运行时失败。
- `ModuleRenderer` 直接把节点组件渲染进主 React tree，没有 per-node Error Boundary，也没有第三方节点隔离策略。

主要落点：

- `packages/contract/src/index.ts`
- `src/components/modules/hostApi.ts`
- `src/components/modules/ModuleRenderer.tsx`
- `src/components/modules/packageModules.generated.ts`
- `scripts/generate-node-registries.ts`
- `src/nodes/*/entry.ts`
- `src/nodes/*/Component.tsx`
- 相关组件测试 `src/nodes/*/Component.test.tsx`

## 设计目标

1. 把 `NodeHostApi` 拆成多个命名能力域，类似 `vscode.commands` / `vscode.workspace`：
   - `contract`
   - `state`
   - `workspace`
   - `runner`
   - `clipboard`
   - `downloads`
   - `localFiles`
   - `config`
   - `env`
2. 节点通过 `entry.capabilities` 声明需要的能力，宿主按需注入。
3. 节点通过 schema 声明 `data` / `config` / 可选 `input` / `result` 形状，TypeScript 和运行时校验共用一份来源。
4. 宿主暴露 `contract.version`，节点声明兼容范围。渲染前失败要变成可诊断 UI，而不是静默崩溃。
5. 第一阶段保留兼容层，现有节点可以继续用旧 `host.getData` / `host.patchData`，但新节点和迁移后节点应使用 `host.state.getData()` / `host.state.patchData()`。
6. 增加节点渲染错误边界。样式隔离、iframe、Worker 作为后续能力，不在第一阶段强行完成。

## 推荐迁移策略

采用三阶段迁移，避免一次性修改 20+ 个节点导致噪音过大。

### Phase 1: contract + host compatibility

只改共享契约和宿主注入，不强制迁移所有节点。

在 `packages/contract/src/index.ts` 新增能力接口，并保留旧 `NodeHostApi` 为兼容别名/交叉类型。

建议目标类型：

```ts
export const NODE_HOST_CONTRACT_VERSION = "1.0.0" as const

export type NodeCapabilityId =
  | "contract"
  | "state"
  | "workspace"
  | "runner"
  | "clipboard"
  | "downloads"
  | "localFiles"
  | "config"
  | "env"

export interface NodeContractCapability {
  name: "xiranite.node-host"
  version: string
  supportedCapabilities: readonly NodeCapabilityId[]
  hasCapability: (capability: NodeCapabilityId) => boolean
}

export interface NodeStateCapability<TData extends Record<string, unknown> = Record<string, unknown>> {
  getData: () => TData | undefined
  patchData: (patch: Partial<TData>) => void
  replaceData?: (next: TData) => void
}

export interface NodeWorkspaceCapability {
  listComponents: () => HostComponentRef[]
  updateComponent: (compId: string, patch: Partial<HostComponentRef>) => void
}

export interface NodeRunnerCapability {
  run: <TInput = unknown, TData = unknown>(
    nodeId: string,
    input: TInput,
    onEvent?: (event: NodeRunEvent) => void,
  ) => Promise<NodeRunResult<TData>>
}

export interface NodeClipboardCapability {
  readText?: () => Promise<string>
  writeText?: (text: string) => Promise<void>
}

export interface NodeDownloadsCapability {
  text: (filename: string, content: string) => void
}

export interface NodeLocalFilesCapability {
  getUrl: (path: string) => string
}

export interface NodeConfigCapability<TConfig = unknown> {
  get: () => Promise<{ config: TConfig | undefined; path: string }>
  save: (config: TConfig) => Promise<void>
  openFile?: () => Promise<void> | void
}

export interface NodeEnvCapability {
  theme: "light" | "dark"
  platform: "web" | "electron" | "node" | string
}

export interface NodeHostCapabilities<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TConfig = unknown,
> {
  contract: NodeContractCapability
  state: NodeStateCapability<TData>
  workspace?: NodeWorkspaceCapability
  runner?: NodeRunnerCapability
  clipboard?: NodeClipboardCapability
  downloads?: NodeDownloadsCapability
  localFiles?: NodeLocalFilesCapability
  config?: NodeConfigCapability<TConfig>
  env: NodeEnvCapability
}

export type NodeHostApi<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TConfig = unknown,
> = NodeHostCapabilities<TData, TConfig> & {
  /**
   * Deprecated compatibility API. New components should use host.state.
   * Keep until all src/nodes/*/Component.tsx are migrated.
   */
  getData: <T = TData>(compId: string) => T | undefined
  patchData: (compId: string, patch: Partial<TData> & Record<string, unknown>) => void
  listComponents: () => HostComponentRef[]
  updateComponent: (compId: string, patch: Partial<HostComponentRef>) => void
  actions?: { run?: NodeRunnerCapability["run"] }
  downloadText?: (filename: string, content: string) => void
  getNodeConfig?: <T = TConfig>() => Promise<{ config: T | undefined; path: string }>
  saveNodeConfig?: <T = TConfig>(config: T) => Promise<void>
  openConfigFile?: () => Promise<void> | void
}

export interface NodeComponentProps<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TConfig = unknown,
> {
  compId: string
  host: NodeHostApi<TData, TConfig>
}
```

宿主实现落点：`src/components/modules/hostApi.ts`。

要求：

- `useNodeHostApi(compId, nodeId)` 返回新能力域。
- 旧字段仍映射到新能力域，避免马上改完全部节点。
- `state.getData()` 内部绑定当前 `compId`，新 API 不再要求节点自己传 `compId`。
- `config.get()` / `config.save()` 内部绑定当前 `nodeId`。
- `contract.supportedCapabilities` 根据实际注入能力生成。

兼容映射示例：

```ts
const host = {
  contract,
  state: {
    getData: () => getWorkspaceState().components.find((c) => c.id === compId)?.data as TData | undefined,
    patchData: (patch) => workspaceActions.patchComponentData(compId, patch),
  },
  runner: { run: runNodeOnLocalBackend },
  clipboard: { readText: ..., writeText: ... },
  downloads: { text: downloadText },
  localFiles: { getUrl: localBackendFileUrl },
  config: { get, save, openFile },
  env,

  // deprecated compatibility
  getData: (_id) => host.state.getData(),
  patchData: (_id, patch) => host.state.patchData(patch),
  actions: { run: host.runner.run },
  downloadText: host.downloads.text,
  getNodeConfig: host.config.get,
  saveNodeConfig: host.config.save,
  openConfigFile: host.config.openFile,
}
```

### Phase 2: typed schemas on entries

Add schema metadata to `NodeEntry`, then migrate nodes gradually.

The repo already has `zod` in root dependencies, and `packages/shared` uses it. For package authors, prefer Zod schemas exported from each node UI/types module or node core module. To avoid forcing `@xiranite/contract` to hard depend on Zod internals, use a tiny parse-compatible schema interface in contract:

```ts
export interface NodeSchema<T> {
  parse: (value: unknown) => T
  safeParse?: (value: unknown) => { success: true; data: T } | { success: false; error: unknown }
}

export interface NodeSchemas<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TConfig = unknown,
  TInput = unknown,
  TResult = unknown,
> {
  data?: NodeSchema<TData>
  config?: NodeSchema<TConfig>
  input?: NodeSchema<TInput>
  result?: NodeSchema<TResult>
}

export interface NodeHostRequirements {
  contractVersion?: string
  capabilities?: readonly NodeCapabilityId[]
}

export interface AppNodeEntry<
  TCore extends Record<string, unknown> = Record<string, unknown>,
  TData extends Record<string, unknown> = Record<string, unknown>,
  TConfig = unknown,
> extends HeadlessNodePackage<TCore> {
  Component: NodeComponent<TData, TConfig>
  host?: NodeHostRequirements
  schemas?: NodeSchemas<TData, TConfig>
}
```

Update `NodeComponent` type:

```ts
export type NodeComponent<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TConfig = unknown,
> = (props: NodeComponentProps<TData, TConfig>) => unknown
```

Example migrated node entry:

```ts
import { z } from "zod"
import type { AppNodeEntry } from "@xiranite/contract"
import { def } from "@xiranite/node-findz"
import * as core from "@xiranite/node-findz/core"
import { Component } from "./Component"

export const findzDataSchema = z.object({
  pathText: z.string().optional(),
  where: z.string().optional(),
  logs: z.array(z.string()).optional(),
  progress: z.number().optional(),
}).passthrough()

export type FindzCardState = z.infer<typeof findzDataSchema>

const entry = {
  def,
  core,
  Component,
  host: {
    contractVersion: "^1.0.0",
    capabilities: ["state", "runner", "clipboard", "config", "env"],
  },
  schemas: {
    data: findzDataSchema,
    config: findzDataSchema.partial(),
  },
} satisfies AppNodeEntry<typeof core, FindzCardState, Partial<FindzCardState>>

export default entry
```

Implementation notes:

- If a node already has `types.ts`, put schema next to those types or replace hand-written card state with `z.infer`.
- Use `.passthrough()` during migration so old persisted data fields do not disappear.
- Once all fields are known, tighten schemas in a later PR.
- Do not import app-only `@/` modules from `packages/nodes/*`.

### Phase 3: rendering guardrails and isolation

Update `src/components/modules/ModuleRenderer.tsx`.

Required first step: add Error Boundary around every package node render.

Suggested structure:

```tsx
<NodeRenderBoundary moduleId={moduleId}>
  <PackageComponent compId={compId} host={host} />
</NodeRenderBoundary>
```

`NodeRenderBoundary` should:

- catch render errors from a single node;
- show compact error UI with module id and error message;
- not crash the entire workspace;
- expose a reset action by changing a local `boundaryKey` or remounting the node.

Before rendering a node:

- inspect `entry.host?.contractVersion`;
- inspect `entry.host?.capabilities`;
- compare against `host.contract.version` and `host.contract.supportedCapabilities`;
- if unsupported, render a diagnostic fallback instead of the node.

Use `semver` only if already present. If not, implement a minimal first pass:

- exact `"1.0.0"` match;
- caret range `"^1.0.0"` allows same major version;
- missing range means legacy compatible.

Later isolation tiers:

1. `trusted`: current direct React render with Error Boundary.
2. `contained`: direct React render plus CSS containment wrapper (`contain: layout paint style; isolation: isolate;`).
3. `iframe`: third-party node rendered in iframe bridge.
4. `worker`: non-UI core/platform tasks behind worker or local backend RPC.

Do not implement iframe/worker in the first PR unless explicitly requested. Add the type field now if useful:

```ts
export type NodeIsolationMode = "trusted" | "contained" | "iframe" | "worker"

export interface NodeHostRequirements {
  contractVersion?: string
  capabilities?: readonly NodeCapabilityId[]
  isolation?: NodeIsolationMode
}
```

## Node migration pattern

For each `src/nodes/<id>/Component.tsx`:

1. Change props type from `NodeComponentProps` to `NodeComponentProps<<Id>CardState, Partial<<Id>CardState>>`.
2. Replace:

```ts
const data = host.getData<CardState>(compId) ?? {}
host.patchData(compId, patchData)
host.actions?.run
host.downloadText?.(...)
host.localFiles?.getUrl?.(...)
host.getNodeConfig?.<Partial<CardState>>()
host.saveNodeConfig?.(config)
host.openConfigFile
```

with:

```ts
const data = host.state.getData() ?? {}
host.state.patchData(patchData)
host.runner?.run
host.downloads?.text(...)
host.localFiles?.getUrl(...)
host.config?.get()
host.config?.save(config)
host.config?.openFile
```

3. Keep optional checks for capabilities that may not exist:

```ts
const run = host.runner?.run
if (!run) {
  host.state.patchData({ phase: "error", progressText: "Native action is unavailable in this host." })
  return
}
```

4. Update tests to build host mocks using the new capability domains. During migration, tests can keep compatibility aliases too.

## Generator updates

Check `scripts/generate-node-registries.ts`.

Requirements:

- Generated metadata should include `NodeDef` as before.
- Dynamic entry loaders should preserve `AppNodeEntry` generics where possible.
- If static metadata extraction currently assumes only `def` and `core`, make sure optional `host` and `schemas` fields do not break generation.
- Do not serialize Zod schemas into generated metadata. Schemas stay on the lazy-loaded entry.

## Runtime validation behavior

When `schemas.data` exists:

- `state.getData()` should parse persisted component data before returning it.
- On parse failure, do not throw inside normal render. Return a safe empty object and expose diagnostics through console warning or a future UI warning.
- `state.patchData(patch)` should validate the merged next state in development/test. In production, prefer warning + pass-through during the migration period.

Possible helper in app layer:

```ts
function parseWithSchema<T>(schema: NodeSchema<T> | undefined, value: unknown, fallback: T): T {
  if (!schema) return (value ?? fallback) as T
  const result = schema.safeParse?.(value)
  if (result) return result.success ? result.data : fallback
  try {
    return schema.parse(value)
  } catch {
    return fallback
  }
}
```

Important: avoid putting Zod-specific logic into node components. Components should benefit from typed `host.state`, not manually parse persisted data every render.

## Backward compatibility rules

- Do not remove old `host.getData`, `host.patchData`, `host.actions`, `host.downloadText`, `host.getNodeConfig`, `host.saveNodeConfig`, or `host.openConfigFile` in the first PR.
- Mark legacy fields with `@deprecated` comments.
- New code should use capability domains only.
- Migrate 1-2 representative nodes first (`findz` and `enginev` are good because they use runner/config/localFiles), then batch the rest.
- Remove compatibility aliases only after all `src/nodes/*/Component.tsx` and tests stop using them.

## Tests to add

Add or update tests in the smallest sensible places:

- `packages/contract`: type-level compile coverage if the package has type tests; otherwise rely on `tsc`.
- `src/components/modules/hostApi` test if existing test setup allows hook testing. Verify:
  - `host.state.getData()` reads current component data;
  - `host.state.patchData()` patches current component without requiring `compId`;
  - legacy `host.getData(compId)` still works;
  - `host.contract.hasCapability("runner")` reflects injected runner.
- `ModuleRenderer` test:
  - unsupported capability renders diagnostic fallback;
  - component render throw is caught by Error Boundary.
- One migrated node component test:
  - uses `host.state.patchData`;
  - uses `host.runner.run`;
  - still handles missing runner gracefully.

## Validation commands

Run from repo root:

```powershell
bun run generate:node-registries
bun --filter @xiranite/contract build
bun run typecheck
bun run test:unit
bun run test:packages
bun run build
```

If only one node is migrated first:

```powershell
bun --filter @xiranite/node-findz test
bun --filter @xiranite/node-findz build
bun scripts/validate-node-architecture.ts --node findz
```

Also run targeted search before considering migration complete:

```powershell
rg -n "host\.getData|host\.patchData|host\.actions|downloadText|getNodeConfig|saveNodeConfig|openConfigFile" src/nodes
rg -n "contractVersion|capabilities|schemas" src/nodes packages/contract/src src/components/modules
rg -n "ErrorBoundary|componentDidCatch|NodeRenderBoundary" src/components/modules
```

## Acceptance criteria

The work is complete when:

- `NodeHostApi` exposes capability domains and contract metadata.
- `useNodeHostApi` injects domains and legacy aliases.
- `AppNodeEntry` supports `host.capabilities`, `host.contractVersion`, and `schemas`.
- At least one representative node is migrated to typed `NodeComponentProps<TData, TConfig>` and capability domains.
- `ModuleRenderer` prevents one crashing node from crashing the workspace.
- Unsupported host contract/capability produces visible diagnostic UI.
- Existing nodes still build and render through the compatibility layer.
- Full validation commands pass, or any remaining failure is documented with exact cause.

## Do not do in this refactor

- Do not move native filesystem/shell/network work into `Component.tsx`.
- Do not import `@/` app modules from `packages/nodes/*`.
- Do not make `@xiranite/contract` depend on app state, backend clients, React DOM, or Xiranite store.
- Do not remove compatibility APIs until every node is migrated.
- Do not implement iframe/Worker isolation in the same PR unless the user explicitly asks for third-party runtime execution now.
