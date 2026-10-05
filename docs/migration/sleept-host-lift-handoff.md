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

## 2026-10-06 02:30：宿主已经能答熄屏与屏保（提交 1eb3705d）

注册的最后一条理由是 `pendingProcessGrants`，而它的因由是电源动作仍在节点里 spawn。这一刀把答案放到宿主那一侧：

- 新模块 `crates/xiranite-core/src/power_session.rs`：`SessionPowerAction`（沿用三面的拼写 `display-sleep` / `screensaver`）、`plan_for`（每平台的 argv 与机制名）、`SessionBackend`（真实臂 `CommandBackend`、排演臂 `DryRunBackend`）、`request_with`（闸门/路由/分类一次走完，排演只换 backend）。
- 执行器 `power_operations.rs`：**一个入口、两套词表**——`request` 先看屏级拼写，否则落回五条机器状态；`info` 多一条 `sessionActions`（每条带机制名）；未知动作的拒绝同时点名七个。
- 新集成测 `crates/xiranite-quickjs-executor/tests/power_session_service.rs`：走产品节点那条路（`service.invoke` + 声明 `power` 的 spec），断排练、`force` 拒绝、小写 `dryrun` 拒绝、未知动作点名，以及没声明服务就拒在机制之前。

为什么是第二个类型而不是给 `PowerAction` 加两个变体：机制不同（`system_shutdown` 4.1.0 三平台都没有屏级臂）、可逆性不同（不动运行中的工作，碰一下鼠标就回来）、且它们没有 `force` 这条轴——硬塞进去要么再造一个只能说谎的 `ForceRoute`，要么给 `PowerSupport` 加两个恒真布尔。

实测（本机 macOS，串行 `-j 1`）：`cargo test -p xiranite-core` 全绿（lib 100，含新模块 9 条 + 6 个集成套件）；`cargo test -p xiranite-quickjs-executor --tests --no-fail-fast` 12 个集成套件全绿（含新 5 条）；clippy 两 crate `--all-targets --no-deps -j 1 -- -D warnings` rc=0（输出未过滤）。
- **他 lane 的两条红**（不是我引入、我没碰 `host_calls.rs`，该文件相对 HEAD 有 147+/357− 未提交改动）：`a_cancel_lands_inside_a_wait_that_would_otherwise_run_for_minutes` 与 `one_call_is_capped_so_the_pump_keeps_ownership_of_the_deadline`，后者请求 60001 ms 而臂读到的上限是 1000 ms——此刻它们的测试与常量各说一套。
- 变异对照：把 dispatch 的屏级路由改回机器状态那条 ⇒ 新集成测 4 红 1 绿（绿的正是与路由无关的未授权拒绝），改回 5/5 绿。
- 真实后端是被量的：不存在的程序 ⇒ 拒绝里带程序名且 `kind()==NotFound`（`io::Error::new(kind, …)` 保 kind，`Error::other` 会抹成 `Other`，这条是测出来的）；非零退出用 `/usr/bin/false` 实测。

### 抬升剩下的形状（这一刀之后才看清）

`platform.ts` 的六个动作改走 `power` 服务、CPU 与网速改走 `os` 服务的 `cpu.usage`/`net.counters`、三面改走 `/operations`、注册——**同一笔**。搬完之后 `netstat` 与 Windows 的 `Get-NetAdapterStatistics` 那条 powershell 一起消失，节点剩下的唯一 `proc.exec` 是剪贴板 helper（分析器按 `node-feasibility.ts:355-363` 的 clipboard 规则本来就不计为节点需求），于是 `external-process` 这一级从分析产物里掉出去、`pendingProcessGrants` 归零、清单那十条程序名一起退场，注册的门才真的开。

## 2026-10-06 02:34：有人把 `platform.ts` 整份写回成我改动之前的样子（已恢复）

