# 节点 core 改由宿主持有的 Node 执行器求值，宿主授权 gate 不保留

- Status: **proposed** — 2026-10-06 由用户判定两件事：「抛弃现在这个 QuickJS 运行时，因为写起来实在太麻烦了」（§为什么这曾经是个问题）与「不用保留授权」（§7）。**决定已拍、执行未验**：本篇没有任何一条在新执行器上跑过，因此不是 `accepted`。
- Date: 2026-10-06
- Related: `docs/adr/0074-keep-runtime-boundaries-with-quickjs-as-one-node-executor.md`（**本篇作废它的 §1/§4 执行器落点条款**；它否决的 napi-embedded 与「core 跑在面自己的引擎上」两条**原样有效且本篇不犯**，见 §3）、
  `docs/adr/0078-keep-the-quickjs-substrate-in-two-portable-crates.md`（引擎 crate 退役，协议 crate 换名续命，见 §10）、
  `docs/adr/0077-keep-findz-go-core-as-a-run-scoped-sidecar.md`（复用它的进程纪律与 envelope，但**明确不复用它的串行配对假设**，见 §4）、
  `docs/adr/0073-retire-wasm-and-register-native-nodes-through-inventory.md`（`NodeRequirements` 的授权部分由本篇撤销，其余有效）、
  `docs/adr/0066-use-checkpoint-host-function-for-plugin-pause.md`（暂停语义不变）、
  `docs/adr/0075-keep-bun-as-runner-and-drop-bun-apis.md`（本篇让它从「例外存在」变成完全真的）、
  `docs/adr/0063-rewrite-backend-in-rust-with-tauri2-axum-extism.md`（**未被触碰**：面↔宿主的 HTTP/Operation 协议一字不改）、
  `docs/adr/0065`（loopback bearer 同样未被触碰；`docs/随机端口.md:3` 那条抱怨因此继续留在面↔宿主这一跳上）

## 范围：本篇只动一跳

现在有三跳：`面 → 宿主`（HTTP `/operations`）、`宿主 → 执行器`（**进程内** QuickJS）、`执行器 → 借来的引擎`（stdio 到 Go、或 Rust 内的 czkawka）。

本篇只改第二跳。第一跳一字不动，所以 ADR-0063 的「React 产品层与既有 HTTP/Operation 协议保留」和 ADR-0065 的 loopback bearer 都继续有效；第三跳是 ADR-0077 的地盘，本篇只借用它的管道纪律。

**这条范围线必须先画清**，否则本篇会被读成「又要换 transport 又要换运行时」——那是两件事，上一轮讨论里我（起草时）把它们混过一次。

## 为什么这曾经是个问题

QuickJS 那层带来的麻烦分两堆，实测各有出处：

**A 堆：realm 里没有事件循环。** `crates/quickjs-realm/src/jobs.rs:399` 只抽干 microtask 队列，全 crate 无 `setTimeout`/`setInterval`/`setImmediate`。后果是被设计吸收掉了、但每一处都留下成本：`clock.sleep` 要分轮且每轮先 checkpoint（`crates/xiranite-quickjs-executor/src/host_calls.rs:266-294`）、czkawka 扫描走 long-poll 而不是转起来（`crates/xiranite-quickjs-executor/src/czkawka_operations.rs:171-179`）、异步答案的 promise resolver 只能存在 JS 侧的整数键注册表里因为 Rust 不许持 `Persistent`（`crates/quickjs-realm/src/shims.rs:22-26`）。`packages/quickjs-shims/src/config-service.ts:23-24` 的注释就是在给这件事打补丁。

**B 堆：Node 的语义要人手抄一份镜像。** `packages/quickjs-shims/src/` 现在 35 个文件；`packages/quickjs-shims/src/surface.ts:116-119` 里 `fs/promises` 一个模块要逐条列 **18 个** host operation 才算「实现了」；`surface.ts:95-99` 与 `:112-114` 是两张 alias 表（外加 `REALM_PACKAGE_ALIASES` 那条注释里记着的一次真实误测：尺与构建不共用同一张表，导致 audit 把传输层自己的 `node:crypto` 当成 shim 消费者数了）；`surface.ts:217-222` 是欠账台账（5 个 czkawka 方法至今没有 host 方法，每条写清「不许返回空答复，因为空会被读成干净目录」）。

用户的判定针对的是 B 堆为主、A 堆为辅：**这套镜像本身是维护负担，而且每加一个能力都要三处同改**（Rust op 名单 + shim 文件 + surface 表）。

## 决策

