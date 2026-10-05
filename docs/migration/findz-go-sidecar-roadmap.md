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

另一会话此刻正在拆 `crates/xiranite-quickjs-executor`：索引里 `machine.rs`、`host_services.rs`、`proc_operations.rs`、`fs_operations.rs`、`digest.rs`、`czkawka_operations.rs`、`tests/czkawka_service.rs` 全是 `D`，`engine.rs`/`shims.rs`/`bundle.rs` 是 `MD`，并新增了 `realm_run.rs`；同时 `crates/quickjs-host-protocol` 已进工作区成员。⇒ **P1 的接线目标正在换地方**，`cargo check` 现在的 6 个错全在他们手上的 `node.rs`/`realm_run.rs`（我的三个文件一条都没有），所以 §3.4b 之后新加的 `databasePath` 拒绝逻辑**处于「已写、未验」状态**——最后一次的绿是它之前的 103 passed / clippy rc=0。

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
7. **崩溃自动重启的次数预算**：1 次还是 0 次（Go 有 `running→paused` 恢复，重启后任务停在 paused 是诚实行为）。我倾向 1 次并显式上报。⇒ **通道层已按「逐出 + 下一次调用起新引擎」落地（§3.4h、ADR-0077 决策 9）**：失败那一次只回带死 pid 与 stderr 的拒绝、**不自动重放**，所以通道里没有计数器可拧。剩下真正要定的只有一句：**TS core 要不要自己重试一次**——那是节点语义，落在 P4。

---

## 7. 体积账（待 P0/P2 实测，不许引用未测数字）

现状 dylib：`native/artifacts/darwin-arm64/findz.dylib` = 9,745,874 B（含 CGo SQLite + 全部归档/图像编解码器）。改成独立可执行后大小会**同量级**，不会更小；省的是宿主侧重复链接的 SQLite（`rusqlite` 0.31 bundled 已在宿主里，findz 不必再带一份）和随 Wails/Bun 一起退役的加载器。⇒ **别把这次改造当成减体积来做**，它是为了让 findz 在新宿主里可达、并让 Go 内核第一次进入 CI 门禁。