- 现象：`packages/nodes/sleept/src/platform.ts` 磁盘内容 251 行、mtime 02:28，是 **提交 b4259591 之前** 的版本——`sleep` 回到 `new Promise(setTimeout)`，`let lastCpuSample = readCpuSample()` 回到模块作用域（那正是 45762af1 修掉的「bundle 求值期读机器」崩溃）。我的提交在历史里完好，被覆盖的只是工作树。
- 证据与判据（不是猜）：把那份内容放回磁盘跑 `vitest src/platform.test.ts` ⇒ `1 failed | 9 passed`，红的正是「用的确实是 clock.sleep」那条；`git checkout xiranite-rust-rewrite -- packages/nodes/sleept/src/platform.ts` 之后 `rg` 数到 `clock.sleep(milliseconds)` 1 次、包内 41/41 绿。两份内容都留在 `_scratch/revert-evidence/` 之外由本会话删除，但差异本身已记在这里。
- 同期 `crates/xiranite-core/src/power_session.rs` 在 `git diff HEAD` 里显示 −373，磁盘却是 20114 字节且与我提交的 blob `cmp` 逐字节相同 ⇒ 那是 `D `/`??` 索引簿记的盲区（`git diff HEAD` 不看未跟踪内容），不是丢文件。**判归属别只看状态码形状：`but diff <path>` + 提交后 `git show --numstat` + `cmp` 与分支 blob。**

## 最后一刀的机械清单（照这个改就不用再考古；今天没做，因为 embed 窗口还关着）

面侧现在还在**自己跑引擎**，四处直连：

| 位置 | 现在 | 抬升后 |
|---|---|---|
| `packages/nodes/sleept/src/cli.ts:37,40` | `import { runSleept } from "./core.js"`、`import { createNodeSleeptRuntime, readClipboardText } from "./platform.js"` | 删掉对 core 实现的 import（ADR-0074 §5）；剪贴板那条是**面侧 UX**，实现留在面里（分析器按 `node-feasibility.ts:337` 的 `NON_PLUGIN_SOURCE_FILES` 不看 `cli.ts`，所以不需要清单授权） |
| `cli.ts:158` `defaultDependencies.createRuntime` | 注入 Node runtime | 换成 `@xiranite/cli-runtime/backend` 的 `sharedHostHandle` / `stopSharedHost` / `createOperationsClient` / `extractHostAttachArgs`（照 `packages/nodes/dissolvef/src/cli.ts:30,178,201` 抄，路由 `/nodes/sleept/operations`） |
| `cli.ts:244`、`:428-430`、`:696` | 三处直接 `runSleept(...)` | 三处都改成打宿主；`:558` 的剪贴板默认值保持在面里 |
| `packages/nodes/sleept/src/Tui.tsx:25-30` | 值导入 `countdownSeconds`/`formatDuration` | 这两个纯展示函数要么进 `@xiranite/cli-runtime`，要么由宿主结果文档给（不许留在面里引 core 实现） |
| `src/nodes/sleept/Component.tsx:5,121` | GUI 已经走 `useNodeSurface` + `run("sleept", …)`，但仍值导入 `@xiranite/node-sleept/core` 的两个格式化函数 | 同上；GUI 这条腿本来就在 /operations 上 |

节点侧：`platform.ts` 的 `executePowerAction` 改问 `service.invoke("power","request",{action,dryRun})`，映射表要保三件事——**词表不漂移**（节点说 `restart`，宿主答 `reboot`）、**拒绝不被替换**（macOS 的 `hibernate` 现在由 `resolvePowerCommand` 返回 `undefined` 并点名平台；换服务后必须落到宿主的 `not-supported` 码，`platform.test.ts` 里「a mode the platform refuses is named, not substituted」那条就是钉这件事的）、**`dryRun` 传过去**（宿主已实现，缺它就把预演变成真动作）。CPU/网速改问 `os` 服务的 `cpu.usage`/`net.counters`，`node:os` 的 `cpus()` import 随之删除。

顺序：`bun run audit:node-feasibility`（重算分析产物，`external-process` 应从这里消失）→ `bun scripts/derive-scripted-policy.ts --requirements` → `bun run build:node-bundles` → `bun scripts/embed-node-bundles.ts`（**这一步会重打 30 份 bundles，必须等别人的节点源码静止**；今天 findz 那条 lane 在 02:3x 还在连续提交）→ `bun run audit:node-registry` 与 `bun run audit:target-node-manifest` → 三面复跑（CLI 真跑一次 countdown dryrun、TUI 起一次、GUI 复跑 Vitest browser）。清单里那十条程序名与 `pendingProcessGrants` 应随 spawn 退场一起删掉，由 `--apply-host-requirements` 自己算，不许手摘。

