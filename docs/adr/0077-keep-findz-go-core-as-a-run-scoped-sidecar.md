# findz 的 Go 内核留在仓里，但改成宿主按 run 持有的 sidecar 子进程

- Status: **accepted** — 2026-10-05 由用户判定：「最优方案：A2 选 process-wrap」。可行性已在真进程上跑过（§验证）。
- Date: 2026-10-05
- Related: `docs/adr/0053-build-findz-as-a-go-index-core-with-a-bun-worker-boundary.md`（本篇作废它的**原生绑定**条款，保留它对索引与边界的判断）、
  `docs/adr/0074-keep-runtime-boundaries-with-quickjs-as-one-node-executor.md` §1/§4/§5（一份实现、`service.invoke`、face 不持有引擎）、
  `docs/adr/0073-retire-wasm-and-register-native-nodes-through-inventory.md`（`NodeRequirements` 与「门禁查真实构建参数」）、
  `docs/adr/0075-keep-bun-as-runner-and-drop-bun-apis.md`（`bun:ffi` 那条待决项由本篇结案）、
  `docs/migration/findz-go-sidecar-roadmap.md`（分期、尺、未决）、`docs/migration/node-native-shape.md:166-172`

## 为什么这曾经是个问题

findz 是 QuickJS 架构下唯一的 `go-worker` blocker：它的业务实现不在 TS 里，而在 `native/findz-go`（非测试 3,286 行：CGo SQLite、zfind 遍历、imagemeta 图像头、GBK 成员名修复、任务/幂等/查询/treemap），由 `packages/findz-native/src/index.ts:103-112` 用 **`bun:ffi`** 载入 c-shared dylib，再由一个常驻 Bun worker 驱动（`packages/nodes/findz/src/findz-worker.ts`）。

三条实测事实把「照原样接进来」这条路堵死：

1. **realm 的门是闭集**：`crates/xiranite-quickjs-executor/src/host_calls.rs:75-138`（**该名单已按 ADR-0078 搬到 `crates/quickjs-host-protocol/src/operation.rs:9` 的 `HostOperation` 与 `:78` 的 `ALL`，现测仍是 30 个名字，门的封闭性不变**）只有 fs×17、proc×5、clock/random/digest、os×3 和唯一通用门 `service.invoke`——**没有 socket、没有 fetch、没有定时器、没有 worker、装不了原生模块**。所以 koffi / `child_process` / `fetch` 一个都进不来；realm 外能做，但 ADR-0074 §5 否决把第二份引擎放进 face 进程。
2. **`proc.spawn` 承不住 RPC**：`machine.rs:204` 把 stdin 焊成 `Stdio::null()`（全 crate 只有一处 `stdin` 命中）；`ProcessTable` 按 run 建且 `Drop` 必杀（`:70`/`:81`/`:314-321`）；白名单只收裸程序名、拒路径（`proc_operations.rs:118-126`）。它是为「起一个工具读一次性输出/进度日志」设计的，那条纪律本身没坏。
3. **Go 那份二进制从来没有构建门禁**：`ci.yml:167-168` 唯一的 Go 步骤是根模块 + `CGO_ENABLED=0` + `./cmd/... ./internal/...`，`native/findz-go` 是独立模块、从不被编译；`native/prebuilt/win32-x64/findz.win32-x64.zip`（9,032,655 B）是手工提交进 git 的。

## 决策