1. **执行器 = 宿主 spawn 并持有、父子管道独占的一个 Node 进程；节点 core 仍只有一份实现**（`packages/nodes/<id>/src/core.ts`）。ADR-0074 §1 的「一个节点只有一份实现」不变，作废的只是「落点是宿主内 QuickJS realm」。

2. **一次 run 一个 `worker_threads`，常驻进程复用模块图与 JIT 缓存。** 取消 = `worker.terminate()`——这是 Node 里唯一与 `engine.rs:688-710` 那个 `set_interrupt_handler`（抛不可捕获异常）等价的原语。**如果省掉 worker、把 core 跑在 sidecar 主线程上，一个死循环节点就能把整个 sidecar 锁死，谁也拿它没办法**：这是本篇唯一真正的技术风险，因此它是硬要求不是建议。run 作用域沿用 ADR-0077 §2 的纪律（run 结束必杀必收 ⇒ 「跨 run 泄漏」在设计上不存在）。

3. **本篇不犯 ADR-0074 否决的那两条。** 被否决的是「用 napi-rs addon 把执行器嵌进面进程」（`:158`）与「用面自己的运行时应答这条线」（`:152`）。本篇的引擎不住在任何一面的进程里，也不由面应答——它住在一个由宿主 spawn、管道只连宿主的专用进程里。这是那条 ADR 没写到的第三种形状；`0074:20-26` 关于「终端面的生命周期是 spawn-and-read-channel」的结论继续有效。

4. **传输 = stdio 行框，envelope 抄 findz 那份，但配对假设不许抄。** `native/findz-go/protocol.go:16-35`（`requestVersion`/`requestId`/`method`/`params` → `ok`/`result`/`error{code,message,retryable,details}`）直接复用；`crates/xiranite-quickjs-executor/src/sidecar.rs:19-38,236-241,424-437` 的写侧单锁与 `BufReader::read_line` 也直接复用。
   **但 ADR-0077 §决策 3 那句「串行 ⇒ 不需要请求 id 匹配」在这里是错的**：那条成立是因为 findz sidecar 只有「节点→引擎」一个方向、一次一问；执行器这条线上 cancel 必须在 run 尚未返回时插入。照抄按序配对会得到一条**取消不了任何东西**的通道，而且它不会报错——它会安静地把 cancel 的响应喂给下一个请求。`requestId` 配对是本篇的硬要求，`sidecar.rs:27-32` 那张表要改。
   字节仍然走旁路不走 JSON：`crates/quickjs-host-protocol/src/envelope.rs:1-11,16-23` 那条「答案可以是 text 或 raw buffer，不许 base64 进 JSON」的规则要延续（Node 侧走 `postMessage` 的 transferList 或落临时文件回句柄）。这是行框 JSON 唯一真正的限制。

5. **`service.invoke` 继续存在，但理由换了：不是授权，是引擎住在那边。** 借来的引擎不因为撤了 gate 就能被 Node 载入——`native/czkawka-core` 与 `native/findz-go` 要么留宿主侧（现状），要么把 napi 请回来（ADR-0074:158 已否决），要么用 JS 重写（那是第二份实现，ADR-0074 §1 否决）。所以**服务臂保留**。
   ⚠️ **这是本篇最容易被读错的一条**：「不保留授权」≠「所有宿主调用都消失」。落地时必须按「这是策略还是所有权」逐个分臂。

6. **少数几个必须留在宿主侧的东西不是授权，是共享状态的所有权**，撤 gate 时不许一起带走：
   - **config 写**：`crates/xiranite-core/src/config_store.rs:20,39-41` 那条 `.xr-write.lock` O_EXCL 兄弟文件锁是宿主写的唯一串行点。core 一旦自由 `node:fs` 写 TOML，就绕过它，出现两笔外观配置互相吞（这个失败模式已经记过一次：见项目内 `xiranite-appearance-config-write-ordering`）。
   - **findz 的 `watcher.apply_changes` / `watcher.set_health`**：ADR-0077 §5 拒给节点的理由是「谁在看着这个库」的陈述权归宿主，不是不信节点。那条理由与授权无关，原样有效（`findz_operations::HOST_ONLY_METHODS`）。
   - 同一条判据适用于将来任何「宿主自己会主动 emit」的臂（tray、watch、frame events）。

