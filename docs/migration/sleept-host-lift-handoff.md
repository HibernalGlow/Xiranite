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

快照（15 个文件 + 当时 tip sha）在 `/Users/glow/_snapshots/xiranite-clock-sleep-A/`；已给「QuickJS 模板化封装（分支）」那条会话发交接说明，问一句搬完之后 enum 与 clock 臂各住哪个文件。

## 底座入库后要做的三件事（机械活）

1. 把上表的 Rust 五处 + TS 四处重新贴到位（文件若改名，按新路径贴；语义不变）。跑同一批测：`cargo test -p quickjs-host-protocol`、`cargo test -p xiranite-quickjs-executor --test clock_sleep`、`bun run --cwd packages/host-capabilities check:types`、`bun run test:quickjs-host-ops`、三 crate clippy。
2. **Freshness 断言要自己证伪一次**：`touch crates/quickjs-host-protocol/src/operation.rs` 后 `bun scripts/audit-quickjs-host-ops.ts --use-built-bin` 必须红（报 bin 比源文件旧）。我目前只在「旧 bin vs 新 bin 数出 30/31」这一件事上量过它拦的到底是什么。
3. 继续 sleept 抬升本身（还没开始）：注册进脚本表（`crates/xiranite-builtin-host/build.rs` 的手写 bundle 列表 + `crates/xiranite-scripted-nodes/src/registration.rs` 生成，`run_deadline_ms` 与 `maxLiveBytes` 两个数要人定——后者按门禁自己的文档必须由人拍，`audit:node-registry` 现在对 sleept 报的就是这两条），`packages/nodes/sleept/src/platform.ts` 的 CPU/网速改走 `os` 服务（`cpu.usage`、`net.counters` 已入库并测过）、`sleep` 改走 `clock.sleep`，然后 `cli.ts`/`Tui.tsx` 改走 `/operations`（dissolvef 那套 `sharedHostHandle`/`stopSharedHost` 可直接复用），GUI 复跑。
   - 注意顺序依赖：`platform.ts` 一旦用服务，面侧传输按设计**拒绝** `service.invoke`，所以「改 core 的机器读法」和「面改走 /operations」必须是同一笔，否则 CLI 立刻不能跑。
   - 电源动作暂时继续走 `proc.exec` + 清单授权（`pmset`/`open`/`osascript`/`shutdown`/`rundll32.exe`/`systemctl`/`xset`/`xscreensaver-command`/`powershell.exe` 九个名字与证据行都已在 `docs/xiranite-target-node-manifest.json`）。`power` 服务现在只答 `info`/`request` 五个机器状态，没有熄屏/屏保；把这两条挪过去是它的自然归宿，但那是 `crates/xiranite-core/src/power.rs` 那条 lane 的形状，且 mac 臂的 `ok:true` 只代表「请求交给 System Events」、不代表屏幕真熄（他们已记）。

## 明确没做 / 未验证

- Windows 两条熄屏/屏保命令**没在真机执行过**（ssh 到 3090 超时；本机无 pwsh）。写的是 `WM_SYSCOMMAND` 的 `SC_MONITORPOWER=2` / `SC_SCREENSAVE`，语义按 Win32 文档。
- Linux 臂同理，只做到「写清楚」，没跑过；屏保那条没有 portal 化的「立刻开始」，我没拿锁屏冒充。
- 计时器跨 app 重启：按用户决定**不做**（也因此没碰 `kv_store`/重启对账；`docs/adr/0020…:7` 那条 no-automatic-resubmission 规则仍未在 Rust 实现，这是它的现状，不是我引入的）。
