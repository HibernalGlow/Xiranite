# sleept 抬进宿主：已做完的部分、被谁挡住、怎么接着贴

日期：2026-10-05/06 夜间。作者：本会话（dissolvef 三面验收那条线的延续）。

## 目标（用户拍板的形状：方案 A）

`sleept` 的 core 只有 QuickJS 里那一份实现；三面（CLI/TUI/GUI）都经 `/operations` 打宿主。用户明确**不需要**「app 关掉之后计时器仍然生效」，所以选 A 而不是宿主侧调度器：

1. 给机器表面加一条**可打断的等待**（realm 没有定时器，节点要等就只能问宿主）。
2. 把**一次 run 能跑多久**变成节点在注册处自己说的一句话（`sleept` 的倒计时是小时级，默认 120s 会把它腰斩）。
3. 代价如实记：一个等待中的计时器占一条 `spawn_blocking` 线程。

## 已做完并且真跑过测的（本机 macOS，串行 `-j 1`）

| 件 | 落点 | 证据 |
|---|---|---|
| `clock.sleep` 的线名 | `crates/quickjs-host-protocol/src/operation.rs`：`ClockSleep` + `ALL` + `as_str` + 字面词表测 | `cargo test -p quickjs-host-protocol` 5/5 |
| 等待臂 | `crates/xiranite-quickjs-executor/src/host_calls.rs::clock_sleep` | 新集成测 `tests/clock_sleep.rs` 5/5 |
| 「不是 fs」完全列表 | `.../src/fs_operations.rs`（不加就 E0004） | 同上编译 |
| 节点自报期限 | `crates/xiranite-node-registry/src/lib.rs`：`NodeRequirements.run_deadline_ms: Option<u64>` + `NodeDescriptor::run_deadline_ms()` | `cargo test -p xiranite-quickjs-executor --test clock_sleep` 的两条期限测 |
| 消费期限 | `.../src/realm_run.rs`：声明了就覆盖 `limits.run_deadline`，没声明维持默认 | 同上 |
| 能力面 | `packages/host-capabilities/src/{contract,realm,node,operations.generated}.ts`：`clock.sleep(ms): Promise<number>` + `MAX_SLEEP_MS_PER_CALL` | `check:types` 净、`vitest` 16/16 |
| 两条 clippy | `xiranite-node-registry`、`xiranite-quickjs-executor`、`quickjs-host-protocol` | `--all-targets --no-deps -j 1 -- -D warnings` rc=0 |

臂的三条设计决定，都带测：
- 每轮先 `checkpoint(host, "clock.sleep")` 再睡 ≤50ms ⇒ cancel/pause 落在等待**中间**，不是等完才发现。测：`a_cancel_lands_inside_a_wait`（60ms 取消 vs 900ms 等待，断 elapsed < 900ms；正控是不取消时同一扇门跑满 900ms）。
- 单次上限 **1000ms**，超了**拒答**而不是静默截断。理由：墙上期限只在 host 调用之间被 pump 读（`quickjs-realm/src/jobs.rs:274-281`）。测：`one_call_above_the_cap_is_refused_with_the_number_that_explains_it`。
- 答案是「实际等了多久」，所以「它到底睡没睡」是可断言的。测的两条正控：不睡会红、固定死睡也会红。

顺带修了一条**已经在假绿的门禁**：`scripts/audit-quickjs-host-ops.ts` 跑 `crates/xiranite-quickjs-executor/target/debug/print-host-ops`——每-crate target 的残留，而 `cargo build` 早已写到工作区根 target。实测同一时刻旧 bin 答 30 个名字、新 bin 答 31（含 `clock.sleep`）：这条门禁一直拿化石比对词汇表，新 op 完全看不见。改成根路径，并加 **mtime 新鲜度断言**（bin 比定义词汇表的源文件旧就直接报错，不许静默）；`UNCONSUMED_BY_SHIMS` 为 `clock.sleep` 记了理由（消费者是能力面，不是 `node:` shim）。