7. **宿主授权 gate 不保留**：按 operation 解析的根角色、外部程序白名单（`DangerGate`）、网络主机、递归遍历标记，**不再在执行点强制**。直接后果：
   - `docs/xiranite-target-node-manifest.json` 里 6 个节点共 **10 条 `pendingProcessGrants`**（bandia 2 / bitv 1 / gifu 3 / mvz 1 / repacku 1 / smartzip 2）不再是任何人的待办 ⇒ 字段整条删除，不许留成「以后再读」的装饰。
   - `bun run audit:node-feasibility` 的 tier 词表（`file-io` 25 / `recursive-enumeration` 18 / `external-process` 8 / `os-native` 7 / `pure-logic` 2 / `no-host-free-answer` 1，28 个 retain-rewrite 节点）**语义从「要不要宿主授权」改成「要不要问借来的引擎」**。不改的话 manifest 的 `policy` 现文（明写 "Per ADR-0073 every retain-rewrite node carries hostRequirements … never a verdict taken from the node name"）会把这次撤销读成漂移，`audit:target-node-manifest` 会在自己没察觉的情况下变成尺对着空气。
   - ⚠️ **撤的是对进程的限制，不是对人的提问。** `packages/cli-runtime/src/interaction.ts:80-102` 的 `isDangerous`/`dangerPrompt`，以及所有危险动作前的人类确认，语义**一字不变**（AGENTS.md「安全确认语义不变」这条继续有效）。这两个概念必须分开命名，见 `CONTEXT.md` 新增的「危险确认 vs 宿主授权」。把两者混称「权限」会在这次退役里误删确认——那是本篇最坏的可能后果。

8. **`maxLiveBytes` 单独处理（这条是我的裁定，不是用户拍的）**：28/28 节点都带它，但它是资源约束不是授权，而且**在进程边界实施不需要节点侧配合、不需要 deriver 填表，因此不会退化成装饰品**。默认落法：转成执行器进程的 V8 堆上限。**未验**：这些数当初是按 realm 的字节预算推的——bandia 那行的证据自己写着 "adequacy is NOT measured"——换 runtime 之后它对应什么必须重新量，不许照抄。

9. **谁带 runtime**：随包 pinned 的 Node。这反过来让 ADR-0075 变成完全真的——代码本来就是按标准 Node 语法写的，之前需要「`bun` 只当 runner」这个例外是因为 realm 外还有一个通用 JS 进程；本篇之后那个进程就是 runtime 本身。
   代价是老 `bun_runtime.go` 那条账整条回来：runtime 身份（系统装的那个还是随包那个）、版本、三面各自怎么定位它、`XIRANITE_HOST_BIN`（`packages/cli-runtime/src/backend.ts:278-300`）怎么扩成同时定位宿主与 runtime。**未决**。体积也是真的：headless release 此前本机实测 6.9 MiB，带 runtime 是量级变化（同机量过 deno 地板 64.5/34.9 MiB）——数字要现读，别抄这条。

10. **退役与换名**：`crates/quickjs-realm` 与 `packages/quickjs-shims`（35 文件）连同三张表退役；`crates/xiranite-quickjs-executor` **不是删**——它的服务臂、`MachineAccess`、sidecar 表、`HOST_ONLY_METHODS` 都要搬进新的执行器 crate。`crates/quickjs-host-protocol` 的词表继续是单一真源，改名 `xiranite-host-protocol`：ADR-0078 规定「引擎事实与协议事实只写进那两个 crate 的模块文档」，引擎没了之后协议事实不能因此无家可归，否则 `xrh` 与 `service.invoke` 的语义在仓里彻底没有权威描述。
    ⚠️ **名字的封闭集合本身要留着**：一份未知名字即失败的名单，是 ADR-0077 §1 记下的那条「realm 的门是闭集」，撤 gate 撤的是 root/程序/网络，不是「词表可以随便长」。
    ⚠️ 名单长度**必须现读**：AGENTS.md 写 23 个、ADR-0077 写 30 个、起草时另一次读数 31——文档里的这个数字至少已经错过一次，本篇拒绝重复它。

## 被否决的替代

