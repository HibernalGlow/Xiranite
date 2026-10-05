# 三位一体迁移台账（终端面执行路）

现读生成：`bun scripts/audit-face-execution-path.ts`（本次 2026-10-05T21:34:35.255Z；core 清单来自 2026-10-05T20:11:36.331Z）。
禁止手填本表；它只描述「这一面在哪个进程跑那份 core」，不描述计划。

共 30 个节点：migrated 9，in-process 21，无终端面 0。
派发分波：A（宿主已可跑，立刻可迁）0；B（bundle 在但未进注册表）19；C（core/host bundle 本身没建出来）0。

| 节点 | 面 | 判定 | core 值导入 | 直接调用 run | 协议证据 | 已嵌 Rust | 波次 | 可派 | 阻塞 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bandia | cli.ts/Tui.tsx | in-process | 1 | 3 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| bitv | cli.ts/Tui.tsx | in-process | 1 | 2 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| classf | cli.ts/Tui.tsx | in-process | 1 | 2 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| classq | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | cli.ts | — |
| cleanf | cli.ts/Tui.tsx | in-process | 1 | 3 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| clipm | cli.ts/Tui.tsx | in-process | 1 | 0 | — | 否 | H | — | disposition=hold-unmigrated：清单没打算让它进宿主（manifest 的 run 字段为 null），迁移不在射程内，别去「修」它 |
| crashu | cli.ts/Tui.tsx | in-process | 1 | 2 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| dissolvef | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | — | — |
| encodeb | cli.ts/Tui.tsx | in-process | 1 | 3 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| enginev | cli.ts/Tui.tsx | in-process | 1 | 3 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| findz | cli.ts/Tui.tsx | in-process | 0 | 0 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| formatv | cli.ts/Tui.tsx | in-process | 1 | 2 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| gifu | cli.ts/Tui.tsx | in-process | 1 | 2 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| kisaki | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+startOperation+await/pause/resumeOperation | 是 | - | Tui.tsx, cli.ts | — |
| lata | cli.ts/Tui.tsx | in-process | 1 | 0 | — | 否 | H | — | disposition=hold-unmigrated：清单没打算让它进宿主（manifest 的 run 字段为 null），迁移不在射程内，别去「修」它 |
| linedup | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | Tui.tsx, cli.ts | — |
| linku | cli.ts/Tui.tsx | in-process | 1 | 2 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| logx | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | cli.ts | — |
| marku | cli.ts/Tui.tsx | in-process | 1 | 3 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| migratef | cli.ts/Tui.tsx | in-process | 1 | 3 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| mvz | cli.ts/Tui.tsx | in-process | 1 | 2 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| nameu | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | Tui.tsx, cli.ts | — |
| rawfilter | cli.ts/Tui.tsx | in-process | 1 | 3 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| recycleu | cli.ts/Tui.tsx | in-process | 1 | 2 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| repacku | cli.ts/Tui.tsx | in-process | 1 | 3 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| samea | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | cli.ts | — |
| sleept | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | Tui.tsx | — |
| smartzip | cli.ts/Tui.tsx | in-process | 1 | 0 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |
| timeu | cli.ts/Tui.tsx | migrated | 0 | 0 | createOperationsClient+runOperation+startOperation+await/pause/resumeOperation | 是 | - | cli.ts | — |
| trename | cli.ts/Tui.tsx | in-process | 2 | 2 | — | 否 | B | — | 未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册 |

## 宿主那条 lane 欠的这一刀（`embed-node-bundles --check` 现读，只报不跑）

无——生成物与清单一致。

写档的那条命令（`bun scripts/embed-node-bundles.ts`）刻意不由本尺执行：它会按**当前工作树源码**重签 `bundles/`，而当前源码里混着别的 lane 未提交的 `core.ts`；把别人在写的实现签进生成物，正是门禁该拦住的事。

## 每个未注册节点缺的那一句（派生器的原话，不是转述）

