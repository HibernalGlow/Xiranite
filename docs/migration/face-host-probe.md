# 迁移面的真宿主探针（不是假宿主，是编出来的 Rust 宿主）

为什么要有这份文档：台账尺判的是「面上还有没有 core 的值导入与直接调用」，它判不了**收口之后动作到底还可达**。所以下面这些结论一律来自真进程 + 真宿主，脚本化的假宿主只出现在单元测试里，不能当端到端证据。

## 管路（可复现）

```bash
cargo build -p xiranite-loopback-host --bin xiranite-dev-host -j 1     # debug-only；release 会在绑定前退出
SBX=$(mktemp -d)
XIRANITE_ALLOWED_DIRS="$SBX" target/debug/xiranite-dev-host \
  --ttl-seconds 55 --channel-file "$SBX/channel.json" > "$SBX/host.log" 2>&1 &
# 轮询 channel.json 出现（不要 sleep 一次就假定起来了）
bun packages/nodes/linedup/dist/cli.js filter --backend "$URL" --token "$TOK" --json \
  --source - --filter 'apple' < <(printf 'apple\nbanana\n')
```

宿主侧自报的节点集合是现读的，不是文档里的名单：`nodes [classq, crashu, dissolvef, encodeb, formatv, kisaki, linedup, linku, logx, marku, migratef, nameu, rawfilter, samea, sleept, timeu, trename] granting 1 root(s)` —— 18 个注册节点（含 `recycleu`）。

## 已证

| 结论 | 证据 |
| --- | --- |
| 已迁移的面真走宿主 | 小样 `filter` 得 `filteredLines:["banana"], keptCount:1, removedCount:1, removedLines:["apple"]`，rc=0 |
| 错 token 不回落本地跑 | `--token nope` → 面报 `/nodes/linedup/operations: 401`，**stdout 0 字节**，rc=1 |
| 宿主不在场不静默降级 | 杀掉宿主后同一条命令报「does not answer /health」+ 三种 attach 方式，rc=1，stdout 0 字节 |
| **`maxLiveBytes` 是真会咬的策略** | 20.1 MB 单文档经 stdin 进同一面 → 宿主 `<1s` 回 **413**；同一通路小样成功 ⇒ 不是超时也不是崩 |
| 探针自身的坑 | 这个执行环境的 stdin 本来就是管道，而 `runFilter` 在 `!options.source && hasPipedInput(stdin)` 时**先吃 stdin**，所以文件类参数一律读成空 —— 用 `--source -` 才走对路径 |

## 既存缺陷（不是这一波带进来的，别记在我这笔上）

`packages/nodes/linedup/src/cli.ts` 在 citty 子命令 `filter` 上声明了 `sourceFile`/`filterFile`/`outputFile`/`caseInsensitive`/`preserveOrder`，但真进程里**任何拼法**（`--sourceFile` / `--source-file` / `--sourcefile`）都拿不到值，三条都撞 `Missing source content`。

判它为既存而不是回归的依据：`git show d88dfccb…:packages/nodes/linedup/src/cli.ts`（本波之前的版本）里 `runFilter` 的取源判断与现在**逐字相同**（两处 `hasPipedInput(host.stdin)`、同一句错误文案）。它的包内测试之所以一直绿，是因为测试从 `runProgram([...])` 进的是**手工 parseArgs 的管道路径**，真进程进的是 citty 那条——两条路径只有一条被覆盖，所以这条死路长期看不见。

**这条不在三位一体迁移的射程内**（它不影响「谁执行那份 core」，只影响文件类旗标可不可达），所以这里只登记不顺手修：修它要动 `interaction`/`cli` 的 arg 契约，另有 `audit:node-cli-surface` 与 `audit:node-help-text` 两把基线尺盯着同一个文件。

## 还没做的

- 逐个节点的 ceiling adequacy：目前只在 `linedup`（peer 值 16 MiB）上证了「超了会 413」，没证「11 行新声明值对各自真实负载够不够」。真实形状是把每个节点跑在**它自己那一档**的沙箱输入上，读它是否 413；`docs/xiranite-target-node-manifest.json` 那 11 条 evidence 行里写的「adequacy 未测」现在仍然成立。
- 危险确认在协议路径上的表现：TUI 里 `confirm-execute` 之前不发 `startOperation` 这件事，目前只有包内假宿主测试覆盖，真宿主 + pty 那一条还没跑。