## 2026-10-06 02:50：抬升不再需要等「别人源码静止」——embed 加了 `--refresh <id>`

前面把最后一刀挡住的其实不是逻辑，是这一步会**替所有人重打 30 份 bundles**：artifact 是从工作树构建的，多泳道同树时一次全量 embed 就把别人的未提交节点代码打进 `bundles/`、记在我的提交信息下。所以给它加一个只拷被点名节点的写入模式。

- `scripts/lib/embedded-index-merge.ts`（新）：合并规则从 `embed-node-bundles.ts` 里搬出来，因为那个文件 import 即 `await main()`，不搬就没法单测。**规则只有一条**：只有被刷新的 id 取新行，其余行继续描述盘上那份字节。写成全量替换是假陈述——那 22 行会声称自己拷过而其实没拷。
- `scripts/embed-node-bundles.ts`：`--refresh <id>`（可重复）；与 `--check` / `--print-registration` / `--node` 互斥（直接拒，两种「子集」同时点名只会让下一次读表的人猜）；id 不在当天 artifact 列表里也拒（照 `--node` 那条先例）；写文件只写被点名的，`index.json` 走合并，`registration.rs` 照常全量重生成（表的内容不依赖 bundle 字节，只依赖清单与 policy artifact）；摘要行改成本次真拷了多少个、多少 MiB。
- 测：`scripts/lib/embedded-index-merge.test.ts` 3 条（新文件，进 `vitest.scripts.config.ts` 的显式 include——那份 config 的注释就是为这个写的：`test:unit` 只收 `src/**`，脚本侧的门禁得点名）。

实测（沙箱 = 只把 embed 需要的 8 类路径 + 24 份 bundles + 80 份 artifacts 拷到 `_scratch/sandbox`，不碰仓库）：
- `--refresh classq` ⇒ 变的只有 `classq.js` 与 `index.json`，零删除；24 行里每一行的 sha 都等于盘上那份字节；`SCRIPTED_NODE_IDS` 与不带 `--refresh` 时一致（classq/linedup/logx/nameu/samea/timeu 六个），证明这张表不受局部刷新影响。
- 变异对照：把合并规则改成「凡 fresh 里有的都替换」⇒ 同一条命令后 **22 行的 sha 对不上盘上字节**；而 `--check` 正好报 22 个 `embedded bundle is stale vs the manifest`（这也是它对全量刷新漂移的既有行为）。也就是说这条规则一旦被写坏，仓库里那把尺看得见，不是只靠测兜着。
- 类型：`tsgo` 按 `tsconfig.node.json` 同款 flag 单文件跑 `scripts/embed-node-bundles.ts` + 两个新文件，并与 `git show xiranite-rust-rewrite:` 的同名副本比错误消息集 ⇒ 12 vs 12、新增为空（`scripts/` 不在任何 tsconfig 的 include 里，这仍是唯一诚实的比法）。
- 顺带一条真红被我自己的测抓到过：先把合并简化成 `freshById.get(id) ?? entry`（漏了 `refresh.has` 这个条件），新测第一条立刻红。这条测就是为这个 bug 写的，它值回票价。

**抬升的顺序因此改了**：不再等窗口。`platform.ts` 六个动作走 `power.request`、CPU/网速走 `os` 服务、三面改走 `/operations` 之后，producers 依次 `audit:node-feasibility` → `derive-scripted-policy --requirements` → `build:node-bundles`（只这一条会重算全部 artifact，但它写的是 gitignored 的 `artifacts/`）→ `embed-node-bundles.ts --refresh sleept` → `audit:node-registry` / `audit:target-node-manifest` → 三面复跑。

## 2026-10-06 03:00：节点侧那一半我已经写完并实测了，但它不能单独落盘，于是撤出工作树

`--refresh` 把「等窗口」这个理由消掉之后，我直接把 `packages/nodes/sleept/src/platform.ts` 换成了纯服务版（`node:os` 的 `cpus()` import 删除、`netstat`/`Get-NetAdapterStatistics`/九条程序 spawn 全删、`resolvePowerCommand` 与三张平台表删除、`sleep` 走 `clock.sleep`），跑了 realm 取证，然后**把文件退回提交版**并把改动存到仓库外：`/Users/glow/_snapshots/sleept-switch-platform/platform.ts`（125 行，附 base tip sha）。