| 节点 | 派生器 status | 注册表给的理由 | 待答的那一句授权 |
| --- | --- | --- | --- |
| bandia | needs-named-grants | platform node whose grants name nothing yet — os-native: os-native: @x | os-native: os-native: @xiranite/file-operations, @xiranite/file-operations/platform ; external-process: external-process: proc.exec(command) unresolved: runCommand is cal |
| bitv | needs-named-grants | platform node whose grants name nothing yet — external-process: extern | external-process: external-process: proc.exec(command) unresolved: exec is called at packages/nodes/bitv/src/platform.ts:46 with ffprobePath |
| classf | needs-named-grants | platform node whose grants name nothing yet — os-native: os-native: ru | os-native: os-native: runClassf (clipboard), createNodeClassfRuntime (clipboard), readClipboardPaths (clipboard) |
| cleanf | needs-named-grants | platform node whose grants name nothing yet — os-native: os-native: @x | os-native: os-native: @xiranite/file-operations, @xiranite/file-operations/platform |
| crashu | insufficient-evidence | no byte ceiling in any source: the executor refuses max_live_bytes = 0 | — |
| encodeb | insufficient-evidence | no byte ceiling in any source: the executor refuses max_live_bytes = 0 | — |
| enginev | needs-named-grants | platform node whose grants name nothing yet — os-native: os-native: @x | os-native: os-native: @xiranite/file-operations, @xiranite/file-operations/platform |
| findz | needs-named-grants | platform node whose grants name nothing yet — no-host-free-answer: no- | no-host-free-answer: no-host-free-answer: @parcel/watcher, @xiranite/findz-native ; os-native: os-native: @parcel/watcher |
| formatv | insufficient-evidence | no byte ceiling in any source: the executor refuses max_live_bytes = 0 | — |
| gifu | needs-named-grants | platform node whose grants name nothing yet — external-process: extern | external-process: external-process: proc.stop, proc.start(command) unresolved: runCommand is called at packages/nodes/gifu/src/platform.ts:35 with command, proc.wait |
| linku | insufficient-evidence | no byte ceiling in any source: the executor refuses max_live_bytes = 0 | — |
| marku | insufficient-evidence | no byte ceiling in any source: the executor refuses max_live_bytes = 0 | — |
| migratef | derivable | no byte ceiling in any source: the executor refuses max_live_bytes = 0 | — |
| mvz | needs-named-grants | platform node whose grants name nothing yet — external-process: extern | external-process: external-process: proc.exec(command) unresolved: runCommand is called at packages/nodes/mvz/src/platform.ts:73 with locator |
| rawfilter | insufficient-evidence | no byte ceiling in any source: the executor refuses max_live_bytes = 0 | — |
| recycleu | needs-named-grants | no byte ceiling in any source: the executor refuses max_live_bytes = 0 | external-process: external-process: proc.exec(powershell.exe) |
| repacku | needs-named-grants | platform node whose grants name nothing yet — external-process: extern | external-process: external-process: proc.exec(command) unresolved: runCommand is called at packages/nodes/repacku/src/platform.ts:209 with locator |
| smartzip | needs-named-grants | platform node whose grants name nothing yet — os-native: os-native: @x | os-native: os-native: @xiranite/file-operations, @xiranite/file-operations/platform ; external-process: external-process: proc.exec(command) unresolved: runCommand is cal |
| trename | insufficient-evidence | no byte ceiling in any source: the executor refuses max_live_bytes = 0 | — |

这一节的用处是把「wave B 19 个」拆成可逐条拍板的清单：`status=needs-named-grants` 的那些，工具拒绝替人发明 program/service/网络主机名（`packages/nodes/<id>/src/platform.ts` 的调用点就是出处）；拍完写进 `docs/xiranite-target-node-manifest.json`，再 `derive-scripted-policy` + `embed-node-bundles`，它们就从 wave B 进 wave A。

## 判定口径

- `migrated`：无 core 值导入、无对清单里 `run` 符号的直接调用，且存在 `/operations` 客户端证据。
- `in-process`：仍在 Node/Bun 进程里跑那份 core（ADR-0074 §5 要收口的形态）。
- `wave A` 可立即派发；`wave B` 先要 embed + 注册（共享生成物，归宿主那条 lane）；`wave C` 是上游 bundle 构建本身没成功。
- GUI 列（`guiCoreValueImports` / `guiRunCalls`）是第三面：`src/nodes/<id>/` 里对 `@xiranite/node-<id>/core` 的值导入与调用，浏览器执行同一份业务逻辑同样是第二个执行宿主。
- **`blocker` / `wave` 读的是活产物**（`artifacts/node-bundles/manifest.json`、`crates/xiranite-scripted-nodes/src/registration.rs`、`bundles/` 目录），宿主那条 lane 会把节点从 B 推到 A；`dispatchable` 还额外要求 face 文件当前没有未提交改动。**派发前必须重跑本脚本**，不要信上一次读数。
- `coreChangedBundleStale` 是**上界探测**，不是证明：core 与 `bundles/<id>.js` 同时被改时它报 false，而 bundle 是否真在 core 之后重建过，这把尺看不见。别拿它的 false 当「bundle 是新的」。

## 派发队列（现读，按依赖边排）

1. 立刻可派（宿主就绪 + face 无人握着）：**当前 0 个**
2. 卡在同一条 lane 的注册产物：`bandia` `bitv` `classf` `cleanf` `crashu` `encodeb` `enginev` `findz` `formatv` `gifu` `linku` `marku` `migratef` `mvz` `rawfilter` `recycleu` `repacku` `smartzip` `trename` —— 前置是 `bun run build:node-bundles` 与 `bun scripts/embed-node-bundles.ts` 落到 crates/；那两处生成物现在被别的 lane 握着（未提交），抢先跑会覆盖别人未提交的东西。
3. 卡在 bundle 本身没建出来（真缺陷）：无
3b. 清单判定不在迁移射程（disposition=hold-unmigrated，宿主本来就不跑它，面也无从打协议）：`clipm` `lata`
4a. GUI 面可立刻派（offending 文件当前无人改）：无
4b. GUI 面被 UI 那条 lane 改着、暂不动：`bandia` `bitv` `classf` `cleanf` `enginev` `kisaki` `marku` `mvz` `sleept`

恢复执行的一条命令：`bun scripts/audit-face-execution-path.ts --self-check`，然后按本节第 1 行派面；第 1 行为空就说明还得等上面那两条 lane 提交。
