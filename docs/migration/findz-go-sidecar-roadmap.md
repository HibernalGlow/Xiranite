# findz：保留 Go 内核，接成声明式 sidecar

**状态：路线，未开工。** 本文所有代码事实都在 2026-10-05 于本机 `/Users/glow/Base/Code/Freya/Xiranite` 实测（带 `file:line`）；外部版本事实经 crates.io / GitHub API 现查（带日期）。**没有任何一条是「已在机器上跑通」**——除 P0 探针外全部未实现，P0 也未跑。

---

## 1. 决策（2026-10-05 用户拍板）

1. **Go 源码保留**，`native/findz-go` 不删、不翻成 Rust。
2. **一次做成「声明式 sidecar 引擎」通用设施**，不写 findz 私有管道；且**不手搓协议**，用维护中的成熟项目。
3. **watcher 落宿主 notify**，喂 Go 现成的 `watcher.apply_changes` 入口 ⇒ **Go 零新依赖**。
4. **长任务语义跟 kisaki 一致**：一次 run 内 `await` 长轮询到终态，pause/cancel 走 run 的 checkpoint。

一句话结论（**2026-10-05 判决见 §3.4，与本文初稿不同**）：findz 的引擎继续是 Go，节点 TS 继续是唯一实现；Rust 只多一张 **run 作用域**的 sidecar 表 + 一张只放订阅的 notify 会话表；进程终止交给 `process-wrap`（实测净新增 **1 个 crate**），**不上 MCP**——`rmcp` 那条要 3 个 crate 外加一条 runtime 线程，而同步的 `crossbeam` 就够用。

---

## 2. 事实底座（为什么只能是这条路）

### 2.1 realm 的门是闭集，没有 socket

`crates/xiranite-quickjs-executor/src/host_calls.rs:75-138` 的 `HostOperation` 全表：fs 家族 17 个（`Stat`/`List`/`ReadText`/`WriteText`/`EnsureDir`/`Move`/`Delete`/`Mkdtemp`/`Copy`/`AppendText`/`Utimes`/`ReadBytes`/`WriteBytes`/`Link`/`Symlink`/`Readlink`/`Realpath`）、proc 家族 5 个（`ProcExec`/`ProcSpawn`/`ProcPoll`/`ProcWait`/`ProcKill`）、`ClockNow`、`RandomUuid`/`RandomBytes`/`Digest`、`OsTmpdir`/`OsHomedir`/`OsCpus`，加上唯一一个通用门 `ServiceInvoke`。

⇒ **realm 里没有 fetch/socket、没有定时器、没有 worker、装不了原生模块。** 所以「用 JS 生态的东西去协调 Go 后端」在 realm 内物理上不成立（koffi、`child_process`、`fetch` 一个都进不来）；realm 外能做，但 ADR-0074 §5 否决把第二份引擎放进 face 进程，GUI renderer 更是只能 `invoke`。**必须有一小块 Rust，是结构性的，不是偏好。**

### 2.2 `proc.spawn` / `proc.poll` 承载不了 findz（三条独立硬伤）

| 硬伤 | 实测位置 |
| --- | --- |
| stdin 焊成 `Stdio::null()`，且全 crate 只有一处 `stdin` 命中 ⇒ realm 无法往活子进程写 | `machine.rs:204` |
| `ProcessTable` 按 run 构造，`Drop` 必杀必收（它是为 `bandia`/`jellypot` 不累积进程而存在的）⇒ sidecar 活不过那次 invoke | `machine.rs:70`、`:81`、`:314-321` |
| 白名单只收**裸程序名**、拒绝路径；`cwd` 必须是已授予且 `stat` 得动的目录 | `proc_operations.rs:118-126`、`:130-142` |
| 它是 transcript 通道：文本、`MAX_POLL_WINDOW_BYTES = MAX_PROCESS_OUTPUT_BYTES / 4` | `proc_operations.rs:33-41` |

**这不是「手搓货靠不靠谱」的问题。** `proc.*` 有真进程测试与正控（`machine.rs:465-531`，含 `process_alive`/`wait_for_exit`），它服务的是「起一个工具、读它的一次性输出或进度日志」——30+ 个 `execFile` 型节点的场景。findz 要的是**有状态的 RPC 对端**，不是那个契约，拿它当总线是误用。

### 2.3 协议不用手搓：`rmcp` 的账

- `rmcp` **3.5.0**，2026-09-28 更新，Apache-2.0，MSRV 1.88（本仓 `rust-version = "1.96"` ⇒ 兼容），32.1M 下载。
- 需要的 feature 组合是 `default-features = false, features = ["client", "transport-child-process"]`。`default` 含 `server`（会拉 `schemars`），**客户端不要开**。
- 非可选 normal 依赖 11 个：`chrono`/`futures`/`indexmap`/`pin-project-lite`/`serde`/`serde_json`/`thiserror`/`tokio(sync,macros,rt,time)`/`tokio-util`/`tracing`。逐条比对 `Cargo.lock`：**除 `process-wrap`（`transport-child-process` 要，^10.0 features=tokio1）与 `which`（^8）外，全部已在锁里**。⇒ **给产品新增的第三方 crate 是 2 个，不是 11 个。** `reqwest`/`hyper`/`oauth2`/`axum` 都在 optional/dev 位子上，关default 就碰不到。
- 反例：`jsonrpc-core` 18.0.0 停在 **2021-07-20**。自研 JSON-RPC 客户端这条「看起来更轻」的路，协议实现部分没有维护者。
- Go 侧两个候选都活着：官方 `modelcontextprotocol/go-sdk`（5,185★，pushed 2026-10-04，`go 1.25.0`）、`mark3labs/mcp-go`（9,152★，MIT，pushed 2026-09-23，`go 1.25.5`）。**许可注意**：官方 go-sdk 的 LICENSE 是 MIT→Apache-2.0 过渡期的**混合声明**（GitHub API 因此报 `NOASSERTION`，原文写「新代码 Apache-2.0，未同意 relicense 的原作者贡献仍 MIT」）；`mcp-go` 是干净 MIT。findz-go 模块是 `go 1.25.0`（`native/findz-go/go.mod:3`），选 `mcp-go` 要先升 toolchain。

### 2.4 长轮询与 checkpoint 的现成写法就在隔壁

`czkawka_operations.rs:345-420` 就是被选定语义的实现样本：`poll_scan` 先 `checkpoint(host, SCAN_PHASE)?`（`:355`），再用 `waitMs`（默认值 + `MAX_PROGRESS_WAIT_MS` 夹紧）做**有界等待**，等待期是「短睡 + 每次释开会话表借用」的循环（`:390-394`），因为「a paused operation parks the bundle inside this call, and a cancelled one travels back as `Cancelled`」。`checkpoint` 本体在 `host_calls.rs:421-429`。⇒ findz 的 `findz.task.progress` 照这个形状写，不发明新机制。

### 2.5 tokio 不是新增重量

`crates/xiranite-quickjs-executor/Cargo.toml` 现在**一个 tokio 都没有**（deps 只有 rquickjs/crossbeam-channel/serde/serde_json/sha1/sha2 + 5 个本地 crate + `xiranite-czkawka-core`）。但 `xiranite-core:21`、`xiranite-native-host:12`、`xiranite-node-runtime:15`、`xiranite-api:15`、`xiranite-loopback-host:27`、`xiranite-builtin-host:19` 全都声明了 tokio，锁里是 **1.53.2**。同一个宿主二进制早就链着它。⇒ 给 executor 加 tokio 依赖是**编译图内的既有事实**，不是给产品塞运行时。

~~**但接法有约束**~~（这句是给 rmcp 那条路写的，**§3.4 已改判：不用 runtime**）：service 的 dispatch 是同步签名 `fn(&str, &Value, &mut dyn NodeHost + 'static, &MachineAccess) -> Result<HostAnswer, CallError>`（`host_services.rs:36-37`），而 rmcp 是 async。不能在一个已经在 runtime 里的线程上 `block_on`。⇒ **落点：每个 sidecar 会话一条自有 OS 线程 + 它自己的 current-thread runtime，请求/结果经 `crossbeam-channel` 递**（`crossbeam-channel = "0.5"` 已是 executor 依赖，`czkawka_operations.rs:85` 的 `worker: JoinHandle<...>` + `Receiver` 就是这个形状的在用样本）。

### 2.6 「谁持有已经打开的库」——只在常驻 sidecar 路线下才是问题

（**修正**：本节初稿写成「一张表必须新写」。§3.1 推翻了这个前提——决策 4 一旦选定，Go 就不需要跨 run 的活体，那张**进程表可以不建**。留着本节是为了把「为什么可以不建」和「不建的代价」都摆在同一处。）

「长任务跟 kisaki 一致」解决了**谁驱动循环**，没有解决**谁持有已经打开的库**：Go 的 `libraryRuntime`（SQLite 句柄 + 任务表）挂在进程内单例 `sharedFindzService`（`native/findz-go/ffi.go:15`）上；GUI 的 `library.open` 是一次 run，之后的 `query_archives` 是**新的 run**（`src/nodes/findz/Component.tsx:89` 然后 `:71`）。而 `ProcessTable` 按 run（`:70`）、`SCAN_SESSIONS` 是 `thread_local!` 按 run（`czkawka_operations.rs:94-98`）。

⇒ 需要 **`static SIDECAR_SESSIONS: LazyLock<Mutex<HashMap<LibraryKey, SidecarSession>>>`**——按宿主会话活，`library.close` 显式回收，宿主关停统一回收。**进程监督策略这部分无论选哪个协议都得我们定**，成熟库替不了它；也正因如此它要配最硬的测试（见 §5 P1 的尺）。

顺带一条**利好**：Go 已经按「进程可重启」设计过——开库时把 `running` 翻成 `paused`（`database.go:74`）、`resumeStoredAnalysis`（`analysis.go:65`）存在。sidecar 崩了不必当灾难处理。

### 2.7 watcher 的依赖版本要先定（稳定线落后于 newest）

`notify` newest = **9.0.0-rc.5**（2026-08-30），`notify-debouncer-full` newest = **0.8.0-rc.2**（2026-05-02）。`Cargo.lock` 里**两者零命中**（全新依赖）。而 `docs/migration/node-native-shape.md:197-198` 那句「honest target = notify@8.2.0 + rusqlite@0.40.2」已经漂了：宿主实际用 **rusqlite 0.31 (bundled)**（`crates/xiranite-core/Cargo.toml:25`）。⇒ 依赖版本一律**以锁与宿主现状为准**，文档里的数字是旧值。

### 2.8 现状：Go 内核没有任何构建门禁，findz 在新宿主里也没通路

- CI 唯一的 Go 步骤是 `ci.yml:167-168`：`CGO_ENABLED: "0"` + `go build -mod=mod ./cmd/... ./internal/...`，跑的是**根模块**；`native/findz-go` 是独立模块（`go.mod:1`），**没有任何流水线编译它**，也没有 `-buildmode=c-shared` 的步骤。
- `native/prebuilt/win32-x64/findz.win32-x64.zip`（9,032,655 B）是**手工提交进 git** 的产物（最后一次提交 2026-07-27，与 Go 源码同日）。
- findz **未注册**：`crates/xiranite-scripted-nodes/src/registration.rs:266` 把它列在 `UNREGISTERED_BUNDLES`（`:263`），不在 `SCRIPTED_NODE_IDS`（`:259`，15 个）。`crates/xiranite-builtin-host/build.rs:18` 的 `NODE_BUNDLES` 只有 `["dissolvef","kisaki"]`。
- `crates/xiranite-quickjs-executor/bundles/findz.js` 已提交（`bundles/index.json:61-68`，86,878 B），它内联的 `new Worker(new URL("./findz-worker.js", ...))` **在本机 `ls bundles/` 的 24 个产物里没有对应的 `findz-worker.js`**。
- 桌面适配器只提供 `windows`/`trays`，node runner 走 loopback HTTP（`src/backend/adapters/tauri.ts:19-30`），而 `src/nodes/findz/Component.tsx:53` 写死「Findz requires the desktop backend.」。

⇒ **今天 findz 只在旧 Bun backend 那条线上跑得动**（`package.json:18` → `scripts/dev-with-backend.ts` → `packages/backend/src/nodeRunner.ts`）。所以这不是「要不要动」，是「什么时候把它接回新宿主」，而且旧线按 AGENTS.md 属于待删层。

---

## 3. 目标形状

```
GUI / CLI / TUI ──/operations──▶ Rust 宿主
                                    └─ QuickJS 执行器：packages/nodes/findz/src/core.ts（唯一实现，词汇与语义在这）
                                          │ service.invoke("findz", method, args)   ← 授予来自 NodeRequirements
                                          ▼
                                    findz 通道（executor 内，同步→channel）
                                          │
                          ┌───────────────┴────────────────┐
                          │ SIDECAR_SESSIONS（按宿主会话活）│
                          │ 1 会话 = 1 OS 线程 + 1 current-thread runtime
                          └───────────────┬────────────────┘
                                          │ 行分帧 over stdio（process-wrap std，净新增 1 crate）
                                          ▼
                                    findz-sidecar（Go，stdin/stdout 行循环，~40 行）
                                          └─ 现有 service.go 的 15 方法 + requestId 幂等 LRU，原样复用
                          ▲
                          │ watcher.apply_changes（Go 现成入口，service.go:149）
                    notify + debouncer（宿主侧新服务，按库订阅、缓冲待投递）
```

**声明式那一半**：节点在清单里声明它的 sidecar（程序名、协议版本、方法表、崩溃策略、字节与并发预算），宿主按声明装载并授予；没有声明的 bundle 猜不到引擎——这条规则 `host_services.rs:18-25` 已经写死了（「the gate is the registration, not the request」），sidecar 只是把它从进程内引擎扩到进程外引擎。

---

## 3.1 transport 是可换件：一次性进程（A）vs 常驻 sidecar（B）

§2.6 那张「按宿主会话活的进程表」**不是必然的**——它只在「Go 进程要活过 run」这个前提下才需要。而 §1 的决策 4（长任务在 run 内跑到终态）+ 决策 3（watcher 归宿主）**已经把这个前提抽掉了**：Go 侧不再需要任何跨 run 的活体，SQLite 每次调用重开就行，而且 Go 本来就按可重启设计——开库时把 `running` 翻 `paused`（`native/findz-go/database.go:74`）、`resumeStoredAnalysis` 存在（`analysis.go:65`）。

| | **A：一次性进程（`proc.exec`）** | **B：常驻 sidecar（`rmcp` transport-child-process）** |
| --- | --- | --- |
| Rust 新增 | 注册数据 + 一处 PATH staging（见下），**没有新通道、没有新表** | 一张会话表 + 每会话一条线程 + 进程监督纪律 |
| 协议实现 | 不需要协议：请求走 argv 或临时文件，响应是 stdout | 整块交给维护库 |
| 每次调用付 | 进程启动 + SQLite 打开（**待实测**） | 只有一次 channel 往返 |
| stdout 上限 | 1 MiB（`host_calls.rs:66`），超限 `truncated: true` | 无此限 |
| 幂等回执 | 丢（见下） | 保住 |

**A 的现成件全都在**：`proc.exec` 就是 `std::process::Command::output()` 等齐再答（`proc_operations.rs:344-363`）；暂停/取消**不用新造**——`POST /node-operations/{operationId}/pause` 与 `/cancel` 已接线（`crates/xiranite-api/src/lib.rs:157-158`、`routes.rs:179-193`），`CheckpointOutcome` 的 paused/cancelled 是 host 的一等公民（`crates/xiranite-plugin-api/src/host_calls.rs:217`）。⇒ GUI 那两个按钮应该打 **operation 控制**，不是 findz 的 `pause`/`cancel` action。

**A 要付的四笔账（都是可测的量，不是拦路石）：**
1. 启动税。GUI 一次刷新发两个调用（`src/nodes/findz/Component.tsx:71-72` 的 archives + treemap），扫描循环每轮一次 ⇒ 必须由 P0 实测「一次 9.7 MB Go 进程冷启动 + 开 SQLite」的毫秒数，**不许引用猜的数**。
2. `proc.exec` 无超时（只有 `proc.wait` 受 run deadline 约束），所以 Go 侧必须自带 deadline 或被 run 的 cancel 打断。
3. **stdout 1 MiB**（`host_calls.rs:66`）⇒ `export_rows` 这类天生大输出要么靠现有分页，要么落文件后回路径。
4. **幂等回执只在内存**（`service.go:56-67` + `rememberMutation` 那张 map 没落 SQLite）⇒ 一次性进程下重试去重形同没有。要保住就在 Go 侧把 receipts 写进 SQLite（约 30 行）——比加一张 Rust 会话表便宜。

**A 也需要一处小 Rust，别假装是零**：`exec` 用 `Command::new(program)` 按**宿主进程的 PATH** 解析程序名，而 `proc_operations.rs:122-126` 明令白名单是程序名不是路径。⇒ 落点是在宿主启动时把 sidecar 的 staging 目录并进 PATH（TS 旧层已有同形实现：`packages/native-loader/src/index.ts:84-90` 的 `prependNativeLibraryPath`），Windows 优先 ⇒ 顺带一条「argv 有约 32k 命令行上限」的实测项，超了就 `Mkdtemp` + 临时文件传请求。

**共同点（这才是关键）**：A 和 B 的**调用面完全一样**——`service.invoke("findz", method, args)` 的 15 个方法名 + Go 现有 envelope（`protocol.go:16-28`）。节点 TS core、GUI、注册表、门禁都不用为换 transport 而重写。⇒ **先把协议面钉死，把 transport 当可换件。**

**（§3.4 已判决：落点是 A2 = 一次 run 一个进程 + 行分帧 + `process-wrap`；下面这段的「A vs B」是当时的岔路，保留作被否决替代。）**

**因此分期改一下顺序**：P0 先做 A 的最小闭环（真实扫描 + 查询跑通 + 冷启动毫秒数实测），拿到数字再决定要不要 B。`rmcp` 那条只在 A 的启动税被证明不可接受时才引入——那时它替代的只是通道，不是设计。两条路线**共享一件必须新写的东西**：宿主的 notify 会话表（按库订阅 + 缓冲 + 投递 `watcher.apply_changes`，`service.go:149`），因为决策 3 已经把 watch 放到宿主了。

### 3.2 冷启动实测（2026-10-05，本机 macOS arm64）

测量物：`native/findz-go` 的一份**仓库外副本**（`/Users/glow/Base/Code/Freya/.findz-coldstart/`），删掉 `ffi.go`、加一个一次性入口（`steps <root> <dbPath> open,scan,scanwait,query,bigpage,close`），直接调 `service.handle()`——**即 A 形状下 Go 侧真正要写的那 40 行**。仓库工作树未被这次测量改动。夹具是合成的 `.cbz` 库（ZIP_STORED，成员为 28 B 假 JPEG / 46 B 假 PNG）。

⚠️ **负载标签**：测量期间 `loadavg` 在 **23–31** 之间（别的会话在跑）。所有绝对秒数都是**悲观值**；比例类结论（拆分 vs 同进程、启动 vs 工作量）比绝对值可信。Windows（交付目标）**未测**，进程创建成本与 macOS `posix_spawn` 不同，不能外推。