为什么撤出：这一半与「三面改走 /operations」必须同一笔（面侧传输按设计拒绝 `service.invoke`，`packages/host-capabilities/src/node.ts:392-398`）。单独留在工作树里有两个实际危害——CLI 当场不能跑；以及别人一次全量 embed 会把这份未提交的 platform.ts 打进 `bundles/sleept.js`、记在他们的提交信息下。这正是 `--refresh` 要防的事，我不该反过来制造它。

### 实测（realm，`--services os,power`，`--budget-bytes 16777216`，本机 macOS，串行）

| 输入 | 结果 |
|---|---|
| `{"action":"status"}` | `success:true`、`elapsed_ms=232`、`currentCpu: 72.34210205078125`——**ADR-0079 缺口④对这个节点到此结束**，之前这条永远是「os.cpus 答不出 per-cpu times」的 refusal |
| `{"action":"get_stats"}` | `success:true`、`CPU: 65.5%, upload: 3609.7KB/s, download: 3252.9KB/s`，一次 `netstat` 都没跑 |
| `countdown 1s dryrun display-sleep` | `success:true`、`elapsed_ms=1035` |
| `countdown 1s dryrun hibernate` | `success:false`，`hibernate was refused by the host: host operation service.invoke failed: the "osascript-system-events" power backend does not support hibernate` |

最后那条是**有意的产品变化**：预演过去在 `if (dryrun) return` 处直接返回，macOS 上 `--dryrun --mode hibernate` 会对着一个本机进不去的状态报「模拟成功」；`dryRun` 传到宿主之后，闸门在排练里也照答。用户那条「失败前置」就是要这个。

### 两条新量到的接口事实（写代码前不该靠猜）

- **`ok:false` 的服务回答不会作为值到达调用方**：shim 直接抛（`packages/quickjs-shims/src/host.ts:296-304`，`hostRejected`），拒绝文档挂在 `error.details`。所以 `platform.ts` 里写 `if (answer.ok === true) return` 是不可达分支——我第一版就是这么写的，跑出来才发现。
- **`error.details.code` 到不了 bundle 的 catch**（realm 里实测：`(failed)` 而非 `not-supported`），只有 `message` 文本活着穿过节点边界。因此最终版只把 mode 名字加上（宿主文案不知道用户点的是哪个 mode），不再打印自己读不到的 code。Rust 侧 `power_session_service.rs` / `sleept_service_contract.rs` 断言的 `code` 是**服务层的答案形状**，与 bundle 层看到的抛错是两件事，别混着写。

### 剩下的面侧一半（下次接着做，逐条都在盘上可指）

1. `cli.ts:37,40` 删 `runSleept`/`createNodeSleeptRuntime` 的值导入；`readClipboardText` 从 `platform.ts` 搬进 `cli.ts`（它是面侧 UX 默认值，分析器 `node-feasibility.ts:337` 本来就不看 `cli.ts`，`clipboardIsDemand` 那条规则 `:444` 也只在 core 提到剪贴板时才算需求）。
2. `cli.ts:158` 的 `defaultDependencies.createRuntime`、`:244`/`:428`/`:696` 三处 `runSleept(...)` 改 `sharedHostHandle` + `createOperationsClient`（照 `packages/nodes/dissolvef/src/cli.ts:30,178,201`）；`cli.ts:240-250` 那圈 `isCancelled`/`waitWhilePaused` 闭包改成操作的 pause/resume/cancel 控制（realm 侧 `clock.sleep` 已经能在等待中间落取消，实测过）。
3. `platform.test.ts` 里钉 `resolvePowerCommand`/`parseMacInterfaceCounters` 的用例随之换成钉 `POWER_ACTIONS` 表与 `isLoopbackInterface`（loopback 必须继续排除：宿主报的是所有接口，本机 `lo0` 有 ~22 GB 本地流量）。
4. producers 依次：`bun run audit:node-feasibility` → `audit:target-node-manifest -- --apply-host-requirements`（sleept 的十条 programs 与 pendingProcessGrants 应自动退场、`services` 进 `os`/`power`；它会顺带想改别人节点的行，**只保留 sleept 那一段**并把改动行数报出来）→ `derive-scripted-policy.ts --requirements` → `build:node-bundles` → `embed-node-bundles.ts --refresh sleept` → `audit:node-registry` / `audit:target-node-manifest`。
5. 复跑：CLI 真跑一次 countdown dryrun（这次是打宿主）、TUI 起一次、`cargo test -p xiranite-scripted-nodes`（sleept 进表后 `every_registered_bundle_evaluates` 那条才第一次真的跑它）、GUI 侧不动（`src/nodes/sleept/Component.tsx` 在别人泳道里）。
6. `Tui.tsx:25-30` 与 `src/nodes/sleept/Component.tsx:5` 仍在值导入 core 的两个格式化函数（ADR-0074 §6 那条「面不许 import core 实现」的残留）。这次不动它：给两端都用的格式化函数找家要新引一处共享包依赖，而 `package.json`/`bun.lock` 现在在别人手里。

