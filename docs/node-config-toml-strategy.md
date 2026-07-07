# Xiranite 节点明文配置统一方案

本文档用于指导后续模型/开发者改造 24 个节点的明文配置读取方式。目标不是把所有 JSON/YAML/TOML 文件无脑塞进一个 TOML，而是建立一个清晰、可维护、适合独立 CLI 与 Xiranite 集成共用的配置模型。

## 目标

1. 保留用户可直接编辑的明文配置能力。
2. 所有节点共享一个主配置文件，避免 `cwd/linku.toml`、`~/.migratef/undo.json` 这类分散状态。
3. 独立 CLI 不必启动 backend，也不必直接读数据库。
4. Xiranite 集成模式和独立 CLI 模式读取同一套配置。
5. 数据库作为备份、索引、运行缓存和 UI 查询层，不作为节点 CLI 的唯一配置源。

## 推荐目录结构

默认将主配置文件放在数据库同目录：

```text
<xiranite-data-dir>/
  xiranite.db
  xiranite.config.toml
```

便携模式可使用：

```text
./data/
  xiranite.db
  xiranite.config.toml
```

## 配置路径解析优先级

所有节点 CLI 与 Xiranite backend 应使用统一 resolver：

```text
--config <path>
XIRANITE_CONFIG_PATH
XIRANITE_DATABASE_PATH 同目录 / xiranite.config.toml
XIRANITE_DATA_DIR / xiranite.config.toml
系统标准目录 / Xiranite / xiranite.config.toml
```

不要再默认读取节点包目录、`dist` 目录或任意 `process.cwd()` 下的散装配置文件，除非这是用户显式传入的路径。

## 核心原则

### TOML 是人工配置主入口

`xiranite.config.toml` 只放“用户会手动维护、希望跨 CLI/前端共享”的配置。

适合放入 TOML：

- 默认路径
- 节点默认参数
- 用户维护的映射表
- 可读的规则列表
- 是否启用某个节点能力
- 小型、稳定、可编辑的记录

不适合放入 TOML：

- 大型扫描结果
- 运行日志
- 缓存索引
- undo/history 明细大数组
- 搜索结果、导出结果、报告文件
- 二进制或大文本内容

### DB 是镜像、备份、索引和运行态

数据库建议保存：

- `xiranite.config.toml` 的快照、hash、mtime
- 节点运行记录
- 大型 history/undo 数据
- 搜索/扫描索引
- 前端需要快速查询的数据
- 节点运行日志、状态、最近输入

这样用户仍然可以手改 TOML，同时前端可以用 DB 获得更好的性能和恢复能力。

### JSON 不要一刀切迁入 TOML

JSON 文件需要按用途分类：

- 配置型 JSON：可以迁入 TOML。
- 历史型 JSON：默认迁入 DB；TOML 只保留开关、路径或保留策略。
- 产物型 JSON：继续作为输出文件；不要进入 TOML。
- inline JSON 参数：保留 CLI 参数语义，必要时增加 TOML 默认项。

## 建议 TOML 结构

```toml
[workspace]
default = "ws-default"

[paths]
data_dir = ""
database = "./xiranite.db"

[nodes.linku]
enabled = true

[[nodes.linku.links]]
name = "example"
source = "E:/Source"
target = "D:/Links/example"

[nodes.owithu]
enabled = true

[[nodes.owithu.entries]]
name = "Open with Xiranite"
command = "xiranite"
extensions = [".zip", ".rar", ".7z"]

[nodes.lata]
taskfile = "./Taskfile.yml"

[nodes.scoolp.sync]
enabled = true

[nodes.enginev]
workshop_root = "E:/SteamLibrary/steamapps/workshop/content/431960"
```

对于复杂或原本就是 JSON 的配置，如果 TOML 表达会变得非常丑，可以用明确字段保留 JSON 字符串：

```toml
[nodes.findz.defaults]
where_json = '{"type":"rule","property":"ext","condition":"eq","value":".zip"}'
```

但这只适合复杂表达式。普通配置优先使用 TOML 原生表和数组。

## 24 个节点处理建议

### A. 必须迁入统一 TOML 的节点

这类节点当前依赖固定明文配置文件，最应该优先改造。

| 节点 | 当前格式 | 当前文件 | 建议 |
| --- | --- | --- | --- |
| `lata` | YAML | `Taskfile.yml` / `Taskfile.yaml` | TOML 中记录默认 taskfile 路径；Taskfile 本体可继续是 YAML，因为它是外部任务定义格式 |
| `linku` | TOML | `cwd/linku.toml` | 迁入 `[nodes.linku]`，链接记录用 `[[nodes.linku.links]]` |
| `owithu` | TOML | `owithu.toml` | 迁入 `[nodes.owithu]`，保留导入旧 `owithu.toml` 的能力 |

注意：`lata` 的 `Taskfile.yml` 不建议强制改写成 TOML。Taskfile 是 task 工具生态格式，TOML 中只记录路径和默认任务即可。

### B. 可选配置输入，按需迁入 TOML

| 节点 | 当前格式 | 参数 | 建议 |
| --- | --- | --- | --- |
| `seriex` | TOML | `--config` | 迁入 `[nodes.seriex]`，保留 `--config` 作为覆盖 |
| `scoolp` | TOML | `--config` / `-c` | 迁入 `[nodes.scoolp.sync]`，内置默认配置可作为生成模板 |
| `enginev` | JSON | `--wallpapersFile` | 不把历史扫描数组塞 TOML；TOML 只放 `workshop_root`、筛选默认值、导出偏好 |
| `bandia` | JSON | `--mappingFile` / `--mappings` | 小型 path mapping 可迁入 TOML；大型映射继续外部文件或 DB |
| `trename` | JSON | `--input` / `--inputFile` | 如果是批量任务输入，保持外部 JSON；TOML 只放默认规则和路径 |
| `migratef` | JSON | `--historyPath` | history 明细迁 DB；TOML 只放 history 策略和默认路径 |
| `dissolvef` | JSON | `--historyPath` | 同 `migratef` |
| `marku` | JSON | `--historyPath` | undo history 迁 DB；TOML 只放 `enable_undo`、默认模块参数 |
| `repacku` | JSON | `--config` / `--configPath` | 常用压缩规则迁入 `[nodes.repacku]`；analyze 输出的临时 config 继续产物化 |