| 测项 | 值 | 说明 |
| --- | --- | --- |
| 纯进程启动（链进 sqlite/zip/imagemeta，不碰盘） | median **26.3 ms**，min 15.0，p90 41.1，n=36 | noop 模式也构造 service + apiInfo，免得链接期把代码裁掉 |
| `library.open` 冷建库（v1+v2 迁移） | median **37.2 ms**（n=3） | |
| `library.open` 重开已有库 | median **26.6 ms** ≈ 纯启动 | ⇒ 重开本身 ≈ 0（call 内部实测 2–25 ms） |
| GUI 一次刷新（`query.archives` + `projection.treemap`）**同进程** | median **24.9 ms** | `Component.tsx:71-72` 真实是两个调用 |
| 同一刷新**拆两个进程** | median **47.3 ms** | 差值 ≈ 一次启动 |
| 扫描 500 归档 / 4,000 成员到终态 | median **518 ms**，min 417，**21 轮轮询** | |
| 同库重扫（索引已在盘） | median **246 ms** | |
| 扫描 2,000 归档 / 24,000 成员到终态 | **255 轮 × 5 ms ≈ 1.3 s**，而 255 次 `task.get` 自身累计只 **3 ms** | 时间全在扫描 goroutine 上 |
| 一页归档行（默认 200 行） | **66,587 B** | |
| 一页归档行（`page.limit=1000`，即 `maximumPageSize`） | **320,192 B** | < 1 MiB 的 1/3 |
| 一个归档的成员页（12 成员） | **3,104 B** | |
| 一次性可执行体积 | **14,847,410 B** | 对比现有 c-shared dylib 9,745,874 B |
| Go 构建 | 冷 **46 s**（负载 16）/ 热 **0.45 s** | 改 Go 的迭代成本主要在冷编 |

**由这些数据得出的判决：**

1. **A1（每次调用起一个新进程）被实测否决。** 2,000 归档的扫描要 255 轮轮询 ⇒ 纯启动税 `255 × 26 ms ≈ 6.6 s`，**是扫描本身（≈1.3 s）的 5 倍**；500 归档也要 `21 × 26 ≈ 0.55 s`。结构性原因也独立否决它：任务跑在 `scan.start` 那个进程的 goroutine 上、控制状态在内存 map（`service.go:22-23 taskControls`），新进程只能 `task.resume` 一个已落盘的 `paused` 任务，**跟不了一个在飞的任务**。
2. **A2（一次 run 一个进程，run 内多次调用）是对的落点。** 启动只付一次（26 ms），每轮 `task.get` 实测 0–3 ms；这正好就是 §1 决策 4 选的 kisaki 形状。
3. **§3.1 里那笔「stdout 1 MiB」的账可以销掉**：最大页实测 320 KB，`page.limit` 又被 `maximumPageSize = 1_000`（`protocol.go:12`）钉死，一次调用不可能撑爆 `MAX_PROCESS_OUTPUT_BYTES`（`host_calls.rs:66`）。
4. **A2 需要一个今天没有的能力**：`proc.exec` 是 `Command::output()` 阻塞到底、**没有句柄也就无法中断**（`proc_operations.rs:344-363`），而 A2 的取消恰恰要靠「宿主杀掉子进程 + Go 重开时把 `running` 翻成 `paused`」（`database.go:74`）。⇒ 需要一个 **run 作用域、能写 stdin 的子进程持有者**。这比 §3.1 设想的多一点 Rust（约 60–100 行），但**生命周期仍按 run 收口**（沿用 `machine.rs:314-321` 的 Drop 必杀纪律），**不是**按宿主会话的表——跨 run 泄漏进程这类失败模式因此不存在。
5. `rmcp` 在这里的价值重估：它替代的是「行分帧 + 请求配对」那几十行，代价是 2 个新 crate（`process-wrap`、`which`）+ 一条 current-thread runtime 的线程模型。**A2 自研的体量已经小到「协议部分本来就没多少」**，所以这条不再是「不手搓」的强论据，改成 P0 探针里的一个对照项：同一个 Go 入口分别用「行分帧」和「rmcp」接一次，比代码行数和依赖增量再定。

### 3.4 P0(a) 已跑：A2 形状在真进程上成立（2026-10-05）

探针不在仓库里（工作树只有本文档这一处新增）：Go 侧是 `/Users/glow/Base/Code/Freya/.findz-coldstart/`（`native/findz-go` 的副本 + `probe_serve.go`，**stdin 一行一请求 / stdout 一行一响应**，直接喂现成的 `service.handle()`）；Rust 侧是 `/Users/glow/Base/Code/Freya/.findz-sidecar-spike/`（`process-wrap` 10.0.1 + `crossbeam-channel`，`src/main.rs` 就是将来那张 run 作用域表的形状）。夹具 `lib-6000x12`（6,000 个 `.cbz` × 12 成员，9.9 MB）。

**三轮跑测都 rc=0**，`loadavg` 10.1–10.8（cpus=10）：

| 断言 | 实测 |
| --- | --- |
| 一个进程内多次往返 | `library.open`（含建库）47 ms，之后 `projection.treemap` / `query.archives(200)` / `query.archives(1000)` **各 1 ms** ⇒ run 内轮询近乎免费，A2 的算术成立 |
| 在飞取消 | 第 1 轮 `queued`，下一轮 `running done=4/6000` ⇒ `start_kill()`（Unix 走 `killpg(SIGKILL)`）；**终止用时 6 ms，pid `alive=false`，`pgrep` 1→0** |
| 崩溃恢复 | SIGKILL 后重开同一库：`ok=true`，`query.archives` bytes=3,419、**`total=46`**（杀之前只回读到 done=4，说明 46 条已提交并活过了 SIGKILL，WAL 没坏）；任务行回读 **`status=paused done=46/total=6000`** ⇒ `database.go:74` 的 `running→paused` 是真的，且进度可续 |
| **正控**（撤掉终止） | `SPIKE_SKIP_KILL=1` ⇒ `pgrep before=1 after=1`、泄漏 pid `alive=true` ⇒ **这把尺看得见违规**，不是空转；随后 `pkill` 清理，跑完残留 0 |

**读源码得到的 `process-wrap` 事实（不靠记忆）：**
- **`std` frontend 不在 default features 里**（`std = ['dep:nix']`），必须显式 `features = ["std"]`；default 是 `creation-flags`/`job-object`/`kill-on-drop`/`process-group`/`process-session`/`tracing`。
- **`kill-on-drop` 只有 tokio frontend 有实现**（`src/tokio/kill_on_drop.rs`，`src/std/` 下没有对应文件）⇒ 同步路径的「drop 必杀」仍归我们写——**这正好是仓里已有的纪律**（`machine.rs:314-321`），不是新发明。
- API 形状：`CommandWrap::with_new(program, |c| …)` → `.wrap(ProcessGroup::leader())` → `.spawn() -> Box<dyn ChildWrapper>`；`ChildWrapper: Any + Debug + Send + Sync`，给 `stdin()/stdout()/stderr()` 的 `&mut Option<_>`、`id()`、`kill()`、`start_kill()`、`try_wait()`、`wait()`、`signal()`。Unix 的 `ProcessGroupChild::start_kill` 是 `killpg(SIGKILL)`，其 `wait` 会把组内僵尸收干净（源码注释明写这个目的）。
- Windows 侧对应 `JobObject`/`JobObjectChild`（`terminate_job`），**本机 cfg 关不掉、也没编译过**：`#[cfg(windows)]` 那条臂在本机不参与编译，属于「目标机上才能验」的缺口，落地时必须配一条源码扫描尺（照 [[跨平台底座实测]] 那三条替代取证的做法），Windows 实机跑一次才算数。
- **依赖增量实测 = 1 个 crate**：`cargo tree` 展开的 `indexmap`/`nix`/`tracing`/`crossbeam-channel`/`libc`/`windows`/… **逐个查 `Cargo.lock` 全部已在锁里** ⇒ 宿主只需要新增 `process-wrap` 本身。这比 `rmcp` 那条（`rmcp` + `process-wrap` + `which` 三个，外加一条 current-thread runtime 线程）更省，也更贴 dispatch 的同步签名。

**过程中抓到的两条真事实（都值得留在文档里）：**
1. **`scan.start` 建的任务行先以 `totalArchives=0` 落盘**，遍历到才有数 ⇒ 「任务在飞」只能按 `status` 判，不能按 `done < total` 判。探针第一版就是这么误判的（把 `running 0/0` 读成终态），修法见 `.findz-sidecar-spike/src/main.rs` 那段注释。
2. **杀太早不算崩溃恢复证据**：第一轮 running 时还没提交任何行，SIGKILL 后 `total=0`——看起来「恢复成功」其实啥也没测。所以谓词改成 `done > 0` 才允许主张 SIGKILL，并把「没观察到已写入的在飞扫描」单独列为一条失败项。

**判决：§1 决策 2 落定为「A2 + `process-wrap` + 行分帧复用 Go 现有 envelope，不上 MCP」。** 剩下未跑的是 §5 P0(b) 的另一半（在仓内 `xiranite-quickjs-executor` 里把这张表长出来）与 §6 未决 1/3。

### 3.4b P1 已实现，并用真实 Go 内核端到端跑通（2026-10-05）

仓内落点（**尚未提交**，理由见本节末）：`crates/xiranite-quickjs-executor` 新增 `sidecar.rs`（run 作用域表 + `process-wrap` 终止 + 行分帧 + `checkpoint` 让出点）、`findz_operations.rs`（`METHODS` + `dispatch`，已注册进 `host_services.rs` 的 `SERVICES`）、`src/bin/sidecar_testee.rs`（协议忠实的被测替身）；`MachineAccess` 加 `sidecars: Arc<Mutex<SidecarTable>>`（字段 + 两处构造 + 访问器，Drop 必杀必收）。

**门禁实测（拆解落地后复验，2026-10-05 12:39）**：`cargo test -p xiranite-quickjs-executor --lib -- --test-threads=1` = **80 passed / 0 failed，连跑 3 次全绿**（`loadavg` 11.8–12.2；拆解把执行器自己的测试搬走了一部分，所以总数从 103 变 80，不是我的测少了——我的 13 条都在）。
`cargo clippy --all-targets -D warnings` 现在 **rc=101，唯一一条命中是 `crates/xiranite-quickjs-executor/src/realm_run.rs:53`（`needless_borrow`），是并发拆解刚出现的新文件**，我的三个文件零命中；上一条记录的 rc=0 是它出现之前测的。⇒ crate 的 clippy 门禁此刻因别人在途代码而红，我不去动他们那个文件。

**一次 flake 与它的归属**：整套第一次跑时 `proc_operations::tests::a_spawned_child_reports_its_handle_and_the_other_arms_read_it` 红过（`assert_eq!(document["running"], false)`，他们的测、他们的文件）。二分实测：单跑它 = 绿；**跳过我任意一条测 = 79 全绿**；带上我全部测 = 80 全绿（连跑 3 次）。⇒ 判定为**时限性 flake**：他们的轮询预算固定 400 × 5 ms = 2 s，在这台负载 12 的机器上会被累积的副作用推过头，我的测只是让窗口更紧。这条**没有改他们的文件**，只在此记录，交给 `proc_operations` 的负责人决定是否改成有界但可观测的等待。

**顺手补了一条会自我守卫的测**（`the_child_leads_its_own_process_group`）：终止设计整个建立在「子进程是自己进程组的组长」上——若它继承了宿主的组，`killpg` 就会打到同组兄弟，而组级 `wait` 会抢走别人的 SIGCHLD，在下一个测试里表现为「孩子永不退出」。实测 `pgid == pid` 且不等于宿主的组，假设成立。

**真实内核的端到端**（不是替身）：用 `go build -o <staged>/findz ./native/findz-go`（含 §5 P2 的 `serve.go`）+ `XIRANITE_SIDECAR_DIR` + `cargo run --bin quickjs-run -- findz-realm.js run - @request.json <root> --services findz --node-id findz`，夹具 500 归档 / 4,000 成员：

| 观测 | 值 |
| --- | --- |
| 一次 run 的总耗时（realm → 持有者 → Go → SQLite） | **271 ms**（另一轮 695 ms；`loadavg` 12.9，冷/热页缓存差一倍——秒数按 [[measure-load-before-timing]] 带负载标签，别把两档相加） |
| run 内 `service.invoke` 往返次数 | **702–857 次**（bundle 无 sleep 的轮询），任务跑到 `completed`、`doneArchives=500/500` |
| 落盘的索引 | `realm-index.sqlite` 655,360 B（Go 自己写的，宿主不碰） |
| run 结束后残留的 findz 进程 | **0**（`pgrep`） |

这条把 §3.2 第 1 条的算术从推算变成实测：**按调用起进程**要付 `857 × 26 ms ≈ 22 s` 纯启动，而**按 run 起进程**只付一次（271 ms 里含全部 857 次往返）。

**P1 期间补上的权限检查**（我一开始漏了，是照 `czkawka_operations.rs:28-33` 那条既有规则补的）：`library.open` 的 `root` 先过 `FileCapability::resolve`，**授权外直接拒绝、且此时引擎还没启动**；送进内核的是 canonical 路径而不是节点打的字符串。两条测钉住它——`a_root_outside_the_grant_is_refused_before_the_engine_starts`（断言 `live_pids` 为空，即拒绝必须发生在 spawn 之前）与 `a_granted_root_travels_as_the_canonical_path`（macOS 的 `temp_dir()` 是 `/var/…` 而 canonical 是 `/private/var/…`，所以这条断言在「没改写」时必然红，不是空转）。

⚠️ **`databasePath` 目前仍由节点给，这是个已知未闭合面**：索引文件落在授权之外的宿主数据目录（现实产品行为就是 `%LOCALAPPDATA%/Xiranite/findz/indexes/…`），所以「要求它也在 grant 内」会直接把产品行为堵死。正确解法是**宿主拥有索引路径**（按 libraryId 派生，走 `xiranite-core` 的数据目录），并拒绝节点自带的路径。这条记进 §6 未决，不在 P1 里假装解决。

**为什么这组代码还没提交**：同一时间另一个 lane 正在重构同一批文件——`crates/xiranite-builtin-host` 整 crate 在索引里是 `D`、`crates/xiranite-core` 多个服务被 `D`，而我要接线的 `machine.rs`/`host_services.rs` 一度变成「索引 `D` + 盘上 `??`」。`but commit` 是整文件收，会把他们未完成的动作卷进我的提交；只提我的新文件又不接线会让分支不能构建（本地全绿≠分支自洽）。所以留工作区，等他们的重构落地后作为一个整体提交。

### 3.4c 地形变化：执行器 crate 正在被并发拆解（2026-10-05 12:32）

另一会话此刻正在拆 `crates/xiranite-quickjs-executor`：索引里 `machine.rs`、`host_services.rs`、`proc_operations.rs`、`fs_operations.rs`、`digest.rs`、`czkawka_operations.rs`、`tests/czkawka_service.rs` 全是 `D`，`engine.rs`/`shims.rs`/`bundle.rs` 是 `MD`，并新增了 `realm_run.rs`；同时 `crates/quickjs-host-protocol` 已进工作区成员。⇒ **P1 的接线目标正在换地方**，`cargo check` 现在的 6 个错全在他们手上的 `node.rs`/`realm_run.rs`（我的三个文件一条都没有），（那句话已作废：14:47–14:49 重跑过，`databasePath` 的拒绝有 `a_node_supplied_index_path_is_refused_not_ignored` 钉住，串行全量 **101 passed / 0 failed**、clippy `--all-targets -D warnings` RC=0；那 6 个 `cargo check` 错也在 14:35 前后由他们自修，14:36 起 crate 重新编得过。）

**在途备份**（防被整文件写回覆盖）：`/Users/glow/Base/Code/Freya/.findz-p1-backup/`，保留相对路径 + `shasum -a 256` 清单，含 `sidecar.rs`(760 行)、`findz_operations.rs`、`src/bin/sidecar_testee.rs` 与被并发删掉的 `machine.rs`/`host_services.rs` 的工作副本。

**拆解落地后的再落位清单（照四条契约，不照文件路径）：**
1. **表跟着 `MachineAccess` 走**：`sidecars: Arc<Mutex<SidecarTable>>` 一个字段 + 构造点 + 访问器；`Drop` 必杀必收的纪律不能丢（`terminate` 必须 `start_kill` 后 `wait`，否则僵尸会让「无残留进程」变假绿）。
2. **服务行跟着 `SERVICES` 表走**：`name: "findz"`、`methods: findz_operations::METHODS`（那份名单由测对着 `native/findz-go/protocol.go` 的 `Capabilities` 块核），`dispatch` 仍是同步签名——这是选 `process-wrap` 而非 `rmcp` 的根因，换了地方也不变。
3. **权限检查在 spawn 之前**：`library.open` 的 `root` 过 `FileCapability::resolve` 且送 canonical；节点自带 `databasePath` 直接拒（不是静默丢），测要同时断言「拒绝」与「`live_pids` 为空」。
4. **Cargo 两处**：`process-wrap = { features = ["std"] }`（`std` 不在 default）与 `[[bin]] sidecar-testee`；`CARGO_BIN_EXE_*` 只在集成测试里有定义，所以 lib 内单测靠 `current_exe()` 定位兄弟二进制，且**跑测试别加 `--lib`**（不会重建 bin，会拿旧产物比）。

**`databasePath` 那条拒绝的前提，用真实内核验过了**（只依赖已进仓的 Go，不受上面的拆解影响；`LOCALAPPDATA` 指到 scratch 目录，没污染真实缓存）：

| 观测 | 结果 |
| --- | --- |
| 不传 `databasePath` | `library.open` `ok=true`，核心自己派生 `library-149d0a6a3a2830c2.sqlite`，落在 `<LOCALAPPDATA>/Xiranite/findz/indexes/…`，**文件确实在盘上**，且 `result.databasePath` 把位置**回读**出来 ⇒ 宿主拒收节点自带路径不丢控制力 |
| 传了 `databasePath` | 核心照单收下并把索引写到那个位置 ⇒ **这个洞是真的存在的**，`findz_operations` 里的拒绝不是装饰 |

⇒ 顺着这条留一个后续项（§6.6）：核心只认 `LOCALAPPDATA` / `os.UserCacheDir()`，**不认 `XIRANITE_DATA_DIR`**。所以「宿主决定索引落点」这件事真正要做的是**由持有者把数据根映射进子进程的环境变量**（Windows 天然是 `LOCALAPPDATA`，mac/Linux 需要显式给），否则 mac 上会落到 `~/Library/Caches` 而不是 Xiranite 的数据目录。这条比「拒收参数」更接近控制点。

### 3.4d 索引落点已闭合（2026-10-05 12:46）

§6.6 那条从「未决」变成实现，分两半：