## 2026-10-06 03:28 抬升跑到「注册」这一步就撞上了共享清单：只把工具修好落盘，切换整体退回快照

做到注册时一次跑通的顺序（都跑过，命令在下面），结果是：**`--refresh` 解决了 bundles 字节的所有权问题，但没解决政策输入的共享问题**。

- `bun run audit:node-feasibility -- --force` ⇒ sleept 行变 `hostRequirements:["pure-logic"]`、`services:[{os,platform.ts:61},{power,platform.ts:122}]`、`programs:null`；`external-process` 从 9 掉到 8、`pure-logic` 从 1 升到 2。
- `bun run audit:target-node-manifest -- --apply-host-requirements` 会**顺带重写 bandia/findz/kisaki 三条**（别人源码在飞的读数），所以我把非-sleept 的行按 HEAD 逐条还原，并把 sleept 的十条 `programs` 与 `program:` 证据行删掉（调用点没了，授权留着就是过期授权而非窄授权）；`audit:target-node-manifest` rc=0。
- `bun scripts/derive-scripted-policy.ts --requirements` ⇒ sleept `status:"pure-logic"`、`pendingGrants:[]`，进「可登记」名单。
- `bun run build:node-bundles` ⇒ artifact 表从 24 涨到 28（bandia/cleanf/enginev/smartzip 有了 artifact）。
- `bun scripts/embed-node-bundles.ts --refresh sleept` ⇒ **只拷 1 份 bundle**（0.11 MiB of 28），sleept 进表：`SCRIPTED_NODE_IDS` 含 sleept，`NodeDescriptor::new("sleept",…).with_services(&["os","power"]).budget(16777216,1).run_deadline_ms(86400000)`。

### 但两处生成物此刻不能提交，都不是我的账

1. **生成器撞到自己的不变量**（这条是我的，已修）：部分刷新时 registration 从**当天 artifact 名单**生成，而 index 从**已内嵌集合**生成，两边数量不同 ⇒ `crates/xiranite-scripted-nodes/tests/every_generated_node_is_served.rs` 的「registered + refused == index 行数」直接红（8+20 vs 24）。修法＝部分刷新时登记与索引**同用一个内嵌集合**（`embeddedEntries`）。
2. **共享清单在别人手里同时被写**：我这次生成时 `dissolvef` 的 `maxLiveBytes` 已经在工作树里出现（HEAD 里没有，evidence 行写的是 `crates/nodes/dissolvef/manifest.toml memory_max_pages 256 × 64 KiB`），于是生成器**照实地把 dissolvef 也登记了**（表从 6 变 8）。这不是我的授权，也不该由我的提交生效。另有一条 `registered_scripted_node.rs:121` 的硬闸「内嵌集合大小 24→28」需要有人按新大小改数——那是他们那次 `build:node-bundles` 的自然后果，不是我该顺手改的测试。

所以：**抬升整体退回快照**（`/Users/glow/_snapshots/sleept-switch-platform/`：platform.ts / core.ts / cli.ts / 三个测 / 带 sleept 行的清单副本），工作树恢复到 HEAD 后我的路径零差异（`git diff HEAD` 对 `packages/nodes/sleept`、`registration.rs`、`bundles/index.json` 均空）。落盘的只有工具的两处修复与这条账。

### 面侧那一半的实测，退回之前都跑过（值得记，因为下次不用重找）

