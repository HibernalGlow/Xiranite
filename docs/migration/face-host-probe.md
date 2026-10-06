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

- 逐个节点的 ceiling adequacy：**marku 一条已量，结论是 adequacy 为假**（见下一节：90 KB 输入先 `out of memory`，离声明的 16 MiB 还很远）；
  `linedup` 只在 20.1 MB 上证过「超了会 413」，那是**请求体门**，与 realm 堆门是两道不同的门。其余声明值仍未测，
  `docs/xiranite-target-node-manifest.json` 的 evidence 行里那句「adequacy is NOT measured」除 marku 外照旧成立。
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

## 真宿主扫描（2026-10-06 00:16–00:21，`xiranite-dev-host` debug 现编现起，独立沙箱根 + TTL 900s，跑完即杀）

管路照上面那节，只补一条：鉴权头是 **`x-xiranite-token`**（`crates/xiranite-loopback-host/src/cors.rs:35`），不是 `Authorization: Bearer`——我试 bearer 时 9 个节点全 401，那是我用错头，不是宿主拒客。
宿主自报节点集合现读 18 个：`classq crashu dissolvef encodeb formatv kisaki linedup linku logx marku migratef nameu rawfilter recycleu samea sleept timeu trename`。

| 面 | 命令 | 结果 |
| --- | --- | --- |
| encodeb | `preview --paths <沙箱> --json` | rc=0，`success:true`，宿主回 `{"mappings":[],"matches":[],"processed":0}` |
| trename | `scan --paths <沙箱> --json` | rc=0，`Scan complete: 3 item(s), 1 segment(s)`，`jsonContent` 是宿主产的真树 |
| marku | `text --input "# 你好" --json` | rc=0，`"# 你好" → "- 你好"`（markt 模块真在 realm 里跑） |
| crashu | `scan --source-paths … --token nope` | rc=1，stderr `/nodes/crashu/operations: 401`，**stdout 0 字节** ⇒ 换到真宿主上也仍然不回落本地 |
| marku | `text --input-file <26.2 MB>` | rc=1，**413**（`maxLiveBytes` 那条请求体门真咬） |

## 新缺陷（真宿主才看得见，归宿主那条 lane，本轮只登记）

同一份 90,121 字节的纯 ASCII Markdown，`marku text` 走**编译进去的预算** `budget(16777216, 1)`（`crates/xiranite-scripted-nodes/src/registration.rs:136`，与清单 `maxLiveBytes=16777216` 一致）：

| 模块 | 输入 | 结果 |
| --- | --- | --- |
| `markt` | 81,915 B | `success:true`，响应体 171,667 B |
| `markt` | 90,121 B | `success:false`，message **`out of memory`**，输出 0 B |
| `single_orderlist_remover` | 同一 90,121 B | `success:true`，输出 90,117 B |
| `image_path_replacer` | 同一 90,121 B | `success:false`，`out of memory` |

读数边界在 82–90 KB 之间，与文档字节数不成任何与 16 MiB 相关的比例：**16 MiB 声明值远没被用满就先 OOM**。两条线索指向 realm 侧而不是策略侧——`crates/quickjs-realm/src/engine.rs:126-140` 把 `max_live_bytes` 直接当 `runtime.set_memory_limit`（:264）的堆预算，而 `engine.rs:659` 把 `out of memory` 与 `live-bytes budget` 归成同一类错误文案。要查的是「diff 构造路径的堆放大倍数」还是「预算根本没吃到 16 MiB」。

**为什么这类问题单位测试结构上看不见**：节点包里的测试跑的是 TS core（Node/V8、无堆预算），realm 的 `set_memory_limit` 不在管路上；所以「ceiling adequacy 未测」这条不能靠包内绿来抵，只有上面这种真宿主尺寸扫描能判。本轮 marku 的结论是 **adequacy 为假**（有效上限 ~80 KB，远低于声明的 16 MiB），其余 10 条声明值仍未测。

## 18 个注册面的动作可达性矩阵（2026-10-06 00:24–00:27，`xiranite-dev-host` 现起、TTL 1500s、独立沙箱根，跑完即杀）

每个面跑一条**只读/预览**动作，`rc` 用 `subprocess.run` 直接取（不经管道——上一版我用 `| head | tr` 量出来全是 rc=0，那是管道自己的 rc）。
`HOST_JSON` = stdout 是宿主回的 `NodeRunResult`。