- **Go 半边已提交**（`336e48b8`）：`defaultDatabasePath` 先读 `XIRANITE_FINDZ_INDEX_DIR`，空白视为未设置、仍回落 `LOCALAPPDATA`/`os.UserCacheDir()`；**文件名仍由 `libraryIDForRoot` 派生**（`database.go:58` 自己 `MkdirAll`）⇒ 宿主只给目录、永远不给文件名，两个不同数据根的装机不会给同一个库造出两个名字。三条测各盯一层优先级（显式目录精确赢 / 空白回落 / 文件名是派生 id 且大小写归一），`go test ./...` + `gofmt -l` + `go vet` 全清。为什么不复用 `LOCALAPPDATA`：那是 Windows 形状的名字，mac/Linux 上宿主数据根不叫这个。
- **Rust 半边已写完、未提交**（跟 §3.4b 那组一起等并发拆解落地）：`sidecar.rs` 多一条**只给子进程**的 env 通道（`set_child_env`），`findz_operations` 用 `PathContext::from_environment().data_dir()` 解析 `<root>/findz/indexes`，并留出 `XIRANITE_FINDZ_INDEX_DIR` 的显式覆盖；解析函数是纯的（不碰文件系统，目录由核心自己建），投递用「测试自选一个目录 ⇒ 子进程把它回读出来」证明，配一个**两 run 各带自己路径**的对照和一个「持有者没设变量 ⇒ 回读为空」的控制测。
- 复验：`cargo test -p xiranite-quickjs-executor -- --test-threads=1` = **83 passed / 0 failed**（全目标），`cargo clippy --all-targets -D warnings` = **RC=0**（上一轮那条 `realm_run.rs:53` 命中已被他们自己修掉）。

**同一条坑第二次咬我，这次记牢**：我又一次用 `cargo test --lib` 跑，结果测到的是**旧的 `sidecar-testee` 二进制**（`--lib` 不重建 `[[bin]]`），表现是「testee 明明改了却不回读新字段」。跑这套测试必须走全目标。

### 3.4e Go 内核第一次有了构建门禁（2026-10-05 13:07，`80c9d42e`）

§2.8 那条「没有任何门禁编译 `native/findz-go`」由 CI job `findz-sidecar` 闭合：`go test ./...`（CGo 开，索引是 SQLite）、`go build` 出宿主会 spawn 的可执行、再把三帧喂过真实管道冒烟（逐帧点名 `ok:true` / `library_not_open` / `invalid_request`，并断言索引确实落在 `XIRANITE_FINDZ_INDEX_DIR`），外面套 `timeout` 让「不响应的 sidecar」红掉 job 而不是挂住 runner。

**证据不是「写完就算」**：把该步骤从 YAML 里逐字抽出本地跑 ⇒ rc=0；把 `findz` 换成只吞不吐的替身 ⇒ **rc=1**（尺能红）；换回真二进制 ⇒ rc=0。

**一条被实测否证的做法（别再试）**：想给 stdio 边界加 Go 侧测试时，`os.Args[0]` 自执行当 sidecar 的写法**把整套 `go test` 挂死 600 s**（子进程收尾时 `command.Wait()` 再不返回，卡在 `t.Cleanup` 里，最后是 go 的 10 分钟超时杀掉的）。管道边界交给**宿主侧**测（`sidecar.rs` 用 process-wrap 起真二进制并断言收尸）+ CI 冒烟（真二进制、真管道、有 `timeout`），Go 单测只管帧内语义（`serve_test.go`）——这三层各管一段，别混。该文件已删除，模块回到干净状态。

**这条 job 的三步已在本地逐条 dry-run 过（2026-10-05 14:43，非云端）**：在 `native/findz-go` 里 `go test ./...` ⇒ `ok`；`go build -o <tmp>/findz .` ⇒ 成;然后**用与 workflow 逐字相同的三帧与同一串断言**跑管道 ⇒ `lines=3`、`"ok":true`、`library_not_open`、`invalid_request`、索引路径出现在应答里、索引目录非空，七项全 PASS。两点边界要说清：① `timeout 90` 那层没在本地验（macOS 没有 GNU `timeout`），job 钉的是 `ubuntu-24.04`，那里有；② 云端仍然**一次没跑过**这条 job——本地 dry-run 证明的是「命令与断言成立」，不是「流水线会红」。
③ 顺带确证一条容易踩的：在**仓库根**跑 `go build ./native/findz-go` 会撞 `inconsistent vendoring`（根 `go.mod` 那份 `vendor/` 不是 findz 的），job 里两步都带 `working-directory: native/findz-go` 所以没事——改这段的人别把它「简化」成根目录一条命令。

### 3.4f 配对不变量：先用测钉住，不提前加锁（2026-10-05 13:13）

「响应按顺序回答它前面那条请求」这条不变量原先只靠一个**关于调用者的假设**（一个 run 一个泵线程）。`MachineAccess` 是 `Clone`、与泵和 JS 回调共享（`machine.rs`），所以假设可以破。两条路：加一把 per-child 轮次锁，或者先让测去抓。

**决定：不加锁，加测。** 因为 `request(&mut SidecarTable)` 的签名已经强制调用方持表锁跨整轮——今天这把锁**不会失守**，写了就是给理论兼容堆抽象（AGENTS.md 明禁）。改为 `concurrent_callers_each_get_their_own_answer`（4 线程各自发一帧、断言各自拿回自己的 `requestId`，并断言四轮共用**一个**引擎进程）把性质钉住；字段注释写明：**哪天改成跨等待释放表锁（`czkawka_operations` 就是这个方向），这把锁要回来，而那条测会先红。**

顺手把行数收进 AGENTS.md 的带内：`sidecar.rs` 900 → **496**，测试拆到子模块 `sidecar/tests.rs`(411，`#[path]` 引入，子模块仍可见父模块私有项，不需要为测试放宽表面)。

**本轮门禁状态（归属分清楚）**：`cargo test --lib`（先单独 `cargo build --bin sidecar-testee` 保证被测二进制是新的）= **84 passed / 0 failed**；`cargo clippy --lib -D warnings` = **RC=0、0 条**。而 `--all-targets` 现在红，唯一错误是 **`src/bin/quickjs-run.rs:256`（4 个位置参数只有 3 个实参）——别人在途的文件**，不在我这批里；我不去改他们那个文件。

### 3.4g 端到端含落点投递：全链路成立，但暴露两处真问题（2026-10-05 13:17）

`quickjs-run` + **仓里编出来的真实 Go 内核** + 宿主解析的落点，一整条链跑通：500 归档 / 4,000 成员、run 内 621 次 `service.invoke`、520 ms、`XIRANITE_FINDZ_INDEX_DIR` 指定后索引确实落在 `e2e-index/library-….sqlite`（+ `-wal`/`-shm`），run 结束残留进程 0。

顺带抓出两处只有跑全链路才会现形的问题：

1. **`PathContext::data_dir()` 不认 `XIRANITE_DATA_DIR`**（只有 `config_path()` 的优先序认它，`config_paths.rs:72-83`）。⇒ 只设 `XIRANITE_DATA_DIR` 时，索引会悄悄留在平台缓存里（实测落到 `~/Library/Caches/Xiranite/findz/indexes`），可移植装机就出现「配置搬走了、索引没搬」。修法：`findz_operations::host_data_root(lookup)` 先看这个变量、否则回平台根，纯函数 + 双向可断言（正控是「没设时必须落回平台根」）；已提交测 `a_relocated_data_root_takes_the_indexes_with_it`。
2. **又被旧产物骗了一次**：`$S/staged/findz` 是 12:26 编的，早于 `indexDirEnv`，所以第一次跑「env 没生效」其实是**被测二进制过期**。同一类坑今天第二次出现（前一次是 `cargo test --lib` 不重建 `[[bin]]`）。⇒ 规则：**换语义前先重编被验的二进制**，两件事分开测。

**修复的运行期证据（不是只有单测）**：只设 `XIRANITE_DATA_DIR`、不给 `XIRANITE_FINDZ_INDEX_DIR` 再跑一次全链路 ⇒ 索引落在 `<该数据根>/findz/indexes/library-….sqlite`（13:18，500 归档 / 758 轮 / 成功）。修复前同一条链落在 `~/Library/Caches/Xiranite/findz/indexes/`——那三个探针产物已按 mtime 逐个核对后清掉，目录留空。

门禁同步状态：`cargo test --lib`（先单独重建 `sidecar-testee`）= **85 passed / 0 failed**；`cargo clippy --all-targets -D warnings` 见本节末命令输出。我这批文件在 `--all-targets` 下零告警（上一轮那条 `sidecar/tests.rs` 重复 `use super::*` 已修）。

### 3.4h 引擎崩在半路：句柄必须逐出，否则同一 run 之后永远问不出东西（2026-10-05 13:25–13:34）

自己代码里的真缺陷，形状是：`round()` 失败（写不进 / 应答流断了 / 超时）时已经终止了子进程，但**句柄还留在 `SidecarTable.live` 里**。下一次调用 `attach_or_start` 命中缓存 ⇒ 拿到的是一条断管 ⇒ 同一 run 里之后每一次调用都失败在同一个死引擎上。一次崩溃把一个还能干活的 run 变成完全不可用，而且症状会被读成「findz 这个方法本身有问题」。

- **修法**：`request()` 把「一轮」抽成 `round()`，失败即 `terminate` + `live.remove(program)`，**失败那一次照样只回它自己的拒绝**。
- **不重放**（有意为之）：「这次变更在崩之前到底落没落」是核心落盘状态的问题（`database.go:74` 把 `running` 翻 `paused`、`analysis.go:65` 能 `resumeStoredAnalysis`），通道猜就是第二权威。要不要再问一次归节点的调用方 ⇒ 决策写进 ADR-0077 第 9 条。
- **重启预算自动有界**：逐出后必须由调用方再发一次才会起新引擎，崩在同一个方法上不会自动循环，所以 §6.7 那条「1 次还是 0 次」在通道层不需要计数器；剩下的只是 TS core 的重试策略（P4）。

取证时踩到的两件事，记下来是因为它们会再犯：

1. **pid 只能取子进程自己报的那份。** 逐出后 `live_pids()` 是空的，所以「终止并收尸」那两条老断言（`times_out_and_its_process_is_reaped`、`a_cancelled_run_terminates_the_child_it_started`）改前是从表里读 pid 的，改后读不到。替身应答帧新增 `result.pid`（`sidecar_testee.rs`），断言改成「先让第一帧应答拿到 pid，再看那个 pid 死透且被收尸」。
2. **旁路 pid 文件不可行。** 试想过让替身启动即把 pid 写进 env 指定的文件——取消路径在 `spawn()` 返回后 ~1 ms 内就 `killpg`，子进程多半来不及写任何东西；应答帧没有这个竞态，因为「应答了」本身就证明进程活着并跑到了那行。于是替身的 `silent` 模式改成 `stall`（**第一帧应答、之后卡住**），这才是引擎 wedge 的真实形状。
3. **`terminate` 的参数从 `&Arc<LiveSidecar>` 收窄成 `&LiveSidecar`**：抽出的 `round()` 里 `sidecar` 本来就是引用，`terminate(&sidecar)` 变成 `&&Arc<_>`，clippy `needless_borrow` 连报三条。这类签名收窄只有 `--all-targets` 口径看得见（`--lib` 那条门禁看不到 test 文件）。

**逐出换来的是一台「空表」的新引擎**（这条边界容易读成「run 自动能接着跑」，所以单独写）：Go 侧已打开的库是进程内状态——`service.go:102` 查的就是 `service.libraries` 那张 map，九处按 `libraryId` 寻址的方法（`:137`/`:156`/`:170`/`:184`/`:198`/`:222`/`:236`/`:250`/`:264`）在表里没有时报 `library_not_open`。落盘的东西不丢：库 id 由 canonical root 派生（跨进程稳定）、`database.go:62` 每次 open 重开同一个 SQLite 文件、`running→paused` 的任务行还在那份文件里。⇒ **「崩了之后这个 run 还能用」的前提是节点自己重发一次 `library.open`**，通道不替它补（补了就是通道在猜节点状态，与决策 3「词汇表只有一份」同一条纪律）。写进 ADR-0077 决策 9，尺落在 §5 P4 那条新加的用例。

**尺与门禁**：`a_child_that_dies_between_calls_is_replaced_for_the_next_one` —— 外部 `kill -9`（先轮询确认它不再 running，避免和自己的断言赛跑）⇒ 下一次调用回拒绝且消息里带**那个死 pid** ⇒ 表空 ⇒ 再下一次调用由**不同的 pid** 应答 ⇒ run 结束后新引擎也没残留。**证伪做了**：把逐出那三行改成 `if false && outcome.is_err()` ⇒ 该测红在 `the dead handle was not evicted: [84366]`；改回后 `grep 'if false'` 无命中。

`cargo test --lib`（先单独 `cargo build --bin sidecar-testee`，`--lib` 不重建 bin）= **86 passed / 0 failed**；`cargo clippy --all-targets --no-deps -j 1 -- -D warnings` **RC=0、0 条**。

**拒绝消息里的 stderr 本来是有竞态的**（跑重复轮次跑出来的，不是读代码看出来的）。把整批文件在新工作树状态下连跑 12 轮，第 10 轮红在 `a_child_that_exits_without_answering_refuses_with_its_stderr`：断言要消息里带 `exiting without an answer`，实测拿到 `nothing on stderr`。因由是结构性的：一轮失败由 **stdout** 到 EOF（或写失败）结束，而那句拒绝是**另一条 stderr 线程**往缓冲里塞的行——子进程退出并不保证那行已经落地，两条管道之间没有任何顺序。`die` 模式明明先 `eprintln!` 再 `flush()` 再 `exit(1)`，字节早就在管道里，缺的只是宿主这边读它的线程跑到没有。
- **修在生产代码，不在测试**：ADR-0077 的承诺是「引擎给的理由跟着拒绝一起走，而不是跟进程一起死」，现在这句话才有载体。`LiveSidecar` 留下 drain 线程的 `JoinHandle`，`terminate()` 在 `wait()` 之后有界等它到 EOF（`STDERR_DRAIN_WAIT = 250 ms`；收尸已关掉写端 ⇒ EOF 必然到，上限是为了防「有组外的东西还攥着那条管道」把拒绝变成挂死），并且只在 `is_finished()` 之后才 `join()`（join 才是那条 happens-before 边）。另外 `round()` 的写失败臂改成**先 terminate 再拼消息**，于是每一条拒绝路径都等得到遗言。
- **能红的只有 Disconnected 那条臂，要说清**：`die`/`stall` 那两条测断的是「拒绝消息里带得上 stderr」，撤掉 join 就会红（实测 1/12）。写失败（EPIPE）那条臂只做了**顺序统一**（先 terminate 再拼消息），没为它构造对照——那条臂的前提是子进程被外部杀掉，它早先写的 stderr 通常早已落地，我造不出「没 join 就红」的夹具。所以那半是一致性改动，被尺逼出来的只有前一半。
- **重复轮次复测**：修后连跑 **65 轮**（1+20+24+20），我这批文件（`sidecar::` + `findz_operations::`）**0 红**；修前是 1/12（≈8%，若速率未变则 65 轮全绿的概率约 0.4%）。同这 65 轮里红的是别处的 5 次，见下条。
- **顺手量到别人那条既存竞态**（不在我这批文件里、HEAD 里就有 ⇒ 不是拆解造成的，只报告不代改）：同这 65 轮里红 5 次，其中 4 次抓到名字——3 次 `machine::tests::a_spawned_child_is_reported_and_reaped`（`machine.rs:507`，断 `stdout == "hello"` 拿到 `""`）、1 次 `proc_operations::tests::a_spawned_child_reports_its_handle_and_the_other_arms_read_it`（`proc_operations.rs:322`，`tick` 拿到 `""`）；第 5 次来自最早那轮计数循环（只计数没留名字），那之后的 44 轮一律 0 红。两处轮询都是 `if !report.running { break }` 就认定转录本齐了——和上面同一个形状：**子进程退出 ≠ 排它的线程已经把字节交进表**。`git show HEAD:crates/xiranite-quickjs-executor/src/machine.rs` 里那句断言原样存在，可复跑；修法与这里同一条（收尸之后让 drain 落地，或轮询到 `stdout_offset` 前进而不是轮询到 `!running`）。

### 3.4i 真内核的崩溃取证跑到了——但先暴露了我自己两处「尺没架上」（2026-10-05 14:00–14:33）

跑的东西在仓库外：`.findz-sidecar-spike/findz-crash.js` 这条探针经**生产持有者**（`quickjs-run` → `service.invoke` → `SidecarTable` → 用 `native/findz-go` 现编的可执行）扫 `lib-6000x12`，另一侧脚本从外部 SIGKILL 那个引擎。**建二进制要在模块目录里**：在仓库根跑 `go build` 会撞 `inconsistent vendoring`（根 `go.mod` 那份 `vendor/` 不是 findz 的），CI 那两条步骤本来就带了 `working-directory: native/findz-go`，门禁没这问题。

| 断言 | 这一轮现读的数字 |
| --- | --- |
| 在飞被外部杀 | 宿主级拒绝：`sidecar findz (pid 9725) closed its answer stream; stderr: nothing on stderr` —— 带的是**死掉那台**的 pid |
| 逐出 + 新引擎（决策 9 的边界，不再是源码推断） | 同 run 的下一次调用被 **Go 自己**拒：`{"code":"library_not_open","message":"Findz library is not open: library-c0adf806ef85b1fa"}` ⇒ 帧确实跨过通道落到一台**库表为空**的新引擎上 |
| 重开同一个库 | `library.open` 同 root ⇒ `ok:true` 且 `result.databasePath` 与崩前逐字节相同（`sameIndexPath=true`） |
| 落盘不丢 | 重开后 `task.get` = `paused 1708/6000`、`query.archives.total` = 1708 ⇒ 崩之前提交的索引行读得回来，任务停在诚实的 paused |
| 无 kill 对照 | `SKIP_KILL=1` 那一轮：`task-before-reopen = running 5558/6000` ⇒ `task-after-reopen = completed 6000/6000` ⇒ **中途重复 `library.open` 不会把在飞的扫描按下去**（我一开始把 paused 误当成 Go 的 open-dedup 关掉了对方的 DB） |
| 进程收尾 | 受控那轮 `killed_pid=56929`、`ps -o comm=` 回读 `findz`、宿主的孩子列表 `before=56929` ⇒ `after_residual=[]`，run rc=0 |

两处我自己造的坑，都是「实验看着成立、尺其实没架上」：

1. **按名字的 `pgrep` 是瞎尺。** `pgrep -x findz` 连着三轮都找不到引擎（`before=none`），而持有者确实 exec 了一个名叫 `findz` 的孩子 ⇒ 前两轮我以为是「我按下的外部 kill」，其实按钮没接上。改成按**父子关系**取（`pgrep -x quickjs-run` 拿宿主 pid，再 `pgrep -P <宿主>`）之后 kill 才受控。⇒ 外部 kill 类探针的顺序是：先证明「我要杀的正是它」，再证明「它死了」。
2. **`sleep 240; pkill …` 这种看护会活过自己那一轮。** `kill $WD` 只杀子壳，里面的 `sleep` 成孤儿继续计时，240 s 后照样 `pkill -x findz`，正好砸进**下一轮**运行——第一轮那个「没 kill 却也 paused」就是这么来的：一次意外死亡被伪装成我设计的受控崩溃。⇒ 后台杀手要么按进程组杀（`kill -- -<PGID>`），要么别用固定 sleep 看护。
3. **复跑已做（14:36，他们那片编译回去之后）**：`cargo test --lib -- --test-threads=1` = **100 passed / 0 failed**，`cargo clippy --all-targets --no-deps -j 1 -- -D warnings` **RC=0**（这 100 条里有他们新加的 `trash_operations` 等，我的半边仍是 22 条）。
4. **但默认并行口径会随机 SIGSEGV，而且不是我这批造成的**——这条要交给那条 lane：
   - 全量默认并行：崩（`process didn't exit successfully … (signal: 11, SIGSEGV)`），最后一次打印的测试名是别人的（并行下这个读数只能当参考）。
   - **只跑我的 `sidecar::` + `findz_operations::` 22 条、`--test-threads=8`：3/3 干净。**
   - **`--skip sidecar:: --skip findz_operations::` 把其余 78 条单独跑：8 轮里 3 轮 SIGSEGV、5 轮 ok。** ⇒ 崩溃在我排除掉的代码之外，可复现速率约 3/8。
   - **`--test-threads=1` 4 轮全干净** ⇒ 是并发求值才出的形状（realm/rquickjs/QuickJS C 那一带是首要嫌疑，`trash_operations` 这些新面也在这 78 条里）。
   ⇒ 落地前 CI 里的 `cargo test --lib` 要么钉 `--test-threads=1`，要么先把这条 crash 找出来；**别把它记成 sidecar 不稳**。