1. **Go 内核保留**，不翻成 Rust、不翻成 TS。ADR-0069/0074 说的「每节点一份实现」指的是**节点域语义**在 TS core；`native/findz-go` 与 `czkawka_core` 同性质——**借来的引擎**，不是第二份节点实现。用户 2026-10-05 判定的「每节点 Rust 实现归零」不受影响：本篇没有新增任何 `crates/nodes/<id>`。
2. **sidecar 作用域 = 一次 run**，不是宿主会话，也不是每次调用。`MachineAccess` 多一张表（一个字段 + `granted()`/`granted_in_place()` 两处构造 + 一个照 `processes()` 的访问器），run 结束**必杀必收**——沿用 `machine.rs:314-321` 那条纪律，因此「跨 run 泄漏进程」这个失败模式在设计上不存在。
3. **管道是行分帧，协议不动**：stdin 一行一个请求、stdout 一行一个响应，envelope 继续用 `native/findz-go/protocol.go` 那份（`requestVersion`/`requestId`/`method`/`params` → `ok`/`result`/`error{code,message,retryable,details}`），`service.handle()` 与 15 个方法分派（`service.go:89-274`）一字不改。串行 ⇒ 不需要请求 id 匹配。`ffi.go`（57 行四个 `//export`）换成 ~40 行行循环。
4. **终止交给 `process-wrap` 10.0.1 的 `std` frontend**（`features = ["std"]`——**`std` 不在 default 里**，实测自 10.0.1 的 Cargo.toml）。Unix 用 `ProcessGroup::leader()`（`start_kill` = `killpg(SIGKILL)`，`wait` 收干组内僵尸）；Windows 用 `JobObject`。**`kill-on-drop` 只有 tokio frontend 有实现**，所以「drop 必杀」仍归我们写——那本来就是仓里的纪律。
5. **fs 变更通知落宿主**：`notify` + `notify-debouncer-full` 在宿主侧订阅，投递进 Go 现成的 `watcher.apply_changes`（`service.go:149`）与 `watcher.set_health`（`:163`）⇒ **Go 零新依赖**。`packages/nodes/findz/src/watcher-service.ts` 的 250 ms 静默窗与 stat 稳定复查搬进宿主那张只放订阅与小缓冲的会话表（**不含进程**）。
6. **长任务语义跟 kisaki**：一次 run 内 `await` 长轮询到终态，`checkpoint`（`host_calls.rs:421-429`）是每轮的让出点；取消 = 宿主终止子进程，**靠 Go 自己的落盘恢复**（`database.go:74` 开库把 `running` 翻 `paused`）。GUI 的暂停/取消按钮改打 `POST /node-operations/{id}/pause|cancel`（`crates/xiranite-api/src/lib.rs:157-158`），不再是 findz 的 action。
7. **注册与门禁归零**：findz 从 `crates/xiranite-scripted-nodes/src/registration.rs:266` 的 `UNREGISTERED_BUNDLES` 移进 `SCRIPTED_NODE_IDS`；`scripts/audit-node-bundles.ts:69-73` 的 findz 豁免整条删除；`bun run audit:node-feasibility` 重跑并改掉 `no-host-free-answer`；`native/findz-go` 进 CI；9.0 MB 的 prebuilt zip 出库、改成构建产物。

8. **索引文件的落点归宿主，文件名归核心。** `library.open` 在宿主侧**拒绝**节点自带的 `databasePath`（不是静默丢掉——静默丢会让调用方以为生效了），持有者改为把 `XIRANITE_FINDZ_INDEX_DIR` 放进**子进程**环境；核心继续用 `libraryIDForRoot` 派生文件名并自己 `MkdirAll`（`database.go:58`），所以宿主给的是目录、永远不是文件名——两个不同数据根的装机不会给同一个库造出两个名字。落点数据根的优先序是 `XIRANITE_FINDZ_INDEX_DIR` → `XIRANITE_DATA_DIR` → 平台根；中间那条是补出来的：`xiranite_core::config_paths` 的 `data_dir()` **故意不认** `XIRANITE_DATA_DIR`（只有 `config_path()` 认），照抄就会让可移植装机「配置搬走了、索引留在平台缓存」——2026-10-05 实测到才补的。

9. **一轮失败的调用会把引擎逐出表，下一次调用起一个新引擎；失败那一次只回拒绝，不重放。** 缓存的 `Arc` 句柄在子进程崩掉之后照样「在」，不逐出就是同一 run 里之后每次调用都撞在同一条断管上——一次引擎崩溃把一个还能干活的 run 变成什么都问不出来。逐出与重放是两件事，分开处理：「这次变更在崩之前落没落」由核心的落盘状态回答（`database.go:74` 开库把 `running` 翻 `paused`，`analysis.go:65` 的 `resumeStoredAnalysis`），通道不许替它猜，所以失败的那一次只把拒绝交给节点，**要不要再问一次是节点的调用方决定的**。run 作用域本身把重启次数 bound 在节点实际发起的调用数上（崩在同一个方法上不会自动循环），路线图文档 `docs/migration/findz-go-sidecar-roadmap.md` §6 那条「sidecar 重启预算」在这个形状下不需要额外闸门。**逐出的边界要说清**：换上来的是**一个新进程**，而「已经打开的库」是进程内状态（`service.go:102` 查的就是那张表，`:137`/`:156`/`:170`/`:184`/`:198`/`:222`/`:236`/`:250`/`:264` 九处按 `libraryId` 寻址的方法在表里没有时报 `library_not_open`）。⇒ 重启后数据还在（索引文件与任务行落在那份 SQLite 里，`database.go:62` 每次 open 重开文件），但**凡按 `libraryId` 寻址的方法都会先拒一次，要节点 core 重新发一次 `library.open`**——它是幂等的（同 root 同路径直接复用，`service.go:102`）。通道不许替节点补这次 open：那属于节点语义，是 P4 的活，门禁写进路线图 §5 P4。

## 被否决的替代