| 面 | 命令（沙箱内） | rc | 结果 |
| --- | --- | --- | --- |
| linedup | `filter --source - --filter apple`（stdin 三行） | 0 | `banana kept=1 removed=2` |
| encodeb | `preview --paths tree` | 0 | `Preview completed, 0 item(s)` |
| formatv | `scan --paths tree` | 0 | `Scan completed: 0 normal, 0 .nov.` |
| linku | `list --path lib` | 0 | `Found 0 link record(s)` |
| marku | `text --input "# 标题"` | 0 | `changed`，realm 里的 markt 真跑 |
| migratef | `plan --source tree --target lib` | 0 | `Plan generated: 1 item(s)` |
| rawfilter | `scan --path tree` | 0 | `No archive files found` |
| sleept | `status` | 0 | `CPU: 20.2%, upload…, download…` |
| timeu | `scan tree/f.txt` | 0 | `TimeU planned 1 item(s)` |
| trename | `scan --paths tree` | 0 | `Scan complete: 1 item(s), 1 segment(s)` |
| dissolvef | `plan --path tree` | 0 | `Plan generated: 0 operation(s)` |
| nameu | `--root tree --dry-run` | 0 | `NameU planned 0 item(s)` |
| samea | `--root tree --dry-run` | 0 | `SameA planned 0 archive transfer(s)` |
| recycleu | `status` | 0 | `Recycle cleaner is idle.`（`clean`/`clean_now` 是破坏性动作，不当探针跑） |
| crashu | `scan --sourcePaths a,b --targetNames n` | 0 | `Scan completed: 0 similar folder(s)` |
| logx | `stats --dir <沙箱 logs>`（目录里放两行合法 JSONL） | 1 | **`quickjs-shim: fs.createReadStream is not implemented`**；同一面 `doctor` 与空目录下的 `stats` 都 rc=0 ⇒ 撞点在「真去读文件」 |
| kisaki | `similar-images --dir tree` | 1 | **`quickjs-shim: czkawka-native.scanMediaFiles is not implemented`** |
| kisaki | `scan --dir tree`（duplicate-files） | 1 | 宿主原文 **`czkawka.scan.duplicates needs the operation's granted filesystem, and this run was started with the NodeHost seam alone`** |
| classq | `--root tree --dry-run` | 1 | 宿主回 **`success:false` 而 message 是 `ClassQ planned 1 item(s).`**，`items` 里真有规划条目 —— 计划成功却报失败 |
| logx（形状对照） | `--dir` 当子命令传 | 1 | `Unknown LogX command` —— 它要动词（`doctor/errors/sessions/stats`） |

**这一节里我自己犯过、且下轮别再犯的两个错**：其一，第一版驱动用 `cmd | head -c 200 | tr` 取 rc，量到的「全 rc=0」是 `tr` 的 rc；
改用 `subprocess.run` 直接取之后才有 15/3 这个分布。其二，复核时我在 zsh 里写 `for v in "similar-images --dir …"` 再 `$v` 传参，
zsh 不对参数分词，整个字符串成一个 argv，于是得到假的 `Unknown command`——同一批结论必须用显式 argv 列表复跑才算数。

**15 条 rc=0，3 条是真缺陷**（logx 的 shim 缺、kisaki 的 czkawka 臂没接、classq 的 success 与 message 矛盾），
另有 1 行是我一开始把旗标当子命令传的错用形状，不是面的问题。加上上一节的控制组（401 不回落、26 MB→413），这条腿现在有了覆盖面。

三条要人接的（都在 04:40 用 python 传 argv 复跑过、取到全文，不是一次读数的转述）：

1. **`fs.createReadStream` 没实现** ⇒ logx 读不了任何日志文件。沙箱里放两行合法 JSONL，`logx stats --dir <该目录> --json` 回
   `quickjs-shim: fs.createReadStream is not implemented`（空目录时 `doctor`/`stats` 都能 rc=0，所以不是路由不通，是**读到文件才撞**）。
   realm 里读文件只有 `readFile` 一条路，而这条不在包测的管路上（包测跑 Node 的 fs），所以只有真宿主能撞出来。
2. **kisaki 的两条失败是两件事**：
   `similar-images` 回 `quickjs-shim: czkawka-native.scanMediaFiles is not implemented`（shim 表面缺这个绑定）；
   `scan`（duplicate-files）回的是宿主原文
   `host operation service.invoke threw: czkawka.scan.duplicates needs the operation's granted filesystem, and this run was started
   with the NodeHost seam alone. Build it with Executor::with_files(..) / MachineAccess::granted(..).`
   —— 服务臂**在**（czkawka 在 `xiranite-loopback-host` 的 `default` 里，`Cargo.toml` 那段注释就写着这两道引擎门层层往下传），
   缺的是那次 run 没带已授予的文件系统去构造。落点在 `crates/xiranite-quickjs-executor`，不是「忘了开 feature」。
3. **classq 的 `success` 与 message 相互矛盾**：宿主回 `success:false` 而 message 是 `ClassQ planned 1 item(s).`，且 `items` 里
   确实有规划好的条目。面按 `success` 置 `exitCode=1` ⇒ 脚本里 `classq` 的预览永远算失败。要么 core 的 plan 该带 `success:true`，
   要么这层的映射错——两处都在别的会话手里（`classq` 的 core 与 face 映射），先登记不顺手改。

还量到一条**没归因完**的现象，写下来免得下轮重走：crashu 只认 `--sourcePaths`/`--targetNames` 这种 camelCase 写法，`--source-paths`/`--target-path` 被**静默忽略**（不是报错）；而 citty 本身是会做 kebab↔camel 回退的（`node_modules/citty/dist/index.mjs:241`）。同一类形状差异也出现在 linedup 那条既存的 `--sourceFile` 死路上。两条合起来指向「这些面的旗标读取路径没吃 citty 的解析结果」，需要单独一次调查——它不影响「谁执行那份 core」，所以不在本轮射程内，但它让 `audit:node-cli-surface` 的旗标字面量口径显得比实际乐观。