### 3.4p P3 起手：语义扒平了、依赖试算了、锁的问题量出来了——然后我把它停在这里（2026-10-05 15:40–15:44）

甲/乙与 notify 版本线用户都没回，我按自己上一轮声明的默认走（稳定线），做完起手三步，然后在共享 `Cargo.lock` 前停下。**停的理由是量出来的，不是感觉**，而且中间我数错了一次：

**1）要迁移的语义已逐行扒平**（`packages/nodes/findz/src/watcher-service.ts`，161 行 ⇒ 宿主别重写第二遍）：
- 事件按路径取最新一条（`coalesceFindzWatcherEvents`），入队时清掉该路径的 stat 观测；
- 静默窗 250 ms，每来一批重新计时（`scheduleFlush` 先 clear 旧 timer）；
- flush 前做**稳定性复查**：`delete` 直接放行；其余 `stat` 一次，`(size, mtimeMs)` 与上次观测相同才算稳，不同就把该路径塞回改动集再等一轮 ⇒ 一次长写入不会被切成两条索引事件；
- 交付成功 ⇒ `reconciliationQueued=false` + `set_health healthy`；抛错 ⇒ `degrade()`：`set_health degraded` 且**只排队一次** `scan.reconcile`（`reconciliationQueued` 自锁），reconcile 自己失败也保持 degraded 可见；
- `close()` 幂等：清 timer、清改动集与观测、unsubscribe；已 close 后 `setSubscription` 立刻 unsubscribe。
宿主对应物就是「一条订阅 + 一张每库缓冲表」，与决策 5 那句「会话表不含进程」同形；投递走 `watcher.apply_changes`，而那条**只有宿主能调**（§3.4l 的门禁）⇒ 宿主需要一个不经 `service.invoke` 的内部投递口，这是 P3 唯一要新写的通道，不是第二份协议。

**2）稳定线确实够用**：`cargo add notify@8 notify-debouncer-full@0.7` 干净解析出 `notify 8.2.0` + `notify-debouncer-full 0.7.0`，额外只带 `notify-types 2.1.0 / fsevent-sys 4.1.0 / inotify 0.11.5 / inotify-sys 0.1.8 / kqueue 1.2.1 / kqueue-sys 1.1.2`（mac 走默认 `macos_fsevent`）。⇒ 版本线那道题有答案了：不必上 rc。

**3）拦住我的是共享锁——而我第一次数错了。** `git diff -- Cargo.lock` 报 **+4169 / −241**，我据此以为要往共享锁塞 ~370 个包，差点把 P3 判死。改成数条目才对：锁条目 **962 → 965**，notify 一族是 8 个包；diff 里绝大部
分是 cargo 重排整份文件造成的移动噪声。**教训入 §「验证管路」那本账：判「锁涨了多少」要数 `^name = ` 的条数，不能读 diff 行数**——我因为读行数差点否掉一条本来只要 8 个包的依赖。

**4）这条我先说错了，改回来**：我一度根据「`git show HEAD:Cargo.lock` 里没有 `quickjs-realm` / `quickjs-host-protocol` / `process-wrap`，工作区那份有」断言 HEAD 的锁不自洽、干净检出 `--locked` 必炸。回去查 HEAD 的 `members` 名单——**那三个 crate 根本不在 HEAD 的工作区里**（`quickjs-realm`/`quickjs-host-protocol` 是别人未提交才加进去的，`process-wrap` 是我未提交那行加的）⇒ **HEAD 是自洽的，报错的是我的推理**：我只比了锁，没比「锁 + 清单」两侧，正是那条老纪律（判漂移要按生产者与产物两侧算）。真正成立的两点只剩：① 我这批在 `--locked` 下过——`cargo check -p xiranite-quickjs-executor --lib --offline --locked` **RC=0**（用的是工作区锁，它已含 `process-wrap`）；② 所以我那行 `process-wrap` 必须与它对应的锁条目**同批提交**，分开就是一次「提交了引用没提交被引用者」（⇒ §3.4m 第 6 点，理由按本段改过）。

**5）为什么最终还是停**：`Cargo.lock` 是两条 lane 正在写的共享文件，而我这轮要动的是「往别人的在飞锁上再加 8 个包」。批次里已经欠着一条 `process-wrap` 的锁 delta（必须与它同进），再叠 notify 一族会把「谁的锁变更」这件事彻底搅浑。⇒ **P3 的代码一行没写**（不是没设计：语义在第 1 条、依赖闭合在第 2 条、投递口的形状在第 1 条末）；`cargo add` 的两行与锁都已回退，工作区锁回到我碰它之前的状态（回退后 `cargo test --lib` 仍 106 passed / `--locked` check RC=0，证明没留残渣）。P3 的第一件实事因此不是写模块，而是**先把 HEAD 那份对不上清单的锁补全**（第 4 条），否则任何人往里加依赖都在替别人还债。

**生成器这笔债是仓里的，不是我这批造成的（现查 16:23）**：`bun scripts/embed-node-bundles.ts --check` 报 **23 份 bundle stale + index.json + registration.rs**。我把自己那行 alias 临时撤掉再跑一次 ⇒ 仍是 **23 份 stale**（`surface.ts` 恢复后 `rg -c findz-native` = 1，逐字节还原）。⇒ 谁现在跑生成器，都会把**另外 22 个节点**的源码刷新写进自己那一笔。P5 的前置因此是「那些 lane 先把自己的 bundle 提掉」，不是「我先跑一次生成器」。

### 3.5 由此固定的最终形状（替换 §3.3 的初稿）

- **节点 TS core**：唯一实现，`service.invoke("findz", method, args)` 的 15 个方法名与 Go envelope 一字不变。
- **Rust**：`MachineAccess` 多一张 **run 作用域**的 sidecar 表（字段 + 两处构造 + 访问器，照 `processes()`），spawn 用 `process-wrap` 的 `std` frontend；Drop 必杀必收沿用 `machine.rs` 那条纪律。**一轮失败的句柄当场逐出**（§3.4h），失败那次只回拒绝、不重放。notify 订阅另有一张只放订阅与小缓冲的会话表（不含进程）。
- **节点可调用的方法是 13 个，不是 15 个**：`watcher.apply_changes` / `watcher.set_health` 被 `HOST_ONLY_METHODS` 按名字拒（决策 5 的落点——`scanner.go` 对 root 内的路径照单执行，假 delete 能抹掉在盘上的归档）。`METHODS` 仍保持与 `protocol.go` 的能力表一字不差，那把尺量的是**引擎词汇**，门禁量的是**谁能说**。
- **Go**：`ffi.go`（57 行四个 `//export`）换成 ~40 行的 stdin/stdout 行循环（探针里那份就是），其余 3,286 行与 1,182 行测试不动。
- **CI**：~~`native/findz-go` 进流水线~~ **已完成（§3.4e，`80c9d42e`）**。

### 3.6 P4 的落点按 ADR-0079 改写（2026-10-05 14:41 现读，初稿那条已作废）

初稿（§3.5 第一条 + §5 P4）写的是「照 `czkawka` 的先例，在 `packages/quickjs-shims` 里加一份 `findz-service.ts`，再往 `surface.ts` 的 `REALM_PACKAGE_ALIASES`/`MODULE_SURFACES` 各补一行」。**这条路现在不该走**，两条独立理由：

1. **不需要**：ADR-0079 把能力面改成生成产物，`packages/host-capabilities/src/realm.ts` 里已经有泛化的
   `service.invoke(name, method, args)`（`contract.ts` 那句注释把它钉在 `NodeRequirements.services` 上），
   realm 侧直接 `capabilities.service.invoke("findz", …)` 就到底了——`czkawka-service.ts` 那种逐服务 shim 是给
   「旧包名要别名」准备的（`@xiranite/czkawka-native` 是 NAPI addon），**findz 没有需要保住的旧包名**。
2. **不许要**：ADR-0079「明确不做」点名 `MODULE_SURFACES` 的表不再加条目；而且 `packages/quickjs-shims/src/surface.ts`、
   `index.ts`、`package.json` 现在全是 `MM`（别人在途），往里加行就是把他们的改动并进我的提交。

于是 P4 的实际形状（依赖链照抄，别再现场发明）：

- **节点半边（`packages/nodes/findz/`，现查 0 脏 ⇒ 可独立提交）**：`platform.ts` 去掉 `@xiranite/findz-native` 与
  `{runtime:"bun-worker"}` 标记，改调 `capabilities.service.invoke("findz", method, args)`；15 个方法名与 Go envelope 一字不变（词汇表仍只有 `protocol.go` 那一份）。
  线类型从 `packages/findz-native/src/index.ts` 迁进 `packages/nodes/findz/src/protocol.ts`——GUI 那 6 处全是 `import type`（已核过），迁完一起改指。
- **面半边不是「换个 import」能了事的**：`node.ts` 那份 Node 传输对 `service.invoke` 是**按名字抛错**（ADR-0079 定的，`coverage.test.ts` 里就有断言），
  宿主服务住在宿主进程 ⇒ CLI/TUI 面要拿到扫描结果只能走现成的 `/operations` 协议。也就是说 P4 依赖面侧那条 operation 调用路径，
  而 `src/backend`（31 条脏）与 `src/nodes/findz`（GUI，别人在途）都在别人手里 ⇒ **P4 的排期跟在 ADR-0079 那条 lane 落地之后，不是跟着我这批之后**。
- **P5 的注册半边**同时是 P4 的前置：`crates/xiranite-scripted-nodes/src/registration.rs` 的 `UNREGISTERED_BUNDLES` 把 findz 移进 `SCRIPTED_NODE_IDS`
  + manifest 的 `services` 里点名 `findz`，否则 `service.invoke` 会被「未声明」正确拒掉（这条拒是**对的**，别当成 bug 去绕过）。

一句话记档：**findz 的 realm 入口从「新写一份 shim + 补两张表」变成「用已有的生成表面」**，代价从 4 个文件降到节点包自己那两三个文件，
但把「面侧走 /operations」这条本来就想躲的账摊开了。

---

### 3.4k 15 个方法的参数逐个查过：能伸到文件系统的只有三个入口（2026-10-05 14:51）

上一轮补的门禁只讲了一条，容易读成「watcher 是唯一一个」。所以把 `native/findz-go/domain.go` 里全部参数结构过了一遍，**结论是能落到文件系统上的入参只有三处，且三处都已经有答案**：

| 入参 | 谁能说 | 已经成立的理由 |
| --- | --- | --- |
| `library.open.root` | 节点 | 宿主先过 `FileCapability::resolve`，送给引擎的是 **canonical 路径**（§3.4g 那条 `a_granted_root_travels_as_the_canonical_path`） |
| `library.open.databasePath` | **谁都不给** | 宿主按名字拒（§3.4d、决策 8）：静默丢掉会让调用方以为生效了 |
| `watcher.apply_changes.changes[].path` | 只给宿主 | 上一条刚加的门禁（决策 5）；核心对 root 内的路径照单执行 ⇒ 假 `delete` 能抹掉在盘上的归档 |
| 其余 12 个方法 | 节点 | 参数只有 `libraryId`/`taskId`/`archiveId`/`memberId` 加 SQL 过滤器（`text`、`pathPrefix`、`rules`、`page`、`sortBy`）；`analysis.start.scope` 也只装 id，**开不了新根** |

三条顺带钉住的事实，写下来是因为它们都会被误当设计约束引用：
1. **`export.rows` 不写文件**：它和 `query.archives` 共用 `archiveQueryParams` 与 `queryArchives`，答的是行。⇒ P4 那句「导出」是**节点/UI 的活**，不是引擎的能力，别为了它再开一个宿主入口。
2. **`pathPrefix` 不是路径**：`query.go` 把它喂进 `archiveFilters`，是索引里的 LIKE 前缀。`memberPath`/`relativePath` 只出现在**应答行**里，不是入参。
3. **伪造 `libraryId` 到不了别人的树**：sidecar 是 run 作用域的，`service.libraries` 里只可能有本 run 用已授权根 open 出来的条目；对不上就是 `library_not_open`（这条原本只在代码注释里断言，现在是查过参数结构后的结论）。

### 3.4l 「节点怎么声明它要哪个服务」现查结果（2026-10-05 14:53–14:54）——P5 的落点比 §5 P5 原先写的更具体，也更难看

现查三条，逐条都跑了命令、没靠记忆：

1. **清单里没有 `services` 这一列**：`docs/xiranite-target-node-manifest.json` 有 `programs`（带 `confirmBeforeRun`，被 `audit-target-node-manifest.ts:244/269/426` 消费），但 51 个节点条目里**声明服务的有 0 个**。
2. **deriver 也不产服务名**：`scripts/derive-scripted-policy.ts:225` 无条件 `services: []`，并把这类节点标成 `needs-named-grants`；它的注释说这是故意的——bundle 只能证明「有代码伸向 `proc.exec`/`service.invoke`」，证不名**操作员该允许哪个名字**，名字归 `DangerGate`（ADR-0073）。
3. **正路其实存在，只是没人走**：`realm_run.rs:52-57` 的 `RealmRun::new(descriptor)` 读的是 `descriptor.requirements.services`，`:118` 再把它装进 machine ⇒ **生产默认路径的服务名单来自清单/deriver**，而 deriver 那边恒为 `[]`（第 2 条）⇒ 51 个节点在默认路径上一个服务都拿不到，`service.invoke` 全被正确拒掉。
4. **唯一的例外是绕过描述符的字面量**：`crates/xiranite-builtin-host/src/kisaki.rs:47` 自己在本地建 machine 再 `.with_services(&["czkawka"])`，**不经过 `RealmRun::new(descriptor)`**。⇒ `kisaki` 能用 czkawka，但它的 `NodeRequirements` 说的是「我什么都没声明」：**同一件事有两个权威，而且门禁（读 descriptor 的那批）看不见这次授予**。dev 工具 `quickjs-run.rs:266` 从 `--services` 取，属诊断面，不算第三个权威。

所以 §6 第 8 条那句「我倾向乙」的真正理由比「整洁」硬：走甲等于给 findz 再造一条 `kisaki.rs` 那样的绕过，第二份权威从 1 变 2；走乙则是把 `kisaki` 那条已经存在的偏差一并收编（它的 `czkawka` 进清单列之后，descriptor 与授予才重新一致）。**并且乙不需要等 P4**：先补列、再把 `kisaki.rs` 那条字面量删掉。**但光补列还量不到漂移**（现查 `scripts/audit-node-registry.ts`：全文没有一处 `services`，它比的是「bundle 有没有嵌」与「注册表有没有服务这个 id」两份名单）⇒ 走乙必须**同时**给那把尺加一条差集：「清单/派生策略声明了某服务，而该节点的宿主需求里没有它」以及反向。否则 `kisaki` 今天这种「descriptor 说没声明、组合点却给了」的漂移照样看不见——**这把尺不加，乙只是把权威从一个换到另一个**。

难看的地方：AGENTS.md 明写「逐节点的 `register_node!`/`link_nodes!` 与 `NodeRegistry::builtin()` 这类**编译期仪式退役**」，而服务名目前**正是**这种逐节点编译期字面量——`kisaki.rs` 已经是第一个样本。所以 P5 有两个都能收工的选择，必须先定再动手（列进 §6 让用户拍）：

- **(甲) 照现成的形状来**：宿主组合点加 `&["findz"]`，一行、能跑、与 `kisaki.rs:47` 那条 `&["czkawka"]` 同形；代价是仓里多一条本该退役的逐节点仪式，而且下一个要服务的节点还得再来一行。
- **(乙) 按 ADR-0073 的方向补**：给清单加 `services` 列（与 `programs` 同形：名字 + 一句 `evidence`），deriver 从「pendingGrants 里点名了服务」搬到这一列，注册表读它 ⇒ `service.invoke` 的门禁数据是清单，不再有第二权威。代价是清单 schema、`audit:target-node-manifest`、deriver、`NodeRegistry` 四处同批改（**这正是本仓反复踩的「只改一半」坑**）。

我这批代码两边都不挑：`host_services.rs` 的 SERVICES 行 + `machine.declared_services()` 只读「已声明的名单」，**甲乙都接得上**——所以这条不阻塞 P1，只阻塞 P5。

### 3.4m 待提交批次：接线清单与重新验证配方（现查 2026-10-05 14:58，`but diff` 之前先看这段）

**为什么还压着**：`git diff HEAD -- crates/xiranite-quickjs-executor` 现查 = 20 文件 **+148 / −6261**，那 6 千行是 ADR-0078 的拆解（`machine.rs`/`host_calls.rs`/`jobs.rs`/`shims.rs`/`fs_operations.rs`/`proc_operations.rs` 与两份 tests 整文件在删），`but commit` 整文件收会把它卷进我这一笔；只提我 4 个新文件又不接线，分支就编不过（本地全绿≠分支自洽）。⇒ **等他们那半落地，作为一个自洽提交进来。**

**我的半边 = 4 个新文件（现查仍 `??`）**：`src/sidecar.rs`、`src/sidecar/tests.rs`（由 `sidecar.rs` 末尾的 `#[path]` 引入）、`src/findz_operations.rs`（638 行）、`src/bin/sidecar_testee.rs`。

**四处接线，逐处给「落地后如果不见了要补什么」**（他们重写同一文件时很容易把我这几行挤掉——检查方式就是 `rg`，别肉眼回忆）：
1. `Cargo.toml`：`process-wrap = { version = "10.0.1", features = ["std"] }`（**`std` 不在 default 里**）+ `[[bin]] name = "sidecar-testee"`。查：`rg -N "process-wrap|sidecar-testee" crates/xiranite-quickjs-executor/Cargo.toml`。
2. `src/lib.rs`：`mod sidecar;` 与 `mod findz_operations;`。查：`rg -N "^mod (sidecar|findz_operations);" crates/xiranite-quickjs-executor/src/lib.rs`。
3. `src/machine.rs`（`MachineAccess`）：一个 `sidecars: Arc<Mutex<SidecarTable>>` 字段 + **两处构造**（`granted()`/`granted_in_place()`，漏一处就是「有 grant 的 run 拿不到表」）+ 一个照 `processes()` 的 `sidecars()` 访问器。查：`rg -N "sidecar" crates/xiranite-quickjs-executor/src/machine.rs`（应为 4 处上下）。
4. `src/host_services.rs`：`SERVICES` 里那行 `findz`（`methods: findz_operations::METHODS`、`dispatch: findz_operations::dispatch`）。查：`rg -N "findz_operations" crates/xiranite-quickjs-executor/src/host_services.rs`。