## 为什么这些还没提交（不是懒，是不能）

底座拆分（ADR-0078：新 crate `quickjs-host-protocol` 与 `quickjs-realm`）**整份还在未跟踪状态**。核对方式：`git ls-tree -r --name-only xiranite-rust-rewrite | grep -E "^crates/(quickjs-host-protocol|quickjs-realm)/"` ⇒ 空；而 tip 里 `pub enum HostOperation` 仍定义在 `crates/xiranite-quickjs-executor/src/host_calls.rs`（也就是 tip 比工作树**旧**）。

于是：
- 我的 enum/臂/期限消费 落在未跟踪的新文件里 ⇒ 提交就是把别人半成品的新 crate 替他们提上去。
- `scripts/audit-quickjs-host-ops.ts` 里我的修正依赖同一文件里他们未提交的 rule 7（`HOST_PROTOCOL_SOURCE`、`vocabularySources`）⇒ 摘不出干净的一半。
- `packages/host-capabilities/src/operations.generated.ts` 现在列 31 个名字；单独提交它 = 让 tip 出现「能力面声称有、宿主不答」的名字（正是这条门禁要拦的事）。
- executor 的 **lib 测试目标当前编译不过**：`findz_operations.rs:855` 调 `crate::sidecar::drain_watch_batches`，而 `src/sidecar.rs` 未入库（另一条 lane 的在途件）。这也是我的测放在 `tests/` 而不是 unit 测的原因。
  - **这条在 2026-10-06 01:03 不再成立**：`src/sidecar.rs` 已进工作树，`cargo build -j 1 --bin quickjs-run` 与 `--bin print-host-ops` 都 rc=0（5.59 s / 0.80 s，串行）。当时写下的落点（`tests/`）不需要动，但「lib 编不过」这句别再当理由引用。

快照（15 个文件 + 当时 tip sha）在 `/Users/glow/_snapshots/xiranite-clock-sleep-A/`；已给「QuickJS 模板化封装（分支）」那条会话发交接说明，问一句搬完之后 enum 与 clock 臂各住哪个文件。

## 底座入库后要做的三件事（机械活）

1. 把上表的 Rust 五处 + TS 四处重新贴到位（文件若改名，按新路径贴；语义不变）。跑同一批测：`cargo test -p quickjs-host-protocol`、`cargo test -p xiranite-quickjs-executor --test clock_sleep`、`bun run --cwd packages/host-capabilities check:types`、`bun run test:quickjs-host-ops`、三 crate clippy。
   - 现状核对（2026-10-06 01:00 现读）：`quickjs-host-protocol` 与 `quickjs-realm` **仍未入库**（`git ls-tree -r --name-only HEAD` 对这两个路径零命中，`but status` 里是 `A`），而内容已经在工作树里，所以这一条不是「重新贴」而是「等入库后复跑同一批测」。
2. ~~Freshness 断言要自己证伪一次~~ **已证伪（2026-10-06 01:00）**：`touch crates/quickjs-host-protocol/src/operation.rs` 后 `bun scripts/audit-quickjs-host-ops.ts --use-built-bin` 报 **rc=1**、指向 `scripts/audit-quickjs-host-ops.ts:323` 的那条 mtime 断言（打印 bin 与源的两侧 ISO 时间）；不带 flag 复跑 `cargo build -j 1 --bin print-host-ops`（5.59 s）后回 **rc=0**，读数为「宿主答 31 个」。同一次跑还确认 `clock.sleep` 在 31 个里。
3. sleept 抬升本身：**`sleep` 这条腿已落地并实测**（下面第 3a 条），剩下的注册与 CPU/网速两条腿见 3b。

### 3a. `sleep` 走 `clock.sleep`（已做完，2026-10-06 01:08，本机 macOS）