### C. 仅输出产物，不迁入 TOML

这些文件不是配置源，不应塞进统一 TOML。

| 节点 | 当前格式 | 输出 | 建议 |
| --- | --- | --- | --- |
| `crashu` | JSON | `folder_pairs.json` | 继续作为导出产物；可在 TOML 中配置默认文件名 |
| `formatv` | JSON | duplicates report | 继续作为报告文件；可在 TOML 中配置默认 report 目录 |
| `findz` | JSON/CSV/EFU/text | `--output` | 继续作为查询结果导出；TOML 只放默认查询参数 |

### D. 不涉及配置文件，暂不迁移

以下节点不需要为统一 TOML 做强改：

```text
cleanf
encodeb
kavvka
sleept
recycleu
rawfilter
linedup
mvz
movea
```

补充说明：

- `rawfilter` 写 `.url` 快捷方式，不是配置。
- `linedup --filterFile` 是纯文本行列表，不是全局配置；可选地在 TOML 中记录默认 filter file 路径。
- `mvz --file` 是 archive entry 文本，不是配置。
- `movea --plan` 是 inline JSON 字符串，不是文件路径；可以保留。

## 推荐实现步骤

### 1. 新增共享配置包

建议新增：

```text
packages/config/
  src/index.ts
```

对外提供：

```ts
resolveXiraniteConfigPath(options)
loadXiraniteConfig(path)
saveXiraniteConfig(path, config)
getNodeConfig(config, nodeId)
updateNodeConfig(config, nodeId, patch)
```

内部使用 `smol-toml` 解析和序列化。不要让每个节点自己实现路径查找。

### 2. 定义 schema

建议使用 `zod` 定义配置 schema：

```ts
const xiraniteConfigSchema = z.object({
  workspace: z.object({ default: z.string().optional() }).optional(),
  paths: z.object({
    data_dir: z.string().optional(),
    database: z.string().optional(),
  }).optional(),
  nodes: z.record(z.string(), z.unknown()).optional(),
})
```

每个节点可以在自己的包里导出节点级 schema，例如：

```ts
export const linkuConfigSchema = z.object({
  enabled: z.boolean().default(true),
  links: z.array(z.object({
    name: z.string().optional(),
    source: z.string(),
    target: z.string(),
  })).default([]),
})
```

### 3. 先迁移 `linku`

`linku` 是最好的样板：

- 当前依赖 `cwd/linku.toml`
- 读写双向
- 数据量通常可控
- 很适合 TOML 的数组表结构

迁移后：

- 默认读取 `xiranite.config.toml[nodes.linku]`
- `--config` 只用于覆盖统一配置路径
- 旧 `linku.toml` 支持一次性导入
- `core.ts` 继续保持纯逻辑
- `platform.ts` 只做 symlink / move / pathInfo 等系统操作

### 4. 再迁移 `owithu` 和 `scoolp`

`owithu` 与 `scoolp` 都已有 TOML 生态，迁移成本较低。迁移时保留旧文件导入能力即可。

### 5. 最后处理 JSON 节点

JSON 节点不要批量机械迁移。按分类处理：

- `bandia` 小 mappings 可迁 TOML，大 mappings 不迁。
- `repacku` 常用规则迁 TOML，analyze 产物继续外部文件。
- `enginev` 不迁 wallpapers 数组，只迁默认路径和筛选参数。
- `migratef` / `dissolvef` / `marku` 的 history 明细迁 DB，TOML 只存策略。

## DB 同步策略

建议 backend 启动时：

1. 解析 `xiranite.config.toml`。
2. 计算 hash 与 mtime。
3. 写入 DB 的配置快照表。
4. 如果发现 TOML 被手动修改，以 TOML 为准刷新 DB 镜像。

建议 DB 表：

```text
config_snapshots
  id
  path
  content
  hash
  mtime
  created_at

node_runtime_state
  node_id
  key
  value_json
  updated_at

node_history
  node_id
  scope
  value_json
  created_at
```

CLI 不需要直接读这些表。CLI 读 TOML，执行后如果 backend 存在，可由 backend 同步；独立 CLI 则只保持明文配置和产物。

## 明确不要做的事

1. 不要把所有 JSON 输出产物塞进 `xiranite.config.toml`。
2. 不要把大型 history 数组写进 TOML。
3. 不要让每个节点继续各自默认读 `cwd/<node>.toml`。
4. 不要让 `core.ts` 依赖 TOML、DB、文件系统、`process.cwd()`。
5. 不要让独立 CLI 强制依赖 Xiranite backend。

## 最终判断

统一 TOML 应该承担“人工可编辑配置”的角色，不承担“所有数据”的角色。

推荐结论：

- `linku`、`owithu`、`seriex`、`scoolp` 的 TOML 配置优先迁入统一 TOML。
- `lata` 保留 Taskfile YAML 本体，统一 TOML 只记录 taskfile 路径和默认任务。
- `bandia` / `repacku` 的小型配置可迁入 TOML，大型 JSON 继续外部文件或 DB。
- undo/history JSON 迁 DB，不进 TOML。
- 输出产物继续作为产物文件，不进 TOML。