5. `packages/quickjs-shims/src/surface.ts` 的 `REALM_PACKAGE_ALIASES` 一行：`"@xiranite/findz-native": "findz-service.ts"`（P4 的 realm 入口，见 §3.4n），**以及** `scripts/audit-node-bundles.ts` 必须开始读这张表——它现在不读，于是爬真包看到 `findz-native/index.ts:63` 的 `import.meta.url` 就判 findz FAIL，量的不是宿主真正加载的那份闭合。两处都在别人手里（`MM`）。

6. `Cargo.lock`：我那行 `process-wrap` 必须与它对应的锁条目**同批**提交（HEAD 本身是自洽的，见 §3.4p 第 4 条的更正）⇒ 提交前跑 `cargo check -p xiranite-quickjs-executor --lib --offline --locked`，RC=0 才提。这是「提交了引用没提交被引用者」在锁上的形态。

**提交前必跑的三件**（顺序有意义，别再踩「`--lib` 不重建 `[[bin]]`」）：`cargo build -p xiranite-quickjs-executor --bin sidecar-testee -j 1` → `cargo test -p xiranite-quickjs-executor --lib -j 1 -- --test-threads=1` → `cargo clippy -p xiranite-quickjs-executor --all-targets --no-deps -j 1 -- -D warnings`。**期望**：串行 101 passed / 0 failed、clippy 0 条。⚠️ 默认并行口径会随机 SIGSEGV（8 轮 3 轮，且 `--skip` 掉我这 22 条仍能复现，见 §3.4i 第 4 条）——**别把那个红记成 sidecar 不稳**，也别为它放宽门禁。
**再跑一次真内核取证**：`.findz-sidecar-spike/crash-run.sh`（受控 kill）与 `SKIP_KILL=1` 那条对照，判据在 §3.4i 表里；注意 kill 必须按父子关系取 pid（`pgrep -x quickjs-run` → `pgrep -P`），按名字 `pgrep` 是瞎尺。
**归属**：提交后按仓规验 `git show --numstat`，确认只有我那 8 个路径（4 新 + 4 接线）；若他们的文件出现在我的笔里，就是整文件收又吞了别人 hunk。

### 3.4n findz 真的在 realm 里答话了：P4 的第一步已跑通（2026-10-05 15:13–15:21，全是实测）

`audit:node-bundles` 那句 `ALLOW findz: … Replacing the worker with a host service is unstarted` 现在**不再成立**——半边已经换掉了，形状比原稿小得多：`core.ts` 本来就写成 `runFindzWithGateway(input, gateway)`，所以只需要换 gateway，业务逻辑一行没动。

- **新落点**：`packages/nodes/findz/src/protocol.ts`（`FindzMethod` / `FindzGateway`，15 个名字里去掉 `shutdown`，并按决策 5 排除 `watcher.*`）；`packages/findz-native` 暴露通用 `callFindz(method, params)`（它内部本来就有这个 `invoke`，只是没出口）；`packages/quickjs-shims/src/findz-service.ts`（新文件）用 `service.invoke` 答同一个出口，错误文案保持 `` `${code}: ${message}` ``，让两条面在失败时读到同一句话；`surface.ts` 的 `REALM_PACKAGE_ALIASES` 加一行把 `@xiranite/findz-native` 指向该 shim；`worker-client.ts`/`findz-worker.ts`/`worker-protocol.ts`/`worker-client.test.ts`/`scripts/smoke-worker.ts` 与 `smoke:worker` 脚本一起删；`audit-node-bundles.ts` 的 findz 豁免条目**删空**（豁免活得比它的理由久，就是门禁开始放过它本来要抓的东西的方式）。
- **跑通的东西**（`esbuild --alias` 出的真实 bundle + 真实宿主 + 真实 Go 内核）：`action:"open_library"` ⇒ `success:true`、`libraryId=library-0c8c627fb2ccb385`、`databasePath` 落在宿主指定的索引目录、`watcherHealth:"healthy"`、run 结束残留进程 0；`action:"api_info"` ⇒ `abiVersion:1 coreVersion:"0.1.0"`。TS 侧 `packages/nodes/findz` 8 passed、`packages/findz-native` 5 passed。
- **顺带抓到一个真缺口并已修**：`api.info` 在旧形状里**只是 C ABI 的一个符号**（`ffi.go:23` `//export findz_api_info`），stdio 信封里根本没这个方法 ⇒ realm 永远问不到。已给 Go 加 `api.info` 分派（`service.go`）+ 进 `Capabilities`（`protocol.go`）+ 新测 `TestServeLoopAnswersAPIInfo`（`go test ./...` 通过，含此测），Rust 侧 `METHODS` 同步加名（那条与 `protocol.go` 互相钉住的测仍绿：`findz_operations` 11 passed）。
- **量出来的行为，不是猜的**：同一个库在**第二个 run** 里按 `libraryId` 问 ⇒ `service.invoke failed: {"code":"library_not_open"…}`。这是 run 作用域 sidecar 的直接后果（决策 9 的边界），⇒ **core 必须在带 root 的动作前 ensure-open（`library.open` 幂等）**，而今天 GUI 的第二第三个动作只带 `libraryId`。这条落在 P7：面侧要把 root 一起传（或改走 operation，暂停/取消按决策 6 打 `/node-operations/{id}/pause|cancel`）。
- **两条它必须等的前置（都不在我的文件里，所以这批先不落）**：
  1. `scripts/audit-node-bundles.ts` 目前是 `MM`（别人在途），且**全文不读 alias 表**——它爬的是真包，于是看到 `findz-native/index.ts:63` 的 `import.meta.url` 就判 FAIL。`build-node-bundles.ts` 与 `spikes/shim-consumer-audit.ts` 都读 `REALM_PACKAGE_ALIASES`，这把尺也得读，否则它量的不是宿主真正加载的那份闭合。⇒ 记成 §3.4m 的第 5 个接线点。
  2. **删 worker 的顺序错了会掉功能**：`findz-worker.ts` 里带着 `@parcel/watcher` 的喂料，而宿主 notify 服务是 P3、还没建。现在把 worker 删干净，watch 能力就同时从两条面上消失。⇒ 这批 TS 改动留工作区，**P3 落地之后再提**（`surface.ts` 那一行同理，得跟他们的重构一起进）。

### 3.4o findz 一次 run 跑完整张扫描（2026-10-05 15:26–15:36，全是实测）

§3.4n 那批换掉 gateway 之后，扫描其实**还不能工作**：`scan.start` 只答 `queued`，动作一结束 run 就结束，宿主随即终止 sidecar ⇒ 任务以 `paused` 落在盘上。100 归档夹具上量到的就是这一形：`task.get` 回 **`paused 2/100`**，带引擎自己那句 `Recovered after the native worker stopped.`。这正是决策 6 说的「一次 run 内 await 长轮询到终态」还没接上。

- **等待只能放在引擎侧**：realm 里没有定时器（实测：执行器一个都没给），节点没法自己 pace 轮询 ⇒ Go 侧新增 `task.wait{libraryId,taskId,timeoutMs}`（默认 2 s、上限 30 s、50 ms 读**同一张落盘任务行**，所以跨进程重启它也不是第二个真源），已提交 `ksz`（含 `TestTaskWaitHoldsOneFrameUntilTheScanFinishes`：一帧内到 `completed done=1`，且未开库必须回 `library_not_open`）。
- **core 侧**：`ensureLibrary(gateway, input)` ⇒ 每个动作先 `library.open`（幂等），并且**动作用的 id 只从引擎回读**，不信调用方带来的旧 id；`scan`/`analyze` 走 `awaitFindzTask` 直到离开 running/queued。措辞修了两处自欺：终态不再报 99%，run 结束不再说 `Queued`。
- **id-only 的动作现在给的是能照着改的拒绝**（`Findz actions need library.root…`），不是等引擎回一句像故障的 `library_not_open`。这条把 P7 的具体改动钉死了：**面侧每个动作都要带上 root**（或改走 operation，暂停/取消按决策 6 打 `/node-operations/{id}/pause|cancel`）。