- `bun run test`（包内）39 条：`cli.test.ts` 换成真 HTTP 假宿主之后 17/17，`cli.visual.test.ts` 1/1（OpenTUI 那次是**真起宿主**跑的），`core.test.ts` 11、`platform.test.ts` 8。
- 假宿主的两条协议事实：`/node-operations/:id/events` 若只回 `phase:"completed"` 不回 result，TUI 的 task-queue 会报 `Operation op-1 ended without a result`；CLI 的 `status` 命令发给宿主的是 `action:"get_stats"`（脚本判决按 action 键，别按操作者的词键）。
- 面侧断言的口径换了：假宿主的 message 是我自己写进去的，所以**断言 sent input**（`{action,powerMode,dryrun}`）才有意义，断言回显文案是假绿。`powerMode()` 那个「认不出的拼写退回 sleep」的老风险改由 `not.toContain('"powerMode":"sleep"')` 钉。


## 2026-10-06 04:25：最后一刀落地面（三面 /operations + 机器读法走服务 + 注册），含两条假绿的结案

### 那一刀本身

- `packages/nodes/sleept/src/duration.ts`（新）：`countdownSeconds` / `formatDuration` 从 `core.ts` 搬出来，`core.ts` 改成 `import` + 一行 `export … from "./duration.js"` 转发（GUI `src/nodes/sleept/Component.tsx:5` 读的仍是 `@xiranite/node-sleept/core` 那个子路径，零改动）。`Tui.tsx` 的值导入改成从 `./duration.js` 取，`./core.js` 只留 `import type`。**为什么不按上面那张表说的「进 `@xiranite/cli-runtime`」**：AGENTS.md 反过来规定终端通用工具不许住在节点包里、节点语义也不许住进 cli-runtime；而「由宿主结果文档给」在这条腿上不成立——倒计时面板要在**操作还没有开始**的时候显示计划时长。判据读数：`audit-face-execution-path` 的 sleept 行 `coreValueImports: []`、`directRunCalls: 0`、`runtimeFactoryCalls: 0`、`protocolEvidence` 四条齐 ⇒ `verdict:"migrated"`，全仓 migrated 8→9。
- `cli.ts`：`runProgram` 现在先 `extractHostAttachArgs` 再 `withAttachFlags`（`--backend`/`--token`/`--channel-file` 折进宿主 env 并从 argv 摘掉，用 `backend.ts` 自己导出的三个 env 名常量），配一条测：`attaches through the face's own flags without leaking them into argv`。这条测的两半是同一个证据——标志没被摘掉就会撞进 citty 的用法路径（退出码 2），没折进 env 就去找真宿主。

### `createNodeSleeptRuntime` 的归属：报告，不删（配方 §6）

面侧确实不再调它（`runtimeFactoryCalls: 0` 是尺读出来的，不是我推的），但**它不是零消费者**：`crates/xiranite-scripted-nodes/src/registration.rs:97`、`bundles/index.json:199` 与 `packages/runtime/src/node-runner.generated.ts:179` 都按名字要它——宿主装载 bundle 之后调 `createNodeSleeptRuntime()` 建 runtime，再交给 `runSleept`。所以那份工厂留在 `platform.ts:46`，被删掉的只是面侧那条注入路径（`SleeptCliDependencies.createRuntime`）。

### 上一次会话留下的「hang」结案：不是死锁，是我自己的命令把两小时倒计时点了

`countdown --seconds 2 --dryrun --power display-sleep --json` 十分钟不返回、stdout/stderr 全 0 字节，`sample` 显示主线程停在 `kevent64`（⇒ 未落地的 Promise，不是阻塞调用）。协议层单独探针 2.1 秒跑完同一条命令，于是把 `JSON.stringify(input)` 打出来：**`{"action":"countdown","hours":2,...,"seconds":2}`** —— 用户 live 配置 `~/Library/Application Support/Xiranite/xiranite.config.toml` 的 `[nodes.sleept] hours=2` 被 `inputFromCountdownArgs` 当成缺省合成了进去（`status` 那条腿不读这些缺省，所以它一直好）。补 `--hours 0 --minutes 0` 之后 2.04 秒完成、`success:true`。教训一句：**面侧「卡住」先看它发出去的 input，别先怀疑传输**——同一份传输在两条腿上字节级等价。

### 今天撞到的两条假绿