- **把执行器用 napi-rs addon 塞进面进程**：ADR-0074:158 原样有效，本篇不重启。附带成本：`.node` 产物按 platform×ABI 分发（`native/prebuilt/win32-x64/` 就是这个形状），叠加 ADR-0082「只有 Mac 一台开发机」，napi 层的每个 bug 只能在 CI 三条腿上第一次看见。
- **保留 realm，把 A 堆补全（加定时器、加 worker、加 fetch）**：只把「18 条 op 抄一个 fs」这堆镜像做厚，不解决 B 堆。
- **UDS / Windows 命名管道**（`internal/nexusbridge/pipe_other.go:12-31`、`pipe_windows.go:14-52`）：本篇不用。执行器只有一个父进程、不需要 attach、不需要多客户端，stdio 的「EOF 即断 + 不欠任何发现管路」在这个形状下严格占优；而命名管道要新引依赖（`Cargo.lock` 现在零相关 crate）外加每平台一份适配文件。它仍是**面↔宿主**那一跳将来可以换的候选，跟本篇无关。
- **一次 run 一个新进程**：类比 ADR-0077 §被否决（那里实测的启动税是 `255 × 26 ms ≈ 6.6 s`，是扫描本身的 5 倍），但那个数字属于 Go c-shared 路径，**不能直搬到 Node**，所以本篇是「按纪律否决、待实测」。
- **runtime 用 Bun**：与 ADR-0075 的语法约束方向相反（代码已按标准 Node 语法写完）。未量过 Bun 单文件的启动税与体积，因此这条是偏好不是测量。

## 门禁与尺的下场（防假绿；逐条要么删要么换，不许留空转）

- `audit:quickjs-host-ops` / `test:quickjs-host-ops`、`audit:platform-capabilities` / `test:platform-capabilities`：**它们的被测对象就是那三张表**。表退役之后这两族会双双显示通过——这是本仓已经栽过一次的「空转门禁」类（见 `xiranite-inert-cargo-gate-guard`）。必须与新尺同批处理。
- 新尺的落点：`surface.ts` 的 `MODULE_SURFACES` 退役后，「能力一致性」只剩一个可问的问题——**core 里 import 了执行器进程给不了的东西吗**（native addon、`bun:*`、只有宿主有的引擎）。所以新尺是「import 说明符 × 借来引擎名单」的差集，不是三张表。
- `audit:node-bundles` / `build:node-bundles`：**bundle 仍然是产物**，只是装载方从 realm 变成 Node 的 module loader。alias 表变了，尺必须与构建共用同一张表（`surface.ts:106-110` 那条注释记的教训）。
- `audit:node-feasibility` + `audit:target-node-manifest`：按 §7 改 tier 语义与 `policy` 文案，`hostRequirements` 字段考虑改名（它现在量的是「问谁的引擎」）。
- `audit:node-registry`：清单仍是单一真源，但「宿主需求回填」那一半的含义变了。
- `audit:http-surface-parity`：它的 legacy 根是 `packages/api`（`packages/tauri-migrate/src/http-surface.ts:84`），本篇不碰第一跳，因此**不受影响**——列在这里是为了防止有人顺手改它。
- 任何新尺必须自带正控（「同样求和在带违规的夹具上非零」），否则删 gate 之后没人能区分「干净」和「瞎」。

## 后果

- 面↔宿主仍是 HTTP + loopback bearer + 随机端口 + TTL + 那个 stdout channel line：这些**没有因此变好也没有因此变坏**。想换它是另一篇 ADR 的事，而且它的成本比本篇低（词表不用动）。
- Elysia 的命运本篇不裁定：它是**旧 Bun backend 那条腿**的服务器（`packages/api/src/index.ts:24` ← `packages/backend/src/index.ts:149,345`），随那 75−15=60 条未平移路由平移完而退役。唯一被本篇牵动的是它的第三个身份——Eden Treaty 作为类型真源（`packages/api/src/client.ts:354-355`，8+ 消费者按值 import）——那条腿退得越早，越不用为旧 backend 维护这个类型源。
- 发行形状那条「一份 TS core + 一份 Rust 宿主 arms，三种投递」（AGENTS.md）变成「一份 TS core + 一份 Rust 宿主 arms + 一个 runtime」：arms 的份数没变（这才是那条规则争的东西），投递里多带一个 runtime。
- Windows/Linux 侧：`worker.terminate()` 与 JobObject 的组合、stdio 管道上的 `requestId` 配对，本机都没有执行证据。按 ADR-0082，CI 三条腿允许成为首次执行场所，届时的措辞是 **compile-verified only**。

## 未决（都不是本机可测完的，别当待办清单读）

1. runtime 定位与随包体积（§9）。
2. `maxLiveBytes` 在 V8 堆上的等效性（§8）。
3. worker 内 native 绑定在 terminate 后的残留、以及 sidecar 自己 spawn 的 child 归谁收（判据同 ADR-0077 §2：run 作用域表 + `Drop` 必杀）。
4. `requestId` 配对改完之后，`sidecar.rs` 那张表是否还能同时服务 findz 与执行器（复用还是分叉）。
5. 词表里哪些名字进了 Node 就该消失（`fs.*` 那 17 条大概率整族走），以及消失后 `xiranite-host-protocol` 还剩多少。