| 实测（真实 core bundle + 真实宿主 + 仓内现编 Go 内核，`--services findz --node-id findz`） | 结果 |
| --- | --- |
| `api_info` | `abiVersion:1 coreVersion:"0.1.0"` |
| `open_library` | `libraryId=library-0c8c627fb2ccb385`、索引落在宿主指定目录 |
| `scan`（修前 / 修后） | `queued` ⇒ 另一 run 读到 `paused 2/100`  **/**  **同一 run 内 `completed 100/100`，499 ms** |
| `query_archives` | `total=100`，行带 `scanState:"indexed"` |
| `analyze` | `completed_with_warnings`、`doneMembers=400` |
| `export_rows` | `total=100` |
| `treemap` | 节点带值（`Library` = 2516） |
| 进程残留 | 每一轮都 0 |

**门禁**：Go `go test ./...` ok；`packages/nodes/findz` **12 passed**（含两条新尺：「引擎永不 settle 时停在 5000 轮的止损」与「任务已终态就一帧都不等」的正控）；`packages/findz-native`、`packages/quickjs-shims` 全过；Rust 执行器串行 **106 passed / 0 failed**（`METHODS` 与 `protocol.go` 互相钉住的那条含 `task.wait`）。

**P3 的确切缺口（现查 15:39）**：真正的 `@parcel/watcher` 订阅只在被删的 `findz-worker.ts` 里；`packages/nodes/findz/src/watcher-service.ts` 只剩纯函数（`coalesceFindzWatcherEvents` 等），且**全仓零 import 者**。⇒ 增量 watch 今天在两条面上都不存在，不是「藏在别处还能用」。这批 TS 因此在 P3 落地前不提交（不是怕门禁，是怕把功能删没了）。反向说：那份 coalescing + 250 ms 静默窗 + stat 稳定复查就是 P3 该搬进宿主的语义源，别在宿主里重写一遍。

**仍未完成（不遮掩）**：① **findz 还没进注册表**——`crates/xiranite-scripted-nodes/src/registration.rs` 是 `@generated by scripts/embed-node-bundles.ts`，而那个生成器会同时重写全部 30 份签入 bundle，在别人 in-flight 时跑等于把他们的节点源码打进我的提交 ⇒ 等拆解落地再跑；② `surface.ts` 的 alias 行与 `audit-node-bundles.ts` 读表（§3.4m 第 5 点）；③ P3 宿主 notify（`findz-worker.ts` 里那条 `@parcel/watcher` 喂料的替代，删 worker 的前置）；④ P7 面侧带 root / operation 控制；⑤ P6 删 `packages/findz-native` 与 9 MB prebuilt zip。**所以这批 TS 改动留在工作区**（备份与 sha 已刷到 `.findz-p1-backup/`，被删的五个 worker 文件原文在 `deleted/`）。

### 3.4q P3 落地：宿主 own 的 watch 现在真在喂引擎（2026-10-06 00:07–00:12）

上一轮我把 P3 记成「起手后停手」，这一轮它做完了。落点仍全部在我自己的文件里，`machine.rs` / `host_services.rs` 一行没动。

- **形状**：`src/watch.rs`（状态机 + notify 订阅线程）→ `LibraryWatch` 挂在 `LiveSidecar.watches` 上（**run 作用域**，`Drop` 里 join 线程并退订）→ `library.open` 成功后由 `start_library_watch` attach（root 用**授权解析后的 canonical 路径**，和核心派生库 id 用的是同一个值）→ 投递在 `flush_findz_watches` 里，发生在**节点那一帧之前**、持着同一张表锁，所以一个 child 仍然只有一个写者，§3.4f 那条配对不变量一点没松。
- **语义照搬 `watcher-service.ts`**：每路径取最新、250 ms 静默窗每来一批重计、`(size, mtimeMs)` 稳定复查、投递失败 ⇒ `degraded` + **只排一次** `scan.reconcile`、恢复后再补一帧 `healthy`、`close()` 幂等。宿主能发 `watcher.apply_changes`（`host_frame` 是唯一出口），节点仍被 `HOST_ONLY_METHODS` 拒——这是决策 5 需要的不对称。
- **尺（122 passed 串行、clippy `--all-targets -D warnings` RC=0）**：`watch::tests` 11 条，含真 notify 的 `a_real_file_appearing_in_the_library_reaches_the_buffer`（0.62 s 落地）；`findz_operations::tests::the_host_can_feed_the_engine_what_a_node_is_refused` 同时断两侧（host 的帧到了引擎、node 同名方法仍被拒），只断前一半的测会在「门开着」时照样绿。
- **一条我自己写错的测，记下来因为它正是那条稳定规则的猎物**：live 测初版每 150 ms 重写同一个文件再等投递 ⇒ 永远等不到——mtime 一直在动，稳定复查按设计就不该信它。改成「写一次再轮询」即过。⇒ **测投递前先确认自己没在制造不稳定**。
- **一次证明不了的 e2e，也记下来**：6000 归档扫描中途丢一个文件进去，run A 直接报 `totalArchives: 6001`——核心的计数是**动态**的（不是我原先以为的「开跑时定死」），所以这条测法区分不了「watch 投进去的」还是「扫描器自己走到的」。结论只由上面那条 Rust 测支撑，不由这条 e2e 支撑。
- **依赖定了**：`notify 8.2.0` 稳定线（+`notify-types`/`fsevent-sys`/`inotify`/`inotify-sys`/`kqueue`/`kqueue-sys`，mac 走 fsevent），版本线那道未决项结案；它和 `process-wrap` 一样必须与 `Cargo.lock` 同批（§3.4m 第 6 点）。

**用仓里自己的构建器验过一次（16:25–16:26）**：`bun scripts/build-node-bundles.ts`（`--only findz` 这个版本仍会全量跑，产物落 `artifacts/node-bundles/`，不进 `crates/.../bundles/`——那是 `embed-node-bundles.ts` 的活，仍 parked）报 **`findz 80.9 KiB … 0 nodes with a failed bundle`**；把生产闭包 `artifacts/node-bundles/findz.js`（93,099 B）直接灌进 `quickjs-run` ⇒ **`completed 100/100`、765 ms、残留进程 0**。也就是说 §3.6 那条「realm 入口用现成的生成表面 + alias，不新写逐服务 shim」在**真构建路径**上成立，不只是我手工 esbuild 的那次。
顺带一条与审计有关的实测：这份生产产物里有 125 处裸 `Buffer` 标识符（来自内联的 `node-buffer` polyfill），**跑起来没问题**，而 `audit:node-bundles` 会因为同样的 closure 判 `FAIL findz: core closure reaches a Node global outside the allowlist: Buffer`。⇒ 那条尺现在量的仍是「源码闭包里出现过这个名字」，不是「宿主加载的那份闭合里有没有未绑定的全局」；这正是 §3.4m 第 5 点（它不读 alias 表）的第二个症状，第一个是 `import.meta`。

**「崩溃之后喂料还在」这条测了，而且我删掉了一处自己写的过度设计**：`a_replacement_engine_is_watched_again_by_the_nodes_reopen` —— 开库、外部 `kill -9` 掉那台引擎、让节点下一次调用重新 `library.open`（id 一致、pid 不同），再往库里丢一个文件 ⇒ 新引擎的缓冲收得到。**证伪**：撤掉 open 成功后的 attach ⇒ 该测红在 `the engine that came back after the crash is not watched … (pid 20974)`；装回来 123 passed。撑住它的**不是**表里的重启钩子：我先写了 `start_hooks` + `unwatchable` 两套机械（约 40 行），同一条测**没有它也过**——因为 core 的 ensure-open 保证节点下一帧必然重新 open，watch 就随之重挂。留着它就是我自己的测在为一个不可能发生的场景付抽象费，也是 AGENTS.md 明禁的「为理论兼容堆抽象」⇒ 删。（clippy 顺带在删之前先报了一条 `very complex type`，那条字段类型正是钩子表的形状。）

**新的一条后果（写进 ADR-0077 决策 10）**：run 作用域订阅 ⇒ **没有 run 就没有喂料**。GUI 空闲时文件系统变了不会进索引，收敛靠下一次 `scan` / `scan.reconcile`；`watcherHealth` 的语义因此缩成「这一 run 内订阅是否成功」，不再是「这个库有没有人看着」。这不是 bug，是 A2（一次 run 一个进程）的直接推论——但它是用户可能不想要的产品行为，所以要摆在明面上。


---

## 4. 明确不做

- **不做** findz 业务逻辑的 Rust 实现（用户 2026-10-05 已判每节点 Rust 实现归零；`czkawka_core` 那种「借来的上游引擎」不算，Go 内核同理，Rust 只有通道）。
- **不做**第二份协议：不 fork `rmcp`、不引 Go 侧 MCP SDK、不把 findz 已有的 envelope（`protocol.go` 的 `abiVersion`/`requestVersion`/`Capabilities`）换成别人的。写的那几十行是**管道**（写一行、读一行、终止），不是协议。
- **不**把 `jsonrpc-core`（实测停在 **2021-07-20**）请回来。
- **不让** face 进程 spawn sidecar（ADR-0074 §5），**不让** sidecar 直接对 GUI/CLI 暴露成第二个 `/operations` 后端（那是已退役的 external node launch 形状）。
- **不恢复** `bun:ffi`：两个调用点（`packages/findz-native/src/index.ts:103-112`、`packages/native-loader/scripts/build-native-assets.ts:160-195`）随包一起消失，`docs/adr/0075:225-230` 那条待决项结案。
- **不写**逐节点 sidecar 的私有胶水；只允许一份通用通道 + 数据声明。
- **不**为了「文档对齐」把 `native/prebuilt` 的 zip 留下当占位；9.0 MB 手工二进制出库，改成构建产物。
- **不在** realm 里塞 socket/fetch 来「解决」这个问题。

---

## 5. 分期（每阶段配一条能红的尺）

**P0 探针** — 冷启动那半**已跑**（见 §3.2，2026-10-05 本机数据，判决：A1 否决、A2 落点、1 MiB 那笔账销掉）。剩下两半未跑：
(a) **run 作用域的 sidecar 持有者**：宿主在 run 首次调用时起子进程、写一行请求、读一行响应、run 结束必杀必收。尺 = 「run 抛异常/被 cancel 时 OS 里没有残留 findz 进程」，正控用 `machine.rs:508` 那套 `process_alive`/`wait_for_exit`，并配一条「故意不杀必须红」的对照。
(b) **~~两种 framing 的对照~~ 已判决**（§3.4）：`process-wrap` 的传递依赖逐个查 `Cargo.lock` 全部已在锁里 ⇒ 净新增 1 个 crate；`rmcp` 那条是 `rmcp`+`process-wrap`+`which` 三个外加一条 current-thread runtime 线程。**选 `process-wrap` + 行分帧，不上 MCP。** 因此 `CallToolResult`/`structuredContent` 那条不再相关，本仓查不到的那三件事也不必再证。
     **Windows 臂的编译验证已在仓库外做掉**（镜像 crate `pw-win-check` 对 `x86_64-pc-windows-msvc` ⇒ rc=0；写成 `JobObjectTypo` ⇒ E0425 能红），运行时仍待 Windows 机。**未验缺口**：`#[cfg(windows)]` 的 `JobObject` 那条臂在本机不参与编译，Windows 侧「终止干净」目前只有源码依据、没有实机证据——落地时配一条源码扫描尺，并在 Windows 机上真跑一次才算数。

**P1 通用 sidecar 设施** — **已落地（§3.4b/§3.4g/§3.4h，未提交批次见 §3.4c 的归属说明）**，两处与初稿不同，按实测的形状记：
- **声明位没有新增 kind**：不新建 `NodeRequirements` 字段，sidecar 走现成的 `services` 名单（`crates/xiranite-quickjs-executor/src/host_services.rs` 顶部注释记的就是这条规则——授权读 `NodeRequirements::services`）。新增一条「sidecar 声明」会是第二个真源。
- ① 未声明该服务的 bundle 调用 ⇒ 拒绝且拒绝文案点名「该节点实际声明了什么」（`host_services.rs` 里读 `machine.declared_services()` 的那条分支）。**已实现并有测**。
- ② **持有 sidecar 的会话结束后，OS 里没有残留进程**——`dropping_the_run_leaves_no_child_behind` + 正控 `the_liveness_gauge_sees_a_child_that_was_never_terminated`；尺不是 `kill -0` 而是 `ps -o state=`（僵尸照样答 `kill -0`）。**已实现**。
- ③ 原稿写的「一次可配重启」改成了**当场逐出 + 下一次调用起新引擎**（§3.4h、ADR-0077 决策 9）：崩溃那一次回数据型 refusal（带死掉的 pid 与 stderr），没有可配的预算旋钮需要接线，因为重启动手权在节点调用方。

**P2 Go 侧** — `native/findz-go/ffi.go`（57 行、四个 `//export`）换成 stdin/stdout 行循环入口（探针里那份 `probe_serve.go` 即成品形状）；`protocol.go` 的 envelope 与 `service.go:89-274` 的 15 方法分派、`:47-78` 的 requestId 幂等 LRU **原样不动**（跨进程后幂等反而更有意义）。尺：现有 `service_acceptance_test.go`（506 行）、`service_test.go`（368 行）、`scanner_benchmark_test.go`（238 行）全绿，**不许改断言**——那 1,182 行 Go 测试是保留 Go 的最硬理由。

**P3 宿主 watch 服务** — **节点侧的门先关上了**（`HOST_ONLY_METHODS`，见 §3.5），剩下的缺口全在宿主半边。notify + debouncer，按库订阅、缓冲、投递 `watcher.apply_changes`（`service.go:149`）与 `watcher.set_health`（`:163`）；`packages/nodes/findz/src/watcher-service.ts` 的 250 ms 静默窗与 stat 稳定复查（`:68`、`:138-160`）搬进宿主。尺：真实临时目录造「新增/删除/改名」三类事件，断言最终索引收敛；健康态 degraded 必须能触发 reconcile（`findz-worker.ts:104-108` 的现有语义）。

**P4 节点 TS core 变成真实现** — **落点已按 §3.6 改写**（用已有的生成表面 `capabilities.service.invoke`，不再新写 `findz-service.ts`、不补 `MODULE_SURFACES`；面侧那条 `service.invoke` 在 Node 传输里是按名字抛错 ⇒ 走 `/operations`）。任务状态机与幂等组合、规则树→查询规格、分页游标、导出、treemap、异常汇报、进度词汇表（照 `czkawka_operations.rs:16-19` 那条：宿主答快照，节点自己措辞）。删 `platform.ts` 的 `{runtime:"bun-worker"}` 标记与 `worker-client.ts`/`findz-worker.ts`/`worker-protocol.ts`。尺：`audit:node-bundles` 不带豁免跑绿（见 P5）。**另加一条（ADR-0077 决策 9 的边界）**：换上来的是新进程，`service.libraries` 那张表是进程内的（`service.go:102`、九处 `library_not_open`）⇒ core 收到 `library_not_open` 必须自己重发一次 `library.open`（同 root 派生同一个 id、`database.go:62` 重开同一个 SQLite 文件，落盘的索引与 `paused` 任务行原样还在），**通道不替节点补这次 open**。尺：一条「引擎在两次调用之间被换掉，节点照样查回同一个库」的用例。

**P5 注册与门禁归零** — `registration.rs` 从 `UNREGISTERED_BUNDLES` 移进 `SCRIPTED_NODE_IDS`、`builtin-host/build.rs:18` 加 findz；**`scripts/audit-node-bundles.ts:69-73` 的 findz 豁免整条删除**（它存在的意义就是这条债）；重跑 `audit:node-feasibility` 把 `docs/xiranite-target-node-manifest.json` 的 `no-host-free-answer` 改成真实分级、`bun run audit:node-registry` 跟上。尺：豁免表里 findz 那一项被删掉且门禁仍绿——**这是「做了」和「文档说做了」的分界**。

**P6 旧层删除** — `packages/findz-native` 整包、`build-native-assets.ts:22-26` 的第三个 binding、`native/prebuilt/*/findz.*.zip` 出库（含 `manifest.json` 条目）、`packages/nodes/findz/package.json:51` 依赖、`packages/nodes/findz/scripts/smoke-worker.ts`。线类型迁到 `packages/nodes/findz/src/protocol.ts`（GUI 那 6 处目前全是 `import type`，已核）。CI 加 `native/findz-go` 的 Go 编译步骤。尺：`bun run audit:plugin-manifests` 类残留面由门禁自己算，不留「以后删」。

**P7 GUI 收口** — 长任务改 run 内长轮询 + checkpoint 语义（`Component.tsx:217-223` 现在是自己 `setInterval` 式轮询 `action:"task"`），watch 健康态走宿主事件流。尺：`src/nodes/findz/Component.browser.test.tsx`（356 行）在 Vitest Browser Mode 下跑，并补一条「取消能中断一个在飞的扫描」的浏览器测。

**P8 文档** — ADR-0053（`status: accepted`，`:64` 自己要求「换原生绑定要一篇专门的 ADR 更新」）挂 superseded；新 ADR **0077**（`docs/adr/` 现最大 0076）记「run 作用域声明式 sidecar + 行分帧 + `process-wrap` 终止 + notify 会话表所有权」，并把 §2.2 那三条 `proc.*` 硬伤作为被否决替代写进去；`docs/migration/node-native-shape.md:166-172`/`:197-198` 与 `docs/migration/node-quickjs-workorders.md:31`/`:47`/`:117-118`/`:200`/`:386` 的 findz 条目一起改。AGENTS.md 里以 `@parcel/watcher`/`findz-native` 为前提的句子同步。

---

## 6. 未决（要用户定，一轮问完）

1. **notify 取稳定线还是 rc**：`notify 8.x` + `debouncer-full 0.7.x`（稳）还是 `9.0.0-rc.5` + `0.8.0-rc.2`（newest）。我倾向稳定线，理由是本仓要发 Windows 优先的成品。
2. ~~`structuredContent` 证不了退到哪~~ **已决（§3.4）**：不上 MCP，这条不再相关；Go 侧也不需要 MCP SDK。
3. ~~Go MCP SDK 选哪个~~ **已决（§3.4）**：两个都不引 ⇒ 顺带省掉官方 `go-sdk` 那条 MIT→Apache-2.0 混合许可的审查。
4. ~~sidecar 粒度：一库一进程 vs 全局会话级进程~~ **已决（§3.4/§3.5）**：**一次 run 一个进程**（表随 `MachineAccess`，Drop 必杀必收）。两条被实测否掉的极端分别是「每次调用一个进程」（857 次轮询 × 26 ms ≈ 22 s 纯启动，且跟不了在飞任务）与「按宿主会话常驻」（多一张能泄漏进程的表，只省下每 run 一次 14–47 ms）。
5. **独立分发（route A）时 sidecar 二进制怎么进包**：`crates/xiranite-desktop/tauri.conf.json:25-29` 现在是 `bundle.active: false` 且**没有 `resources` 键**。要留「sidecar 作为 resources 打进去」这条路，就得先给它一条 Rust 侧解析顺序（沿用 `crates/xiranite-core/src/config_paths.rs:72-78` 的「env 优先 → 平台根」范式，比如 `XIRANITE_FINDZ_SIDECAR` → 资源目录 → PATH）。
6. ~~索引落点的真正控制点~~ **已实现（§3.4d）**：Go 半边已提交（`336e48b8`），Rust 半边写完待与 P1 同提。（前提已用真实内核验，见 §3.4c）：节点传 `databasePath` 时核心照收并把文件写到那儿 ⇒ 洞是真的存在；不传时核心按 `LOCALAPPDATA`/`UserCacheDir` 自派生并在 `result.databasePath` 里回读 ⇒ 宿主拒收不丢控制力。宿主侧的拒绝已写、**未验**（拆解期间编不过）。**要定的规则**是持有者把宿主数据根映射进子进程 env（核心只认 `LOCALAPPDATA`，不认 `XIRANITE_DATA_DIR`；Windows 天然、mac/Linux 需显式），否则 mac 上索引落进 `~/Library/Caches` 而不是 Xiranite 数据目录。
8. ~~**服务名从哪声明**~~ **已定并已由别的 lane 落成乙（2026-10-06 现查）**：`docs/xiranite-target-node-manifest.json` 现在**有 `services` 列**（findz=295、kisaki=405、linku=448 三条已填），`scripts/derive-scripted-policy.ts:234` 读它、`scripts/embed-node-bundles.ts:241` 明写「Service names are carried, not refused」。⇒ 服务声明不再是待拍板项。**findz 注册现在卡在另一处**：`embed-node-bundles.ts:225` 对 platform 节点要求 `status !== "needs-named-grants"`，而 findz 的派生行还挂着两条 `pendingGrants`（`no-host-free-answer: @parcel/watcher, @xiranite/findz-native`、`os-native: @parcel/watcher`）⇒ 见 §8。
9. **findz 的暂停/取消按钮走哪条路（§8.11 查出来的撞车，要用户拍）**：ADR-0077 决策 6 写的是「改打 `POST /node-operations/{id}/pause|cancel`，不再是 findz 的 action」，而 `src/nodes/findz/Component.tsx` 的 `controlTask` 现在发的正是节点 action（`invoke({ action: "pause", libraryId, taskId })` ⇒ core ⇒ `task.pause`）。甲 = 承认现状（引擎真停，run 继续活着轮询）；乙 = 照 ADR 改 GUI（run 级 park，**引擎继续扫**、取消靠重开把 `running` 翻 `paused`）。两条的引擎级行为都已实测（§8.10 与 §3.4i），差别只在「暂停的语义归谁」以及按了暂停之后 CPU 还烧不烧要不要在帮助文本里说明。**不拍也能继续推进别的活**，但 ADR 与代码会一直互相打脸。

7. **崩溃自动重启的次数预算**：1 次还是 0 次（Go 有 `running→paused` 恢复，重启后任务停在 paused 是诚实行为）。我倾向 1 次并显式上报。⇒ **通道层已按「逐出 + 下一次调用起新引擎」落地（§3.4h、ADR-0077 决策 9）**：失败那一次只回带死 pid 与 stderr 的拒绝、**不自动重放**，所以通道里没有计数器可拧。剩下真正要定的只有一句：**TS core 要不要自己重试一次**——那是节点语义，落在 P4。

---

## 7. 体积账（待 P0/P2 实测，不许引用未测数字）

现状 dylib：`native/artifacts/darwin-arm64/findz.dylib` = 9,745,874 B（含 CGo SQLite + 全部归档/图像编解码器）。改成独立可执行后大小会**同量级**，不会更小；省的是宿主侧重复链接的 SQLite（`rusqlite` 0.31 bundled 已在宿主里，findz 不必再带一份）和随 Wails/Bun 一起退役的加载器。⇒ **别把这次改造当成减体积来做**，它是为了让 findz 在新宿主里可达、并让 Go 内核第一次进入 CI 门禁。

---

## 8. 2026-10-06：「为什么不直接用 UniFFI / FFI / WASM」逐条实测 + 当前树重验

用户提出这条方案手写的东西太多，问主流方案行不行。三条全部当场量过（不是引用 ADR——我先前那句「ADR-0073 已作废 ⇒ wasm 出局」是错误记账，作废的是「用 Rust 手写 wasm 插件的便利性问题」，**不是**禁止跨语言 wasm）。

### 8.1 手写的到底有多少（`wc -l` 现测）

总数 3,398 行，拆法是**只有三分之一是 sidecar 独有的**：

| 归类 | 文件 | 行 |
| --- | --- | --- |
| 测试 | `sidecar/tests.rs` 614 + `watch/tests.rs` 250 + `serve_test.go` 218 | 1,082 |
| 进程管路（换 FFI 才能删的部分） | `sidecar.rs` 628 + `serve.go` 143 | 771 |
| findz 自己的语义（换哪条路都得写） | `findz_operations.rs` 973 + `watch.rs` 396 + `bin/sidecar_testee.rs` 131 + `findz-service.ts` 45 | 1,545 |

### 8.2 WASM：硬阻塞在 SQLite，不在压缩包

- `native/findz-go/go.mod` 钉 `mattn/go-sqlite3 v1.14.32`（cgo）。`CGO_ENABLED=0` 下它**编译通过但是桩**：模块缓存 `static_mock.go`（`//go:build !cgo`）里 `errorMsg = "Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo to work. This is a stub"`，`Open()` 直接返回它 ⇒ wasip1 产物能安静编出来、第一次开库才废。
- `GOOS=wasip1 GOARCH=wasm go build ./...` 实测报 `./serve.go:57:35: undefined: sharedFindzService`——那个单例定义在 **`ffi.go`（cgo 文件）**里，非 cgo 构建连它一起消失。
- 要走 wasm 必须换 `modernc.org/sqlite`（全仓 `go.mod`/`go.sum` 零命中＝纯新增），**那是改 Go core 本身**而不是加胶水。
- 压缩包的随机访问**不是**阻塞点：`bodgit/sevenzip`/`nwaples/rardecode`/`klauspost/compress`/`ulikunitz/xz` 都是 `io.ReaderAt` 纯 Go，WASI preview1 有 `fd_seek`/`fd_pread`。⚠️ 这条是从依赖与 API 形状推的，本机没装 `wasmtime` CLI、**没有真跑过 wasip1 二进制**。真受限的是另外三处：**没有 fs-event**（宿主 notify 那 646 行照样留）、**wasip1 无线程＝单核**、线性内存 4 GiB 上限。
- **反转事实**：`Cargo.lock` 里已经有 `extism 1.30.0 → wasmtime 43.0.2`（相关条目 39 个）。`cargo tree -i wasmtime` ⇒ 只被 `crates/xiranite-extism-adapter` 拉；`cargo tree -i xiranite-extism-adapter` ⇒ 只有 `xiranite-node-runtime`；`cargo tree -i xiranite-node-runtime` ⇒ **零依赖者**；`cargo tree -p xiranite-api` 对这三个名字零命中。⇒ 出厂宿主不链它，`target/debug/deps` 那 348 个产物是工作区成员编出来的。**「引入 wasm 运行时」的边际依赖确实为零，但代价是把 P6 本该删掉的退役层转成正式依赖。**

### 8.3 FFI / UniFFI

- **FFI 真的可行**：`native/findz-go/ffi.go` 63 行 C ABI（`findz_call`）还在。走它可删 §8.1 那 771 行，realm 侧一行不改（服务仍是同一个 `service.invoke` 门）。代价：Go 在 cgo 调用里 panic 会**直接带走桌面宿主进程**（findz 干的正是解析用户下载的 zip + 开 SQLite）；每平台要 `-buildmode=c-shared` 的 C 工具链，而本仓 msvc 的 C 构建今天还没过去；并作废 ADR-0077 决策 2。
- **UniFFI 不对口**：官方后端只有 Kotlin/Swift/Python/Ruby，没有 QuickJS/JS 后端；而这里的消费者本来就是 Rust 宿主，绑定生成器只加一层、不删一层。
- **realm 里直接 dlopen 不可能**：`HostOperation` 是闭集（无 socket/timer/worker/原生模块加载），`bun:ffi`/`koffi` 进不去；ADR-0079 又禁止往 `MODULE_SURFACES` 加条目。

**结论（用户已点头按最优继续）**：维持 sidecar。那 771 行连同 1,082 行测试已经写完测过，切 cdylib 是删 771 换 150、功能零收益稳定性净亏；wasm 的收益要拿「改 Go core 的驱动」去换，只有当「一份产物三平台通用」成为硬需求时才值得重开。

### 8.4 当前结构上的重验（旧证据是在被拆掉的 crate 布局上取的，不能沿用）

那条 lane 的 ADR-0078 拆解已落在盘上（HEAD 仍有 `machine.rs`/`engine.rs`/`host_services.rs`，盘上删），所以全部重跑：

- `cargo check -p xiranite-quickjs-executor --all-targets -j 1` ⇒ **Finished，零 error**。
- `cargo test -p xiranite-quickjs-executor -- --test-threads=1` ⇒ 126 passed / **2 failed，两条都是 `host_calls::` 的 clock.sleep 上限**（别的 lane 在飞）。`--skip host_calls::` ⇒ **110 passed / 0 failed，rc=0**（我这批含 sidecar/findz_operations/watch 全绿）。
- **端到端**：`cd native/findz-go && go build -o …/staged-now/findz .`（14.9 MB）+ `cargo build --bin quickjs-run` + `XIRANITE_SIDECAR_DIR=… XIRANITE_DATA_DIR=…/idx6 quickjs-run findz-realm.js run - @req.json <lib-100x8> --node-id findz --services findz` ⇒ `taskStatus:"completed"`、`done/total=100/100`、134 轮 `task.get`、647 ms、**残留 findz 进程 0**；索引实落 `idx6/findz/indexes/library-0c8c627fb2ccb385.sqlite`，而 `~/Library/Caches/Xiranite/findz/indexes` 是空目录 ⇒ 落点那条规则在新结构上仍成立。
- `bun run --cwd packages/nodes/findz test` ⇒ 12 passed。

### 8.5 注册的下一刀（唯一还挡着 findz 在产品里可达的东西）

`crates/xiranite-scripted-nodes/src/registration.rs:115` 的 `SCRIPTED_NODE_IDS` 今天只有 6 个 id（与 HEAD 一致），**findz 不在里面**；`crates/xiranite-quickjs-executor/bundles/findz.js:2346` 还是 worker 时代的 `new Worker("./findz-worker.js")`。链条与实测：