- 落点只两文件：`packages/nodes/sleept/src/platform.ts`（`sleep: (milliseconds) => clock.sleep(milliseconds).then(() => undefined)`，文件头那条「realm 无定时器」的缺口随之从三条减到一条）与 `platform.test.ts`（两条新测）。`core.ts` 一行没改——它要的每个等待是 1000 ms 或 500 ms 一拍，正好等于 `MAX_SLEEP_MS_PER_CALL`，所以是单次请求不是循环。
- **真机跑通了 realm**：`bun run build:node-bundles --only sleept`（30/30 ok）→ `target/debug/quickjs-run artifacts/node-bundles/sleept.js runSleept createNodeSleeptRuntime '{"action":"countdown","seconds":2,"dryrun":true,"powerMode":"display-sleep"}' <root> --node-id sleept --budget-bytes 16777216`
  ⇒ `success:true`、`elapsed_ms=2063`、`events=3`、`[dryrun] Countdown completed; simulated display-sleep.`。**这个节点此前从未在 realm 里跑成过。**
- **等待确实在宿主侧、且可打断**（同一条码、同一个输入，只差 flag）：`--cancel-after-ms 1200` ⇒ `elapsed_ms=1230`（另一次 1254）、文档 `{"success":false,"message":"quickjs-run: operation cancelled"}`、rc=2。2 秒倒计时在 1.2 秒被掐断，说明取消落在等待**中间**——realm 内的本地定时器做不到这件事。
- 测的两条对照：桩掉 `hostCapabilities.clock.sleep` 记下请求，把 `platform.ts` 那一行还原成 `setTimeout` 后**只有**「the runtime's sleep is the surface's clock.sleep」变红（`1 failed | 9 passed`），证明这条断言量的确实是「谁在等」而不是「时间过没过」；另一条钉住边界（`MAX_SLEEP_MS_PER_CALL` 答得到、`+1` 报「may not exceed」）。
- 全套复跑：包内 `bun run test` **41/41**（6 个文件，含 `cli.test.ts` 里那条真跑 1 s 的 countdown dry-run）、`tsc -p tsconfig.json --noEmit` rc=0。
- 台账 `docs/migration/node-quickjs-workorders.md:115`（`timer.after` 记 3 个含 sleept）与 `:372`（sleept 行的 `timer.after`）现在过期，但那个文件在另一条 lane 的未提交改动里（`M`），**我没有替他们改**；接手的人把 sleept 从 `timer.after` 里划掉即可，`recycleu`/`comfygure` 仍在榜上。ADR-0079:139 缺口③里「`sleept` 的采样节拍」这半句同理。

### 3b. 剩下的：注册与 CPU/网速两条腿（这轮没动，因为挡路的是归属不是代码）

先量清了 sleept 今天为什么注册不上，两条都可复现：

1. **登记生成器拒它，理由可指到行。** `artifacts/node-scripted-requirements.json` 的 sleept 行是 `status: "needs-named-grants"`；`scripts/embed-node-bundles.ts:225` 那条规则在这种行上问 `resolvedPrograms(...)`，而它（`:140-146`）只要 `pendingProcessGrants` 非空就返回 `null` —— 清单里 sleept 正是非空（`"command at packages/nodes/sleept/src/platform.ts:249"`）。所以盘上 `crates/xiranite-scripted-nodes/src/registration.rs` 把 sleept 记进 `UNREGISTERED_BUNDLES`，不是漏配。
   - 九个程序名（`pmset`/`open`/`osascript`/`shutdown`/`rundll32.exe`/`systemctl`/`xset`/`xscreensaver-command`/`powershell.exe`）都已在清单里带证据行，但 `runOrThrow(command.executable, …)` 那个调用点**确实是运行时算出来的**，所以这条 pending 是真的。**不许靠改代码形状把它糊过去**（改名、加 switch 让分析器看见字面量，都是给门禁而不是给权限找理由）。
   - 让它诚实消失的唯一路径：电源动作不再由节点 spawn。熄屏/屏保连同四条机器状态一起挪进 `power` 服务，节点只发 `service.invoke` —— 这本来就是那个服务的自然归宿，也和 CPU/网速两条腿（`os.cpu.usage`、`os.net.counters`，宿主两侧都答得出、`audit:quickjs-host-ops` 今天数它们在内）是同一条路。挪完之后 `external-process` 这一级从分析产物里掉出去，`pendingProcessGrants` 归零，登记才该放行。