## 三位一体这一波之后的门禁现读（2026-10-06，逐条带 rc，串行跑）

| 命令 | rc | 读数与归属 |
| --- | --- | --- |
| `bun run audit:node-interaction-parity` | 0 | 26 节点、102 个 action id、260 个 field id 与默认值全对上；门禁 21 配 / 0 不配 / 5 在评。cleanf 恢复的「预设组合选择器」在这一把里是绿的。 |
| `bun run audit:target-node-manifest` | 0 | 51 条记录 / 30 个节点目录 / 28 保留，disabled = [clipm, lata]。 |
| `bun run audit:node-cli-surface` | 1 | 只有两条 FAIL，都在 `sleept`（`--clipboard`、`--output` 在旧 CLI 里有、基线里没有）。`packages/nodes/sleept/src/cli.ts` 与 `docs/node-cli-surface-baseline.json` 相对 HEAD **内容干净**（只有 mode 翻转），所以这两条红在 HEAD 上就成立，不是这一波带进来的；`bitv/classf/findz/smartzip/…` 各条 DEBT 是「没有 root meta.name」的既存口径，非 FAIL。 |
| `bun run audit:node-help-text` | 1 | FAIL 集中在 `bitv`/`gifu`/`logx` 的 `x` 前缀命令名与字典不一致（字典要 `bitv ui`，产物写 `xbitv ui`）。`packages/nodes/bitv/src/help.ts` 与 `packages/nodes/gifu/src/help.ts` 相对 HEAD **内容干净** ⇒ 同样是 HEAD 上既存的红。我这波只改过 `cleanf/src/help.ts`，且改的是「删除由宿主执行」那两句事实描述，没碰命令名。 |
| `bun run check:source-size` | 1 | 超限的 1 个文件是 `src/lib/pie-menu/primitive.tsx`（1075 行，别的 lane 的新文件）。`packages/nodes/bandia/src/cli.ts` 现在 986 行（855→986，本轮迁移把它推过了 800 预警线、仍在上限内），是**我这波的债**，拆分点在 guided 流程；`src/nodes/enginev/Component.tsx` 1092 行但基线 1106（在缩），按规矩放行。 |
| `bunx tsc -p tsconfig.app.json --noEmit` | 1 | 87 条错误行、64 个文件，**零条 TS2307、零条提到本轮新出口的说明符**；错误落在 `NodeStateCapability` 形状与配置泛型那一族，分布在别的 lane 正在写的文件上（`FlowCanvasView`、`AppConfigSync`、`workspaceStore`、`kisaki/*`、`clipm/*` 等）。新子路径的解析与类型是通的。 |

判归属用的口径只有一个，且它比 `git status` 强：`git diff HEAD --name-only -- <那个文件>` 为空 = 内容与提交状态一致，
**任何 lane 都没碰过它**，于是这条红必然在 HEAD 上就存在。注意 GitButler 的反向陷阱：我自己刚提交的文件反而会因为
`but commit -b <分支>` 后 HEAD 滞后而报成脏——所以「脏」不能直接读成「别人在写」，`bun scripts/audit-face-execution-path.ts
--baseline <ref>` 可以把基准换掉。

## 仍然没闭合的三条，以及各自缺的是谁

1. **真宿主端到端**：28/30 的面已经只会打协议，但 10 个新迁节点没进 Rust 注册表。挡路的是
   `bun run build:node-bundles` 的前置——台账现读 28 个 bundle 输入相对 HEAD 有内容差，其中 18 条在共享包里
   （`quickjs-shims`、`host-capabilities`、`file-operations`、`findz-native`），全是别的 lane 未提交的实现。
   那份构建按工作树源码打包，会把它们一起签进 `bundles/*.js` 与注册表，所以规矩是硬的：**列表非空就不跑**。
2. **GUI 最后一条边**：`src/nodes/kisaki/use-kisaki-workbench.ts` 的 `smartSelect` 值导入，第 15 行正压在 UI lane 未提交的
   hunk（`@@ -11 +11,5 @@`）上——地段重叠，动它就是在改别人手里的那几行。
3. **8 个 `src/nodes/<id>/Component.tsx` 的换源那一行**：地段与 UI lane 不重叠（台账 4a 判过），但 `but commit` 按整文件收，
   会把 ExecuteButton/NodeHeroGlow/AlertDialog 那些别人的 hunk 一起算进我这笔，所以留在工作区没提。