1. `embed-node-bundles.ts:225` 拒 platform 节点的 `needs-named-grants` ⇒ findz 被拒的理由是两条 pendingGrants。其中 `os-native` 与 `no-host-free-answer` 的一半证据来自 `packages/nodes/findz/package.json` 里的 `@parcel/watcher`——**现查该包在 `packages/nodes/findz/src` 零引用**（watcher 已落宿主 notify），也**没有第二个包声明它**（`packages/*/package.json` 与 `packages/nodes/*/package.json` 全仓只此一处）。⚠️ 这次实试过删那一行（删后 `bun run --cwd packages/nodes/findz test` 仍 12 passed），**然后撤回了**：三条 CI job 都跑 `bun install --frozen-lockfile`（`.github/workflows/ci.yml:71`、`:351`、`js-build.yml:62`），只改 `package.json` 不改 `bun.lock` 就是把 frozen install 弄红，而 `bun.lock` 现在是别的 lane 的 `MM`。⇒ **这一行必须和重算的锁同批提交**，落点就是下面第 3、4 条那次全树重算。
2. ~~剩下挡路的是 `core.ts:13-14` 仍 `import … from "@xiranite/findz-native"`~~ **已做（`588d4ac5`，2026-10-06）**：core 不再自己造传输——`FindzRuntime { findz: FindzGateway }` 由 core 声明、`platform.ts` 用 `hostCapabilities.service.invoke` 实现（接口在 core、实现在 platform，同 `kisaki` 的方向），拿不到网关时返回拒绝而不是抛错。**类型权威仍只有一处**（`packages/findz-native/src/protocol.ts`），节点侧 `src/protocol.ts` 只转出，所以 GUI 那 6 处 import 一行没动（其中 `Component.browser.test.tsx` 是别 lane 的 `MM`）。
   - **为什么这不是绕开门禁**：`node-feasibility.ts:593-600` 按 `import_statement` 数说明符、对 `import type` **无豁免**，所以只要 core 还写那条 specifier，`no-host-free-answer` 就一直挂着；改完之后产物的真相是 **`findz-native`/`bun:ffi`/`createRequire`/`findz-worker` 在 `artifacts/node-bundles/findz.js` 里零命中、`service.invoke` 在位**（这把尺量的是 bundle，不是扫描器看不看得见）。
   - **实测**：`bun run --cwd packages/nodes/findz build` tsc_rc=0；测试 12 passed（`core.test.ts` 本来就是从外部注入假网关跑 `runFindzWithGateway`，这一刀不损它）；**真实宿主 + 仓内现编 Go 内核 + 生产 bundle**（`runFindz` + `createNodeFindzRuntime`）扫 `lib-100x8` ⇒ `success:true`、100/100 `completed`、179 ms、3 条进度事件、残留进程 0。
   - **随这批该删而没删的**：`packages/quickjs-shims/src/findz-service.ts`（45 行）与 `surface.ts` 里那条 alias 行现在都是死码——`surface.ts` 是别 lane 的 `MM`，且删它属于下面第 3、4 条那次全树重算。
3. 证据刷新有闸：`bun run audit:node-feasibility` 现测 **rc=1「Refusing to overwrite artifacts/node-host-requirements.json. Pass --force」** ⇒ 我没有 --force 跑它，所以那份产物仍是**旧证据**（还写着 `@parcel/watcher`，盘上已没有）。⚠️ 加 `--force` 会按当前工作树重算**全部 30 个节点**，其中十几个 `packages/nodes/*/src/platform.ts` 是别的 lane 未提交的改动 ⇒ 生成物会把他们的在途源码一起写进来。**这一跑要由拥有那次全树重算的人执行并整份提交，不拆开提。**
4. `scripts/build-node-bundles.ts` 的 `--only <id>` **不缩收集范围**（实测仍报 30 个节点并整份重写 `artifacts/node-bundles/manifest.json`），而 `embed-node-bundles.ts --node <id>` **会缩注册表**（`:209` 把其余节点塞进 `UNREGISTERED_BUNDLES`）⇒ 想「只加 findz 又保住现有 6 个 id」只能跑完整 embed，那会重写 12 个别人陈旧的 bundle（`--check` 现报 25 条问题）。这条也归全树重算那一刀。

### 8.6 一条只有真引擎才照得出来的缺陷：喂了 ≠ 应用了（2026-10-06）

生产 bundle 打通之后，把 P3 的宿主喂料也放到真引擎前跑了一次，结果 **REAL 那跑 `afterTotal=0`** —— 也就是「flush 在节点帧之前」这句承诺当时是空的：

- 根因在 Go 侧的语义，不在 Rust 侧的管道：`native/findz-go/scanner.go:225-248` 的 `applyWatcherChanges` 只**入队**（`enqueueScanWork` → 后台 goroutine `runWatcherChanges`），返回的是刚建的 task 记录。宿主把帧投出去、看一眼 `ok:true` 就往下走，于是节点那一帧读到的是「宿主已经知道、内核还没应用」的索引。
- 修法：`findz_operations.rs` 新增 `settle_index_task()`，喂料成功后用 `task.wait`（realm 无定时器，只能让引擎自己等）把那一批应用完再答节点的帧；有界 8 轮 × 1 s，卡住的引擎由 sidecar 自己的超时说话。**降解时那次 `scan.reconcile` 故意不等**——它是全量重扫（6000 归档可几分钟），绑在节点帧前会把整个 run stall 掉，而那条路径本来就用 `watcherHealth: degraded` 明说了索引不可信。
- `host_frame` 因此从 `Result<bool>` 改成返回应答里的 `result`（拿得到 task id 才谈得上等它）。

尺与证据：

- 测替身现在**按真引擎的形状答**（变更返回 `{"id":…,"status":"queued"}`，并累计它答过的 `task.wait` 帧数为 `waitsSeen`）。`host_frame` 的返回值不是节点帧能看见的，所以 `waitsSeen` 挂在**节点那一帧**的应答上。
- 新测 `the_watch_feed_waits_for_the_task_it_created`：先做控制（没人丢文件 ⇒ 节点帧报 `waitsSeen == 0`，否则这把尺看不见违规），再丢文件、轮询到 `waitsSeen > 0`。
- **减法跑测**：把 `settle_index_task` 改成直接 `return` ⇒ 该测红，消息正是 `never waited for the task it created (waits seen: 0)`，随后撤探针。
- 全套：`cargo build --bin sidecar-testee` 后 `cargo test --lib -- --test-threads=1 --skip host_calls::` ⇒ **111 passed / 0 failed**；`cargo clippy --all-targets -D warnings` **rc=0**（中途被它抓到一条 `format!` in `format!` args）；`host_calls::` 那 2 条红仍是别 lane 的 clock.sleep 上限。
- 真引擎端到端（`watch-production.js`，用 `clock.sleep` 把 run 撑住、外部 1.5 s 时投文件、4 s 后查）：控制 ⇒ `beforeTotal/afterTotal=0/0`；真跑 ⇒ **`beforeTotal=0, afterTotal=1`、`afterPaths=["zz-watch-added.cbz"]`、残留进程 0**（`idx9`/`idx10` 两个独立索引目录，没碰真实缓存）。

方法论记一笔：**替身只能证「帧发出去了」，证不了「对面把它变成了可查的状态」**。这条缺陷是等生产 bundle 打通、把老探针挪到真引擎前才现形的——所以每次换传输都要回跑一次真内核，而不是只跑替身。

补一条同族的尺（2026-10-06）：上面那个 settle 循环的**界**原本只有常量为证。`a_wedged_watcher_task_is_released_rather_than_awaited_forever` 把它变成可失败的断言——替身一旦看到 root 里含 `wedged` 就永远答 `queued`，测断言等待次数**既 ≥ 2 又 ≤ 8**：下界是必要的，因为替身对 `task.wait` 是**立刻**回话的（`timeoutMs` 是请求参数、不是真睡），少掉下界的话「第一轮就放弃」与「跑满界」在这把尺上长得一模一样。**证伪做过**：把 `SETTLE_ROUNDS` 改成 20 ⇒ 该测红在 `the host waited 20 times …`；改回 8 ⇒ 绿。全套 116 passed / 0 failed（`--skip host_calls::`）、clippy `--all-targets -D warnings` rc=0。

### 8.7 提交状态

Rust 那批**仍不能提**：盘上的 executor 拆解（`engine.rs`/`machine.rs`/`host_services.rs` 等 18 个文件 `−` 到 0）没进 HEAD，只提我的新文件就是「提交了引用没提交被引用者」——分支不自洽而本地全绿。Go 半边（`serve.go`/`task.wait`/`api.info`）与文档照常。离线备份 `/Users/glow/Base/Code/Freya/.findz-p1-backup/MANIFEST.txt` 已按这批的 10 个路径刷过 sha256 与抓取时间。

### 8.8 注册这一格现在缺两样东西，其中一样已经被别人补上（2026-10-06）

**「声明 → 宿主应答」那半已经由闸判绿。** 别的 lane 把服务表改成 cargo feature 门：`crates/xiranite-quickjs-executor/Cargo.toml` 的 `default` 里带 `findz`，`host_services.rs` 我那行保留在 `#[cfg(feature = "findz")]` 之后（行的存在性由 `published_services()` 现读，不是扫源码）。`cargo test -p xiranite-quickjs-executor --test manifest_services_are_answered` ⇒ **3 passed / 0 failed**：`every_manifest_service_is_answered_by_this_host` 把清单声明的每个服务名对着**这个二进制实际 dispatch 的表**比；`the_manifest_actually_declares_services` 是「清单不许全空」的正控；`a_service_the_host_does_not_answer_is_caught` 证伪了这把尺能红。

**清单一重算，findz 会立刻撞上下一条拒**——字节上限那道门：

- `crates/xiranite-scripted-nodes/src/registration.rs` 里 findz 那条 `grants name nothing yet … @parcel/watcher, @xiranite/findz-native` 是**上一次生成**留下的文本，早于 §8.5 第 2 步，不代表今天的源码。
- 现在成立的是另一半：`docs/xiranite-target-node-manifest.json` 里 findz 是 `maxLiveBytes: null`，而 51 个条目**44 个都是 null**（今天注册的 6 个全部有名有值：16/16/64/32/16/16 MiB）。`scripts/lib/node-ceiling.ts` 说得很硬——`max_live_bytes = 0` 会让执行器**拒绝排程**，所以「没填」不是「没上限」而是进不了注册表；并且该列被明写为**操作员唯一的杠杆、人的决定** ⇒ **这一格不由我填**，我只把下限量出来。

给拍数的人的现成证据（真内核 + 生产 bundle，`lib-6000x12` 扫到 `completed 6000/6000`，非合成数字）：

| 一次 run 内节点持有的最大文档 | 字节 |
| --- | --- |
| `query.archives`，`page.limit = 1000`（1,000 行，332 B/行） | **332,969** |
| `projection.treemap`，6,000 归档（顶层截到 1,000 个孩子） | **82,950** |
| `query.archives` 默认页 200 行（§3.4 早前实测） | 66,587 |

⇒ realm 侧同时最多持有一页 + 一份 treemap + 一条任务行，**JSON 峰值约 0.4 MB**；按 JS 对象开销放大三五倍仍在个位数 MB，`16 MiB` 那一档对 findz 有实测余量。

**共享 `target/` 会给的坑**：18:00 那次同一个探针突然报 `no host service "findz"; this host answers: config, os, trash, power`。不是代码坏了——是**别 lane 在共享 `target/debug` 里跑了一次不带 `findz` feature 的子集构建，把 `quickjs-run` 换成了那份产物**。当场重编后恢复，并顺带多证一件事：**`healthAtOpen: "healthy"`**——`watcherHealth` 是 SQLite 列（建库写 `healthy`、`watcher.set_health` 改写、`library.open` 回读），所以这个值是宿主 attach 真成功过、且健康行确实跨过进程边界，不是持有者的自我声明。**取证规矩：每次真内核跑之前先重编二进制，并把宿主自报的服务表当断言对象。**

### 8.9 分支上现在有一个「声明没有生产者」的状态（2026-10-06，逐条 `git show HEAD:` 核出来的）

先把我自己上一轮的推论否掉：我看到盘上 `host_services.rs` 里那行 findz 挂在 `#[cfg(feature = "findz")]` 后面，就以为「对方把我的接线采纳进提交了」。**按 HEAD 现读不是这回事**：

| 在 HEAD 里吗 | 判据 |
| --- | --- |
| `findz_operations.rs` / `sidecar.rs` / `watch.rs` | **不在**（`git cat-file -e HEAD:… ` 三条都 no） |
| `host_services.rs` 里名为 `findz` 的服务行 | **不在**（HEAD 那份有 5 行 `name: "…"`，`rg -c "findz"` 零命中） |
| `process-wrap` / `notify` | **不在** HEAD 的 `Cargo.lock`（两条 `rg -c '^name = "…"'` 都零命中） |
| 清单 `docs/xiranite-target-node-manifest.json` 里 `findz: ["findz"]` | **在**，由 `2bcc1752`（`services 进清单：三行声明带证据落进单一真源`）提交 |

⇒ **今天的分支是「声明已进、应答未进」，而唯一会发现的闸 `crates/xiranite-quickjs-executor/tests/manifest_services_are_answered.rs` 本身还是未跟踪文件**（`git show HEAD:` 输出为空）。我在盘上跑它是 3 passed——那验的是工作树，不是 tip。这正是 `scripts/lib/node-ceiling.ts` 注释里数过两遍的那类失误（「policy 字段没读者」）：清单声明了一个服务，而注册表读它的那道门此刻不存在。

后果与落点说清楚：今天 findz 也不在 `SCRIPTED_NODE_IDS` 里，所以这条不会以运行时故障的形式咬人，它是**潜伏**的。但落地顺序因此有了硬约束——**Rust 那批（含那把闸）与清单声明必须在同一个 tip 上会面**；把声明留在分支、把实现继续泊着，比两边都没有更容易让下一个人以为已经通了。

**流程错在我这边（记下来别再犯，两条都本轮发生）**：① Windows 臂的交叉验证我**整份重做了一遍**（临时探针 crate 验完已删），而 ADR-0077「后果」那条早就记着同一个实验（`pw-win-check` + 同样的 `JobObjectTypo` 证伪 + 整 crate 卡在 `dav1d-sys`）——新增信息只有一条：`x86_64-pc-windows-gnu` 撞的是同一堵 pkg-config 墙（已补进 ADR）。**动手重跑一条验证之前先 grep 仓内台账**，否则会重复别人的取证还以为是自己新量出来的。② 上面 §8.9 那次插入我用了「插入型 new_string 不含 old_string 全文」的写法，把这句引导吃掉了（同一条坑我在别的项目里已经记过一次）；用 `rg -n "^### 8\.[5-9]"` + 读尾部就能看出多出一个以「（」开头的残句。**修法是补回引导句，而不是整节重写**——这文件上一轮还被我自己用 python 重排过序号，工具的「file changed since your last read」那次是我的脚本造成的，不是并发方。

### 8.10 控制动词（暂停/继续/取消）已在产品路径上真跑过（2026-10-06）

GUI 的 `WorkspaceHeader` 上就是 `Pause`/`Play`/`Square` 三个按钮，而这三条以前只在替身上验过形状。`.findz-fix/control-flow.js`（同一个 `service.invoke` 门，用刚落地的 `clock.sleep` 撑住在飞任务）在**一个 run 内**打真 Go 内核扫 `lib-6000x12`：

```
startedAs queued → task.pause 答 paused，回读 task.get = paused（此时 doneArchives = 3766 / total 6000）
→ task.resume 答 running，回读 running → task.cancel 答 cancelled，回读 cancelled
elapsed 1295 ms，残留进程 0
```

三条口径记下来省下次重新发现：**必须同一 run**（sidecar 是 run 作用域，换一次调用就是另一台引擎，库表为空、`library_not_open`；而上一台留下的 `running` 行是被**重开时**翻成 `paused` 的，不是被暂停按钮翻的）；**答话与回读要分开断言**（这份表里 `pauseReply` 与 `afterPause` 各是一列，只印一个就看不见「回了但没落」）；`totalArchives` 在早期可能是 0（§3.4 那条老坑），所以「在飞」只能按 `status` 判——这次读到 6000 是在终态之后。

### 8.11 findz 有**两条**控制路，别把它们合成一条（也别据此再造一套机械）

读 `host_calls.rs` / `sidecar.rs` 的 park 点时会冒出一个看起来很该做的改动：「run 被暂停时，宿主应该顺手给引擎发 `task.pause`，否则 Go 还在扫」。查完三段真实接口之后这个改动**不该做**，因为产品里根本没有那条需求：

| 路 | 谁发起 | 实际发生什么 | 证据 |
| --- | --- | --- | --- |
| **节点动作** `pause`/`resume`/`cancel` | GUI 的 `WorkspaceHeader` 三个按钮 → `invoke({ action, libraryId, taskId })`（`Component.tsx` 的 `controlTask`）→ core 的 `case "pause"` → `gateway.call("task.pause", …)` | **Go 自己停住那张任务**（`doneArchives` 冻住） | §8.10：真内核同一 run 内 `queued → paused(3766/6000) → running → cancelled` |
| **run 的 checkpoint** | 工作区对 operation 的 `POST /operations/{id}/pause\|cancel\|resume`（`crates/xiranite-api/src/routes.rs`） | 暂停只是把**等待**park 在 `round()` 里那一圈（引擎继续扫）；取消则 `terminate(sidecar)`，落盘的 `running` 行由**下一次重开**翻成 `paused` | §3.4i 的真内核崩溃取证（SIGKILL 路径与 terminate 同形）：`paused 1708/6000`、`databasePath` 逐字节相同 |

两条都对，且第二条的「park 时引擎继续扫」是**有意的**：sidecar 归 run 所有，run 暂停不该改变引擎的任务状态——要停就按第一个按钮。参数契约也核过：`taskParams` 要求 `input.taskId`（`core.ts` 里 `requiredString(input.taskId, "taskId")`），GUI 传的正是它，而 §8.10 的探针用的就是同一个 `{libraryId, taskId}` 形状。

⇒ **不要往 `sidecar.rs` 加「park 时回调 findz」的钩子表**：那会把上一轮我自己删掉的那类过度机械（`start_hooks`/`unwatchable`，40 行，减法跑测证明不需要）以另一种形式装回来。

⚠️ **但这一节原先的措辞越界了，收回重写的部分**：我上面写「产品里根本没有那条需求」，依据是「GUI 按钮现在发的就是节点 action」。这条**只描述了今天的代码，没有回答产品该走哪条**，而且和 ADR-0077 决策 6 撞车——那句原文是「GUI 的暂停/取消按钮**改打** `POST /node-operations/{id}/pause|cancel`，**不再是 findz 的 action**」（`crates/xiranite-api/src/lib.rs` 那两个路由就是为它准备的）。也就是说：**ADR 定的目标和 GUI 现状是两条不同的路，而没人宣布哪个作数。**

两种选法的差别只在「暂停的语义归谁」：

- **甲 = 承认现状（节点 action）**：暂停 = 引擎自己停那张任务（`doneArchives` 冻住，§8.10 已实测），代价是暂停期间 run 仍然活着、仍在轮询、仍占着一个引擎与一次 `service.invoke` 往返预算。要把这条定下来，就该改 ADR-0077 决策 6 那半句。
- **乙 = 照 ADR 改 GUI**：暂停/取消改打 operation 控制（`Component.tsx` 的 `controlTask` 不再发 action），代价是暂停期间**引擎继续扫**（park 只 park 住等待），取消则终止子进程、靠下一次重开把 `running` 翻成 `paused`——用户按了暂停却看见 CPU 仍在烧，是**可预期的行为而不是 bug**，但要在帮助文本与状态呈现上说明白。

