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