2. **两个数必须人拍，我没填。** 清单里 sleept 的 `maxLiveBytes` 是 `null`，而 `scripts/embed-node-bundles.ts:118` 自己写着「producer 填这个数是把政策伪装成测量」；`run_deadline_ms`（A 方案新加的字段）同理——sleept 的倒计时是小时级，默认 120 s 会把它腰斩，具体给多大是用户的决定。

- 顺序依赖照旧：`platform.ts` 一旦用服务，面侧传输按设计**拒绝** `service.invoke`（`packages/host-capabilities/src/node.ts:392-398` 那条按名字拒绝的臂），所以「改 core 的机器读法」和「面改走 /operations」必须是同一笔，否则 CLI 立刻不能跑。`sleep` 这条腿不受这条约束——`clock.sleep` 两侧都答，所以它今天就能单独落地，也正是这轮落的那一刀。
- 电源动作暂时继续走 `proc.exec` + 清单授权。`power` 服务这轮之后答 `info`/`request` 五个机器状态（那条 lane 已把 `dryRun` 补上并拒收不认识的参数——「预演」被忽略时真机睡过一次，是他们记的），仍然没有熄屏/屏保；且 mac 臂的 `ok:true` 只代表「请求交给 System Events」、不代表屏幕真熄。

## 明确没做 / 未验证

- Windows 两条熄屏/屏保命令**没在真机执行过**（2026-10-06 01:00 又试了一次：`ssh 30902@100.122.176.77`  connect timeout，rc=255；本机无 pwsh）。写的是 `WM_SYSCOMMAND` 的 `SC_MONITORPOWER=2` / `SC_SCREENSAVE`，语义按 Win32 文档。
  - 接手时的坑先记下：`SendMessage(HWND_BROADCAST, WM_SYSCOMMAND, …)` 只对**交互式会话**有效，而 ssh 起来的子进程在会话 0，直接跑会得到「rc=0 但屏幕没反应」的假阴性；要么用 `schtasks /RU <user> /IT` 落地到交互会话，要么把这条明确写成「未验证」。屏保那条还得先看 `HKCU:\Control Panel\Desktop\SCRNSAVE.EXE` 配没配，没配时 `SC_SCREENSAVE` 本来就是空动作。
- Linux 臂同理，只做到「写清楚」，没跑过；屏保那条没有 portal 化的「立刻开始」，我没拿锁屏冒充。
- 计时器跨 app 重启：按用户决定**不做**（也因此没碰 `kv_store`/重启对账；`docs/adr/0020…:7` 那条 no-automatic-resubmission 规则仍未在 Rust 实现，这是它的现状，不是我引入的）。

## 2026-10-06 01:3x：那两个数已拍并接上线（用户授权代填）

用户原话：「maxLiveBytes 看着填就完了吧；倒计时按理来说没上限，你看设个合适上限就行。」两个数都写进了 `docs/xiranite-target-node-manifest.json` 的 sleept 记录，各自带一条 `evidence` 行说明出处（门禁自己要求这两条线必须存在）。