- **每次调用一个新进程（`proc.exec`）**：**被实测否决**。2,000 归档的扫描要 255 轮轮询 ⇒ 纯启动税 `255 × 26 ms ≈ 6.6 s`，是扫描本身（≈1.3 s）的 5 倍。另有独立的结构性理由：任务 goroutine 与 `taskControls`（`service.go:22-23`）只在发起它的那个进程里活着，新进程只能 `resume` 一个已落盘的 `paused` 任务，**跟不了在飞的任务**。
- **MCP / `rmcp` 3.5.0**：需要 `rmcp` + `process-wrap` + `which` 三个 crate，且它是 async，而 dispatch 是同步签名 ⇒ 还得为每个会话挂一条 current-thread runtime 线程。而它想替我们做的事——版本协商与能力核对——`protocol.go` + `packages/findz-native/src/index.ts:113-139` **已经有了**。净收益是「多一个协议层」。`process-wrap` 的传递依赖逐个查 `Cargo.lock`（`indexmap`/`nix`/`tracing`/`crossbeam-channel`/`libc`/`windows`…）**全部已在锁里** ⇒ 本方案净新增正好 1 个 crate。
- **按宿主会话活的常驻 sidecar**：比 A2 多一张跨 run 的表和一套泄漏纪律，省下的只是每次 run 一次启动（实测 14–47 ms，含建库）——不值得用生命周期换。
- **把内核翻成 Rust（`node-native-shape.md:197-198` 当初的「honest target」）**：那是用户 2026-10-05 判归零的形状；且会丢掉 1,182 行 Go 测试（`service_acceptance_test.go` 506 行 + `service_test.go` 368 行 + `scanner_benchmark_test.go` 238 行）。
- **保留 `bun:ffi` + Bun worker**：QuickJS realm 里做不到，且旧 Bun backend 线属待删层。ADR-0075:225-230 那条「placement decision」由此结案。

## 验证（2026-10-05，本机 macOS arm64，`loadavg` 10.1–10.8，cpus=10）

探针在仓库外：Go 副本 `.findz-coldstart/`（`probe_serve.go` = 成品形状），Rust `.findz-sidecar-spike/`（`process-wrap` 10.0.1 + `crossbeam-channel`）。夹具 `lib-6000x12`。三轮 rc=0：

| 断言 | 结果 |
| --- | --- |
| run 内多次往返 | `open` 47 ms，之后 treemap/query(200)/query(1000) **各 1 ms** |
| 在飞取消 | 抓到 `running done=4/6000` ⇒ `start_kill()`；**6 ms 内 pid `alive=false`，`pgrep` 1→0** |
| 崩溃恢复 | SIGKILL 后重开：`ok=true`、`query.archives` 读出 **`total=46`**（杀时只回读到 done=4，已提交的部分活着，WAL 未坏）；任务行 **`status=paused done=46/6000`** |
| 正控 | `SPIKE_SKIP_KILL=1` ⇒ `after=1`、泄漏 pid `alive=true` ⇒ **这把尺能看见违规**；随后清理，残留 0 |

两条过程中抓到的事实，落地时必须写进代码注释：任务行先以 `totalArchives=0` 落盘 ⇒ 「在飞」只能按 `status` 判；杀得太早（`done==0`）不算崩溃恢复证据 ⇒ 终止谓词是 `status=="running" && done>0`。

## 验证（续：P1 落地与全链路，2026-10-05 13:17–13:18）

上表是「形状可不可行」；这半段是「接进真宿主后可不可用」。

| 断言 | 实测 |
| --- | --- |
| 宿主内实现（`sidecar.rs` + `findz_operations.rs` + 替身）门禁 | `cargo test --lib` **86 passed / 0 failed**；`cargo clippy --all-targets --no-deps -j 1 -- -D warnings` **RC=0、0 条**（`--lib` 口径看不见 test 与别的 bin 的告警，必须走 all-targets） |
| 崩溃逐出（决策 9） | 外部 `kill -9` 之后：第 1 次调用回拒绝且消息带**那个死 pid**、表里不再留句柄、第 2 次调用由**新 pid** 应答、run 结束新引擎也无残留。**证伪**：把逐出三行改成 `if false && …` ⇒ 该测红在 `the dead handle was not evicted: [84366]`。pid 一律取**替身在应答帧里自己报的那份**（`result.pid`），不取持有者的记账——要验的正是记账可能出错（路线图文 §3.4h） |
| 拒绝消息真带得上遗言 | 连跑 12 轮红 1 次：`die` 模式的拒绝消息里 stderr 是空的。根因是两条管道之间没有顺序——一轮由 **stdout** 到 EOF 结束，而那句话要**另一条 stderr 线程**塞进缓冲。修在 `terminate()`：收尸之后有界等 drain 到 EOF（`STDERR_DRAIN_WAIT = 250 ms`，只在 `is_finished()` 之后 `join` 以拿到那条 happens-before 边），写失败臂也改成先 terminate 再拼消息。修后 **65 轮 0 红**（若速率未变，全绿概率约 0.4%） |
| 真实内核全链路（bundle → realm → `service.invoke` → 持有者 → Go → SQLite） | `quickjs-run` 跑 500 归档 / 4,000 成员：**520–294 ms**，run 内 **621–758 次**往返，任务 `completed 500/500` |
| 落点投递 | 给 `XIRANITE_FINDZ_INDEX_DIR` ⇒ 索引落在该目录；只给 `XIRANITE_DATA_DIR` ⇒ 落在 `<该根>/findz/indexes`（修复前会落进 `~/Library/Caches/Xiranite/…`） |
| 进程收尾 | 每轮 run 结束后 `pgrep` 残留 **0**；`the_liveness_gauge_sees_a_child_that_was_never_terminated` 是同处断言的正控（撤掉终止 ⇒ 尺必须红） |
| CI | `findz-sidecar` job（`80c9d42e`）：`go test` + 构建宿主会 spawn 的可执行 + 真管道三帧冒烟，外层 `timeout`；空输出替身令该步 **rc=1** ⇒ 这把尺能红 |