1. **`bun` 当 vitest runner 会塌在 zod 上**：`bun node_modules/vitest/vitest.mjs run src` ⇒ `TypeError: undefined is not an object (evaluating 'z.object')`，`cli.test.ts` 收成 0 条测试；同一命令 `node` 跑 17/17 绿。这条**与我的改动无关**（未动的 `dissolvef` 同红，红在 `config/src/schema.ts:8`），但足以让人把自己的红记成别人的。包内 `test` 脚本本来就写 `node`，别换 runner。
2. **`embed --refresh <id>` 只拷贝、不重建**：我 04:04 改完 `core.ts` 再跑 `--refresh sleept`，它 0 字节改动、`rc=0`，摘要还说「sleept refreshed」——拷的是 `artifacts/node-bundles/sleept.js`，那份是 03:23 建的。已给 `scripts/embed-node-bundles.ts` 补一条 mtime 闸（`newestMTimeIn`）：被点名节点的 artifact 比它自己 `src/` 里任何一份源码旧就**非零退出并点名先跑 `build:node-bundles --only <id>`**。证伪走的是真序：改完直接 refresh ⇒ `rc=1` 点名 sleept；`build:node-bundles --only sleept` 之后再 refresh ⇒ 绿，且 bundle 里出现 `// packages/nodes/sleept/src/duration.ts` 那道模块横幅（这才是「生产者真跑过」的读数，摘要行那句「refreshed」不算）。

### 一次撤销的拆分，记下来免得有人再走

把 `resolveHostHandle`/`hostReady`/`hostOperationsClient`/`runSleeptOnHost`/`createSleeptHostDefinition`/`withAttachFlags` 拆到新文件 `host-run.ts`，`cli.ts` 从 885 掉到 738 行（低于它的 base 744）——但 `audit-face-execution-path` 立刻把 sleept 判回 `in-process`：`protocolEvidence` 是**对 face 文件自身源码做的正则**（`scripts/audit-face-execution-path.ts:134-141`），传输外包出去之后那个数组就空了。尺是权威（配方 §0），所以拆分已撤回、代码原样回到 `cli.ts`。**结论：这个尺要求协议调用留在面里，节点包里「再拆一个 host 层」的文件拆分对已迁移面不可用。** 遗留账一条：`cli.ts` 885 行 > base 744，真正的下一个拆分点是 gd 引导流（`runGuided`/`buildInputForAction`/`describe*` 那 ~200 行，里面没有协议名，拆它不动判据）。

### 登记落地的归属做法（共享清单同时被别人写那一问题的现行解）

`registration.rs` 我没有整份提交生成结果：以 `git show HEAD:` 那份为底，只插 sleept 的 8 行 + 两个表项 + `SCRIPTED_NODE_IDS` 里一个名字，并删掉 HEAD 那条「sleept 因 external-process 不登记」的理由行。`dissolvef` 那 8 行（来自别人未提交的 `maxLiveBytes`）留在工作树不进提交。验证不是靠读表：`cargo test -p xiranite-scripted-nodes -j 1` rc=0，含 `every_declared_service_is_answered_by_the_host`（4 条，钉 `with_services(&["os","power"])` 真被宿主答）、`the_two_lists_add_up_to_the_embedded_bundles`、`every_registered_bundle_evaluates…`（跑的就是新字节）；`cargo test -p xiranite-quickjs-executor --test sleept_service_contract --test power_session_service -j 1` 9/9；两 crate clippy `--all-targets -D warnings` rc=0。清单只提交我的 sleept 那一行（hunk 级），否则干净检出会重生成出「sleept 未登记」而 `registration.rs` 说已登记。

### 复跑命令（按串行的顺序）

```bash
cd packages/nodes/sleept && node ../../../node_modules/vitest/vitest.mjs run src --maxWorkers=1   # 40/40
bun scripts/audit-face-execution-path.ts --self-check                                            # migrated 9
bun run build:node-bundles --only sleept && bun scripts/embed-node-bundles.ts --refresh sleept
RUSTC_WRAPPER=sccache cargo test -p xiranite-scripted-nodes -j 1
XIRANITE_HOST_BIN=$PWD/target/debug/xiranite-dev-host bun packages/nodes/sleept/src/cli.ts \
  countdown --hours 0 --minutes 0 --seconds 2 --dryrun --power display-sleep --json
```
