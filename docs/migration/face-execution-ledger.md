# 三位一体迁移台账（终端面执行路）

现读生成：`bun scripts/audit-face-execution-path.ts`（本次 2026-10-05T23:22:34.103Z；core 清单来自 2026-10-05T20:11:36.331Z）。
禁止手填本表；它只描述「这一面在哪个进程跑那份 core」，不描述计划。

共 30 个节点：migrated 28，in-process 2，无终端面 0。
派发分波：A（宿主已可跑，立刻可迁）0；B（bundle 在但未进注册表）0；C（core/host bundle 本身没建出来）0。

| 节点 | 面 | 判定 | core 值导入 | 直接调用 run | 协议证据 | 已嵌 Rust | 波次 | 可派 | 阻塞 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bandia | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 否 | - | cli.ts | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| bitv | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 否 | - | cli.ts | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| classf | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 否 | - | cli.ts | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| classq | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| cleanf | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 否 | - | cli.ts | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| clipm | cli.ts/Tui.tsx | in-process | 1 | 0 | — | 否 | H | — | disposition=hold-unmigrated：清单没打算让它进宿主（manifest 的 run 字段为 null），迁移不在射程内，别去「修」它 |
| crashu | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| dissolvef | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| encodeb | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| enginev | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 否 | - | cli.ts | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| findz | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 否 | - | cli.ts | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| formatv | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| gifu | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 否 | - | cli.ts | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| kisaki | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| lata | cli.ts/Tui.tsx | in-process | 1 | 0 | — | 否 | H | — | disposition=hold-unmigrated：清单没打算让它进宿主（manifest 的 run 字段为 null），迁移不在射程内，别去「修」它 |
| linedup | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| linku | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| logx | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| marku | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| migratef | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| mvz | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 否 | - | cli.ts | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| nameu | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| rawfilter | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| recycleu | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| repacku | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 否 | - | cli.ts | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| samea | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| sleept | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | Tui.tsx | — |
| smartzip | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 否 | - | cli.ts | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| timeu | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| trename | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | Tui.tsx | — |

## 宿主那条 lane 欠的这一刀（`embed-node-bundles --check` 现读，只报不跑）

无——生成物与清单一致。

写档的那条命令（`bun scripts/embed-node-bundles.ts`）刻意不由本尺执行：它会按**当前工作树源码**重签 `bundles/`，而当前源码里混着别的 lane 未提交的 `core.ts`；把别人在写的实现签进生成物，正是门禁该拦住的事。

## 每个未注册节点缺的那一句（派生器的原话，不是转述）

| 节点 | 派生器 status | 注册表给的理由 | 待答的那一句授权 | 节点自己写的程序字面量（转录，非授权） |
| --- | --- | --- | --- | --- |

### 待答授权的类型（同类一次拍完，节点名单从 pending 字符串现算）


这一节的用处是把「未注册」拆成可逐条拍板的清单：工具拒绝替人发明 program/service/网络主机名（调用点行号就是出处）；拍完写进 `docs/xiranite-target-node-manifest.json`，再 `derive-scripted-policy` + `embed-node-bundles`，它们就从 wave B 进 wave A。

## 判定口径

- `migrated`：无 core 值导入、无对清单里 `run` 符号的直接调用，且存在 `/operations` 客户端证据。
- `in-process`：仍在 Node/Bun 进程里跑那份 core（ADR-0074 §5 要收口的形态）。
- `wave A` 可立即派发；`wave B` 先要 embed + 注册（共享生成物，归宿主那条 lane）；`wave C` 是上游 bundle 构建本身没成功。
- GUI 列（`guiCoreValueImports` / `guiRunCalls`）是第三面：`src/nodes/<id>/` 里对 `@xiranite/node-<id>/core` 的值导入与调用，浏览器执行同一份业务逻辑同样是第二个执行宿主。
- **`blocker` / `wave` 读的是活产物**（`artifacts/node-bundles/manifest.json`、`crates/xiranite-scripted-nodes/src/registration.rs`、`bundles/` 目录），宿主那条 lane 会把节点从 B 推到 A；`dispatchable` 还额外要求 face 文件当前没有未提交改动。**派发前必须重跑本脚本**，不要信上一次读数。
- `coreChangedBundleStale` 是**上界探测**，不是证明：core 与 `bundles/<id>.js` 同时被改时它报 false，而 bundle 是否真在 core 之后重建过，这把尺看不见。别拿它的 false 当「bundle 是新的」。

## 派发队列（现读，按依赖边排）

1. 立刻可派（宿主就绪 + face 无人握着）：**当前 0 个**
1b. 面现在就能改、宿主还没收（写面 + 假宿主测不受阻；真宿主端到端验收等 embed + 注册）：无
2. 卡在同一条 lane 的注册产物：**无** —— 前置是 `bun run build:node-bundles` 与 `bun scripts/embed-node-bundles.ts` 落到 crates/；那两处生成物现在被别的 lane 握着（未提交），抢先跑会覆盖别人未提交的东西。
3. 卡在 bundle 本身没建出来（真缺陷）：无
3b. 清单判定不在迁移射程（disposition=hold-unmigrated，宿主本来就不跑它，面也无从打协议）：`clipm` `lata`
4a. GUI 面可立刻派（要改的那几行没压在别人的 hunk 上）：`bandia`[src/nodes/bandia/Component.tsx(同文件不同地段)] `bitv`[src/nodes/bitv/Component.tsx(同文件不同地段)] `classf`[src/nodes/classf/Component.tsx(同文件不同地段)] `cleanf`[src/nodes/cleanf/Component.tsx(同文件不同地段)] `enginev`[src/nodes/enginev/Component.tsx(同文件不同地段)] `marku`[src/nodes/marku/Component.tsx(同文件不同地段)] `mvz`[src/nodes/mvz/Component.tsx(同文件不同地段)] `sleept`[src/nodes/sleept/Component.tsx(同文件不同地段)]
4b. GUI 面被 UI 那条 lane 改着、暂不动：`kisaki`

恢复执行的一条命令：`bun scripts/audit-face-execution-path.ts --self-check`，然后按本节第 1 行派面；第 1 行为空就说明还得等上面那两条 lane 提交。