## 后果

- **Windows 那条臂：API 用法已编译验证，运行时行为仍未验。** 本机 `#[cfg(windows)]` 不参与编译，所以在仓库外建了一个只依赖 `process-wrap` 的镜像 crate（`/Users/glow/Base/Code/Freya/pw-win-check/`），把 `sidecar.rs` 那条臂的**同一串 API**（`CommandWrap::with_new` → `wrap(JobObject)` → `spawn` → `id` → `stdin().take()` → `start_kill` → `wait`）对着 `x86_64-pc-windows-msvc` 真编了一遍：`cargo check` **rc=0**；**证伪也做了**——把 `JobObject` 写成 `JobObjectTypo` ⇒ `error[E0425]: cannot find value` ⇒ 这把尺能红。
  仍未验的是**运行时**（job object 是否真终止整棵进程树）。整 crate 的交叉 `cargo check` 试过了，卡在依赖链的 C 构建脚本（`dav1d-sys`：pkg-config 未配置成交叉编译，需要目标 sysroot）——那是 `xiranite-core → image/avif` 那条链，不是 sidecar 的代码。拿到运行时证据的正路是在 Windows 机器上跑 `cargo test -p xiranite-quickjs-executor sidecar::`（需要用户点头，那是共享构建机）。

  **本机取证的可复用配方**（都是这轮踩出来的）：Homebrew 的 `cargo/rustc` 看不见 rustup 装的 target ⇒ 必须把 `~/.rustup/toolchains/stable-*/bin` 整体前置；macOS **没有 `timeout`**；交叉 C 需要 `CC_x86_64_pc_windows_msvc=$(xcrun --find clang)` 而 `xcrun --find llvm-ar` 不存在、要用 `ar`。
- **体积**：一次性可执行 14,847,410 B（对比 c-shared dylib 9,745,874 B）。**别把这次改造当减体积做**——它买的是「findz 在新宿主里可达」+「Go 内核进 CI」（后半已成立：`80c9d42e`）。
- **`notify` 是宿主的新依赖**，版本待用户定（`9.0.0-rc.5`/`0.8.0-rc.2` vs 稳定线 8.x/0.7.x）；`node-native-shape.md` 里那句「notify@8.2.0 + rusqlite@0.40.2」已漂——宿主实际是 **rusqlite 0.31 bundled**（`crates/xiranite-core/Cargo.toml:25`），依赖版本一律以锁为准。
- **凡是「子进程一退出就认为它的输出读齐了」的断言都带着同一个竞态**。本篇自己的 65 轮复测里，红 5 次的都不是 sidecar：3 次 `machine::tests::a_spawned_child_is_reported_and_reaped`（`machine.rs:507`，`hello` 拿到 `""`）、1 次 `proc_operations::tests::a_spawned_child_reports_its_handle_and_the_other_arms_read_it`（`proc_operations.rs:322`，`tick` 拿到 `""`），且那句断言在 `git show HEAD:` 里原样存在 ⇒ 既存、不是拆解引入。sidecar 这侧已用「收尸后有界等 drain」堵上；`proc.poll`/`proc.wait` 那侧还没堵，同形改法二选一：收尸后让 drain 落地，或轮询到 `stdout_offset` 前进而不是轮询到 `!running`。**报告在这里，代码归那条 lane**。
- **幂等回执只在内存**（`service.go:56-78` 的 map 没落 SQLite）：A2 下同一 run 内仍然有效，跨 run 的重试去重会失效。要么接受（run 内有效本来就够），要么在 Go 侧把 receipts 写进 SQLite。
- ADR-0053 的原生绑定条款（c-shared + `bun:ffi` + Bun worker）作废；它对 per-library SQLite 索引、JSON-over-C 的请求/响应词汇、以及「节点不直连 DLL」的判断继续成立——那三条在本次改造里原样搬到了进程边界上。