- **`maxLiveBytes: 16777216`**。下限是量出来的，不是抄的：`target/debug/quickjs-run` 对 sleept 自己那份 bundle 逐档试 `--budget-bytes`——262144 与 524288 与 786432 与 917504 全部拒（前两条是 `out of memory`，后两条装载即失败），**1048576 才第一次把一次完整倒计时跑完**（`elapsed_ms≈1021`）。这个节点没有 wasm 时代的 `plugins/sleept/manifest.toml` 可以继承（`git log --all -- plugins/sleept/manifest.toml` 空），所以另一半理由是它能持有的最大输入：单次 `proc.exec` 的 stdout，宿主自己钉在 `MAX_PROCESS_OUTPUT_BYTES = 1048576`（`quickjs-run` 每次都在 stderr 印这个数）。16 MiB ⇒ ≥3× 该最坏情况，且与已定上限的同类保留节点同值（classq/linedup/samea/timeu 都是 256 页 × 64 KiB）。
- **`runDeadlineMs: 86400000`（24 小时）**。出处是节点自己的词表：`packages/nodes/sleept/src/interaction.ts:82` 把倒计时小时数封顶在 23 ⇒ 最长倒计时 23:59:59，取整到 24 h 给一小时余量。这条存在的理由也写在证据行里：`DEFAULT_RUN_DEADLINE` 是 120 s（`crates/quickjs-realm/src/jobs.rs:49`），而 `netspeed`/`cpu` 的 `maxWaitSeconds` 在词表里 0 就叫「无限」（`interaction.ts:108` + `previewWait`），所以 run 期限是唯一后盾——一个被忘记的监视器最多吃掉一条 `spawn_blocking` 线程一天，而不是永远。粒度够细：`clock.sleep` 单次不超过 1000 ms，等待期间期限至少每秒被读一次。

### 接线（不改就只是两个躺在 JSON 里的数）

- `scripts/embed-node-bundles.ts`：清单里的 `runDeadlineMs` 现在会被抄成 `.run_deadline_ms(n)`，**没声明就不 emit**（保留执行器默认，而不是替节点发明一个数）。
- `scripts/audit-target-node-manifest.ts`：`NodeRecord` 加该字段，并照 `maxLiveBytes` 的同一条规矩把守——必须是正整数毫秒或 `null`，且写了数就得带 `runDeadlineMs: <出处>` 证据行；**没写不算错**（与 ceiling 不同，ceiling 缺失是注册阻断）。
- 新增 `--manifest <path>` 只给 `--print-registration` 这条只读诊断用（写在写路径上会被直接拒），因为「今天没有任何已登记节点声明期限」意味着不加这个入口，这条 emit 就只能对着空集合断言、删掉那段代码也照样绿。

### 实测

- `bun test scripts/embed-node-bundle-subset.test.ts` 7/7；把 emit 那一行换成注释后**只有**新增那条变红（`6 pass / 1 fail`），改回即全绿。
- `bun test scripts/audit-target-node-manifest.test.ts` 24/24；`bun run audit:target-node-manifest` OK（51 records / 30 目录 / 28 保留）。
- 清单那条「无上限」点名列表里 **sleept 已不在**（现读 21 个，按字母序 smartzip 在前而 sleept 缺席）。
- 类型：`scripts/` 不在任何 tsconfig 的 include 里，所以按 `tsconfig.node.json` 的同款 flag 单文件跑 `tsgo`，并与 `git show HEAD:` 出来的同名副本对比错误**消息集**——新增为空（HEAD 侧多出的是副本重读 helper 造成的重复行）。
- `bun run audit:node-registry` 现在仍红，但红点不在这里：唯一一条 FAIL 是 `linedup` 同时被 `crates/nodes/linedup/` 与脚本表服务（那条 lane 刚在 01:27 重生成 registration.rs，把注册数从 1 变成 classq/linedup/logx/nameu/samea/timeu 六个）。sleept 仍是 WARN（拒登记的理由只剩 grants 那条）。
- ⚠️ 一个不属于我的漂移值得接手的人知道：签入的 `registration.rs:136` 里 sleept 的拒绝理由还写着 `execFileAsync(powershell.exe) … node:child_process … platform.ts:74`，而 00:59 重生成过的 `artifacts/node-scripted-requirements.json` 与 `node-host-requirements.json` 现在都写 `proc.exec(command) … runOrThrow is called at packages/nodes/sleept/src/platform.ts:128`，且现行 `platform.ts` 里 `node:child_process` 零命中。**我没有替他们重跑 embed**：那会用当前工作树重打全部 30 份 `bundles/*.js`，等于把别人在飞的节点源码替他们提交。