**这条要用户拍**（记进 §6 未决）。拍完之后无论哪条，`sidecar.rs` 都不需要 park 回调钩子：甲本来就归节点，乙明确不停引擎。参数契约两边都核过：`taskParams` 要求 `input.taskId`（`core.ts` 的 `requiredString(input.taskId, "taskId")`），GUI 传的正是它，§8.10 的探针用的也是同一个 `{libraryId, taskId}` 形状。

### 8.12 现场重算把三条我写错的账纠正了（2026-10-06，`feasibility --force` + `derive-scripted-policy --requirements` 实跑）

这次我**只动 ignored 的派生文件**（见第 2 条），不碰清单，跑完按内容复验。三条纠正：

1. **分析器的作用面不是「core + platform 两个文件」，而是整个 `packages/nodes/<id>/src/**` 加 `package.json`**（`packages/tauri-migrate/src/node-feasibility.ts:429-430`：`walkFiles(join(packageRoot,"src"), SOURCE_EXTENSION…)` concat `package.json`）。所以 §8.5 第 2 步那次「把类型说明符从 core 挪进 `protocol.ts`」**没有清掉 grant，只是把引用点搬到了 `protocol.ts:49`**——现读的 `requirementEvidence` 就是这条：`no-host-free-answer | @xiranite/findz-native | packages/nodes/findz/src/protocol.ts : 49`。要真清掉只有两条路，且**都卡在别人的在途文件上**：① 分析器给 `import type` 开豁免（`node-feasibility.ts` 与它的测试都是 `MM`，而 AGENTS.md 对 GUI 债那把尺早已明写「`import type` 不计债——它编译后零字节」，同一规则搬到这里是自洽的）；② 把类型物理搬进节点、改写 GUI 那 6 处 import（其中 `Component.browser.test.tsx` 是 `MM`）。⇒ §8.5 里我写的「分析器只扫 core/platform」按这条作废。
2. **两份派生 artifact 是 gitignored、未跟踪的**（`git ls-files --error-unmatch` 报 NO、`git check-ignore -q` 报 yes；`artifacts/node-bundles/manifest.json` 同）。⇒ 我上一节说「artifacts 干净所以可还原」是**错的推理**：`git status` 对 ignored 路径同样不打印，「没打印」既可能是干净也可能是被忽略，判据只能是 `ls-files`/`check-ignore`。附带后果：注册结果由**不进版本控制的派生文件**决定 ⇒ CI/装机必须自己重算，任何「我把 registration.rs 提上去」的想法都要先问「它读的那份 artifact 是谁生成的」。
3. **删掉那个死掉的 TS watcher 会把 findz 的根授权一起删掉**（这是本轮最值钱的一条，而且是我不该做的动作换来的）。`packages/nodes/findz/src/watcher-service.ts`（161 行）现查**零 importer**、`index.ts` 也不转出——P3 把 watch 落到宿主 notify 之后它就是死码。我把它和它的测试删了，然后：

   | | 删之前 | 删之后 | 还原之后 |
   | --- | --- | --- | --- |
   | `hostRequirements` | `no-host-free-answer, os-native, file-io` | `no-host-free-answer, os-native` | 回到三档 |
   | 派生 `requirements.roots` | `[workspace ReadOnly]`（`accessSource: no write evidence`） | **`[]`**（`accessSource: "no file-io tier"`） | `[workspace ReadOnly]` |
   | findz 测试 | 12 passed | 7 passed | **12 passed** |

   机制在 deriver：**`roots` 是从 `file-io` tier 反推的**，而 findz 这条 tier 唯一的证据点恰好就是那个死文件里的 `node:fs/promises`。⇒ 按现状把 P6 的「删死码」单独做掉，会得到一个**注册得上、但 `library.open` 必被 `FileCapability::resolve` 拒**的节点（root 授权为空）。正解是把根授权变成**清单里声明的东西**（与 `services` 列同性质、同一把闸），而不是从源码里某个已经不该存在的 import 反推出来；`scripts/derive-scripted-policy.ts` 现在是别人的 `MM`，所以这两步要按顺序交给同一批人：**先给 deriver 加一条「roots 可由清单声明」的入口，再删 `watcher-service.ts`**。我已把那次删除**整份还原**（`git checkout --` 两个文件，测试回到 12 passed、roots 回到 ReadOnly 后复验过）。

另外两条顺手量到的事实，都归 deriver 的负责人：**`findz` 的派生 `services` 是 `["findz","findz"]`**（一个事实两个来源——清单列与分析器证据各写一遍；`manifest_services_are_answered` 按集合比所以没红，但这是数据完整性问题）；以及 deriver 今天自己宣布**「不用造名字就能注册」的有 15 个**（classq、crashu、dissolvef、encodeb、formatv、linedup、linku、logx、marku、migratef、nameu、rawfilter、samea、timeu、trename），而注册表里只有 6 个 ⇒ 那次落地批次的规模比「只把 findz 弄进去」大得多，排期别按一个节点估。

### 8.13 「`library.open` 那一帧不投递」是句错话，来源已改（2026-10-06）

我在台账与记忆里都写过「flush 在节点帧之前，但 `library.open` 那一帧例外，否则会把可恢复的重启变成假的 `degraded`+reconcile」。**现读代码不是这样**：`dispatch` 里 `flush_findz_watches(&mut table, host)` 紧邻 `table.request(...)`，**无条件**在每个节点帧前调，没有任何按方法跳过的分支（代码注释与本轮 `rg` 都没找到那样的分支）。

结论没变、机制记错了：**防「陈旧批次投到新引擎」靠的是 watch 的生命周期**——批次从 `sidecar.watches` 上取（`drain_watch_signals`），而 `watches` 挂在 `LiveSidecar` 上，引擎被逐出时随句柄一起消失，所以新引擎的 `watches` 是空的，直到节点重发 `library.open` 才重新 attach。钉住这条的是 `a_replacement_engine_is_watched_again_by_the_nodes_reopen`（它连的是「重启后重新挂 watch」，不是「顺序上跳过一帧」）。

已改：`findz_operations.rs` 里 `flush_findz_watches` 的文档注释补上这句来源说明（进那批未提交的 Rust），记忆条目改为按现读的机制写并标注「原记法是错的」。**别再引用「open 例外」这个说法。**

### 8.14 这个 crate 的集成测第一次被真正执行过（2026-10-06，逐个 `--test`）

起因是一句我原本要写进汇报的话：「全套测试绿」。实际跑 `cargo test -p xiranite-quickjs-executor -- --test-threads=1` 得到的是 `132 passed / 2 failed`（那 2 条是 `host_calls::` 的 clock.sleep，别 lane 在飞），然后 **输出里只有一个 `Running unittests src/lib.rs`** ——`cargo test` 在第一个失败的 target 之后就停了后续 target，而 lib 恒红（那 2 条），所以 `tests/` 下 **11 个集成 target 从来没有被执行过**，一次都没有。它们确实**编译**过（否则不会有那句 to rerun pass），这就是台账里那句「三条腿全编译、零条腿执行」的现场形状。

逐个跑（`--test <名字>`，串行）：

| target | 结果 |
| --- | --- |
| `cancel_pause` | 6 passed / 0 failed |
| `clock_sleep` | 5 passed / 6.74 s |
| `czkawka_service` | 4 passed |
| `embedded_bundles` | 3 passed / 0.04 s |
| `executor` | 12 passed |
| `manifest_services_are_answered` | 3 passed |
| `power_session_service` | 5 passed |
| `process_grants` | 3 passed |
| `shutdown` | 5 passed（`probe` feature 默认关，跑的是出厂路径那 5 条） |
| `sleept_service_contract` | 4 passed |

⇒ **50 条集成测，第一次拿到执行证据，全绿。** 另外把一处我差点写错的措辞收回：`embedded_bundles` 的 0.04 s 不是空转——它的设计范围是**抽样一个 bundle（linedup）对 bun 的基准数字 + 索引与磁盘双向对账 + 一条「模块级抛错必须算失败而不是算文档」的正控**，不是「30 个全求值」。所以「跑得快」在这里不是假绿的信号，是我对它的期待写错了。

浸泡数一并更新：今天 `--lib --skip host_calls::` 串行跑了 **44 轮（8 + 16 + 20），0 红，每轮 116 passed**。这两件事合起来的含义是——**「cargo test 全绿」这句话在这个 crate 里目前不成立也不可信**：成立的那句是「lib 除 2 条别人的红之外全绿，且 11 个集成 target 单独跑全绿」。以后要按后一句说。



### 8.15 宿主喂料的 `delete` 分支也在真引擎上跑过（含对照，2026-10-06）

`HOST_ONLY_METHODS` 这道门的理由一直是「Go 核心会照 `pathWithinRoot` 处理任何落在授权根里的路径，节点发一条假 `delete` 就能把盘上还存在的归档从索引里抹掉」。但**门挡的那个动词本身，从来没有在真引擎上走过一次**——挡的是没测过的形状。补上：

自建 3 包小库（`.findz-fix/lib-del`，`idx17` 独立索引），生产 bundle 先扫成 `completed 3/3`，然后 `.findz-fix/delete-feed.js`（`service.invoke` 门 + `clock.sleep` 撑住 run）：

| | before | after |
| --- | --- | --- |
| **对照**（run 中不动盘） | 3（`arc-00001/00002/00003`） | **3**（同上） |
| **真跑**（1.2 s 时 `rm arc-00002.cbz`） | 3 | **2**（`arc-00001`、`arc-00003`） |

⇒ 一条由 notify 报出的 delete，经宿主喂料、settle、在节点那一帧回答**之前**就把索引行撤掉了；残留进程 0。测完把那个包复制回去，夹具与索引都不外泄（`idx17` 是独立目录）。

**上面那个「别当成已证」的问题，当场用源码答掉了**：`scanner.go` 的 `deleteArchiveByPath`（`:489-496`）只做

```go
runtime.db.Exec(`DELETE FROM archive WHERE relative_path = ?`, filepath.ToSlash(relativePath))
```

**没有任何 `os.Remove`/`unlink`**，根检查是 `filepath.Rel(runtime.root, fullPath)` + 前缀 `..` 即拒。⇒ 喂料的 delete **撤的是索引行，不删盘上文件**。这条区别要让文档与门禁的理由说准：`HOST_ONLY_METHODS` 挡的是**索引完整性**（节点发一条假 delete 能把还在盘上的归档从索引里抹掉，之后在 `scan.reconcile` 之前它对产品不可见），**不是**文件安全。⇒ 日后若有人想放宽这道门，评估的对象是「谁可以改索引」，不是「谁可以删用户文件」。**已核过三处措辞都是准的**（`findz_operations.rs` 的门注释与那条测的注释、`packages/nodes/findz/src/protocol.ts` 的头注释都写成 "drop **index rows** for archives that is still on disk"），所以这次不改代码文案，只把理由钉在这节。

### 8.16 剩下几个动词的产品路径行为，以及一张表的真实条数（2026-10-06）

`.findz-fix/verbs-probe.js`（同一个 `service.invoke` 门、真 Go 内核、`lib-100x8` 的既有索引）：

- **`library.close` 是真关**：同一 run 里关掉之后按那个 `libraryId` 再问，引擎回 **`library_not_open`**——不会悄悄自动复活，「关掉还能查」这种状态泄漏没有发生。随后显式 `library.open` 成功，且 **`libraryId` 与关前逐字节相同**（id 由 canonical root 派生，穿过进程边界仍成立），重开后 `query.archives` 照常读到原有索引行。
- `api.info` ⇒ `abiVersion: 1`、**17** 条能力；`query.members`（`archiveId=1`）⇒ `total: 8`，正合 `lib-100x8` 每包 8 个成员。整轮 281 ms、残留进程 0。
- 顺手把两个口径的数一次核清：宿主表 `METHODS` = **17 条**（含 `api.info` 与 `task.wait`），`HOST_ONLY_METHODS` = **2 条** ⇒ **节点可达 15 条**；引擎运行时报的也是 17 ⇒ 与表逐字相等，钉住这条的是 `the_published_method_set_equals_the_cores_declared_capabilities`（在 `--lib` 的通过集合里，条数现读别引用）。**「表落后于引擎」那种 czkawka 注释里记过的错，这里没发生。**

⚠️ **本文里出现过的「15 个方法 / 节点可用 13 个」是 2026-10-05 的快照**，加完 `api.info` 与 `task.wait` 之后已不适用；以后现读，别引用文中数字：

```
rg -A 20 'pub\(crate\) const METHODS' crates/xiranite-quickjs-executor/src/findz_operations.rs | rg -c '^\s+"'
rg -n 'HOST_ONLY_METHODS' crates/xiranite-quickjs-executor/src/findz_operations.rs
cargo test -p xiranite-quickjs-executor --lib -- the_published_method_set_equals_the_cores_declared_capabilities
```

### 8.17 Windows 腿的两个「编译期就会炸」的坑（读出并修掉），以及一把我试了才发现不成立的尺（2026-10-06）

按 §8.18 的分工（Windows 首次执行归 CI 的 `windows-latest` 腿），先做一次**源码级预检**：CI 那条腿最怕的不是断言红，而是**整个测试二进制编译不过**——那会把整条腿的红记在 findz 头上，而且看不见任何真实行为。读 `sidecar/tests.rs` 抓到两处：

1. **`pid_exists` 只有 `#[cfg(unix)]` 版本**，但 `a_child_that_never_answers_times_out_and_its_process_is_reaped` 里那句「不是僵尸」的断言**没有 cfg 门**（另两处调用点 `:564`/`:611` 是有的）⇒ Windows 上是 E0425。修成 `#[cfg(unix)]` 并在注释里写清为什么 Windows 不需要它：**僵尸态是 POSIX 的形状**，`pid_running` 那条断言在 Windows 上就是全部可主张的东西。
2. **`the_child_leads_its_own_process_group` 的 `let pid = …` 在 cfg 块外面**：Windows 上块被剔掉后 `pid` 变成未使用变量 ⇒ 在 `-D warnings` 的 clippy 步骤里就是错。修法是把绑定移进 `#[cfg(unix)]` 块里（而不是加 `#[allow]`——那条断言本来就只有 POSIX 有意义）。

**顺手揭掉一把假尺**：我本来想在 Mac 上「模拟 Windows 形状」——把文件里所有 `#[cfg(unix)]` 换成 `#[cfg(any())]` 再编译。第一遍用 `cargo clippy -p … --lib -- -D warnings` 拿到 rc=0，看着像「Windows 也能编」；**阳性对照**（插一个调用不存在函数的测）却**照样 rc=0** ⇒ 那次运行根本没编译 `#[cfg(test)]` 里的代码（`clippy --lib` 不带 `cfg(test)`），是空尺。换成 `cargo test --lib --no-run` 后对照立刻红（`cannot find function pid_exists_never_defined`）——尺活了。但同一趟也暴露模拟本身**不成立**：三处报错全在 `kill_from_outside`（`:409-410`）和 `pid_running`（`:49`）这类 **cfg 两臂**的地方——把 unix 臂整体抹掉后留下的形状 Windows 从来不会有（Windows 保留自己那一臂）。⇒ **结论只能是「读码发现并修掉两处、Windows 腿仍属 compile-verified only，首次真编译与执行发生在 CI」**，不能写成「模拟过所以没问题」。

**留一条可复用的判据**：想在非目标机上预检平台分支，唯一可靠的做法是**逐处读 `cfg` 配对**（有 `cfg(unix)` 的地方是否都有 `cfg(windows)` 对应物；块外的绑定在块被剔掉后是否还有人用），而不是整体替换 cfg 属性去骗过编译器。要跑真编译就用 `cargo check --target x86_64-pc-windows-gnu --tests`，但那在本机卡在依赖链的 C 构建（§8.8 的 `dav1d-sys`），**不是** findz 代码的问题。

（修完复跑：`--lib --skip host_calls::` **116 passed / 0 failed**；模拟残留已清零——`rg` 数 `cfg(any())` 与那个假函数名都是 0，两处修改按内容核对仍在。）

### 8.18 AGENTS.md 刚把「谁去 Windows」改成 CI，但这批还没被 CI 覆盖到（2026-10-06）

用户改了 AGENTS.md：**开发机只有 macOS 一台，Windows/Linux 的 bug 由 CI 找出来**，`rust-host` 跑 `[ubuntu-latest, windows-latest, macos-latest]`，且这三条腿**允许成为某条测的首次执行场所**（作废「先在目标机实测过才许扩腿」）；只在某条腿编译过的断言必须写成「compile-verified only」；**真机/SSH 要验什么由用户当场指定**。⇒ 我此前反复问的那句「要不要上 Win11 构建机拿 job-object 运行证据」从此不在我的待办里，Windows 腿的首次执行归 CI。两条现查的落差：

1. **CI 明确不跑这个 crate**。`.github/workflows/ci.yml` 的「Core crate lints strictly」步骤注释写着「Deliberately out of this step: `-p xiranite-quickjs-executor`（its tree is mid-refactor and **has never been clippy-green from this box**）」。括号里那半句**现在已经不成立**：本机上 `cargo clippy -p xiranite-quickjs-executor --all-targets --no-deps -j 1 -- -D warnings` **rc=0**（今天跑过多次，最后一次在 116 passed 那轮之后）。⇒ 落地时要做的 widening 是**逐条测量后再扩**，不是照猜。CI 的实际形状本来就是**按 target 分步**（`ci.yml:486` 是 `cargo test --locked -p xiranite-core --lib -j 1`，`:506` 是 `… --test trash_service -j 1 -- --test-threads=1`），这正好对上 §8.14 那条教训——所以 findz 这批要加的是**两条独立步骤**：一条 `-p xiranite-quickjs-executor --lib`（带 `--skip host_calls::` 直到那条 lane 的 2 条红修好为止，并把这个 skip 写成注释说明为什么），一条 `-p xiranite-quickjs-executor --test <名字>`（先挑 `manifest_services_are_answered` 这类不依赖外部状态的）；clippy 步骤里则把 `-p xiranite-quickjs-executor --all-targets --no-deps` 加进去（本机 rc=0 已量）。`ci.yml` 现在是别人的 `MM`，所以这些我不能自己提。
2. **AGENTS.md 引用的 ADR-0082 文件还不存在**。现查：`docs/adr/` 里最大是 `0081-share-one-action-registry-across-wheel-palette-and-keybindings.md`；`git cat-file -e HEAD:docs/adr/0082-use-ci-as-the-cross-platform-finder-with-mac-as-the-only-dev-box.md` ⇒ NO；全仓 grep 那个编号，唯一命中就是 AGENTS.md 这一行。⇒ 权威句悬在一篇没落盘的 ADR 上。**我没去替它写那篇**（AGENTS.md 刚被改动，那条 lane 大概率正在写；两个作者同一编号会直接撞车），只在这里记下缺口。真出现那篇 ADR 时，findz 侧要对它负责的具体条款就是上面第 1 条那两句（谁首次执行 Windows 臂、以及「compile-verified only」的措辞纪律）。

自己这边先按新纪律改了措辞：`sidecar/tests.rs` 里 Windows 那条 `pid_running` 分支的注释原来写「Unverified on this machine (ADR-0077's open gap)…」，现在写成 **compile-verified only + 首次执行场所是 CI 的 `windows-latest` 腿**，并保留「这条断言就是那条腿用来发现 job-object 漏杀的形状」这句用途说明（进那批未提交的 Rust）。
